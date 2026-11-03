"""Contrato do espelho de publicacao e admissao durante falhas de Eventos.

Dados sinteticos; testes de unidade nao dependem de MySQL, rede ou credenciais.
"""
from __future__ import annotations

import asyncio
import base64
import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import httpx

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.ticket_store import TicketStore
try:
    from app import main
    from fastapi import HTTPException
except ModuleNotFoundError as exc:
    if exc.name not in ("fastapi", "pydantic", "pymysql", "httpx"):
        raise
    main = None
    HTTPException = None

SECRET = "unit-test-internal-secret-" + "X" * 48


def cpf(seed):
    number = f"{50000 + seed:09d}"
    for size in (9, 10):
        check = sum(int(number[i]) * (size + 1 - i) for i in range(size)) * 10 % 11
        number += str(0 if check == 10 else check)
    return number


class FakeRequest:
    def __init__(self, secret=SECRET, user=True):
        self.headers = {"x-eventhub-internal-key": secret}
        if user:
            principal = {"sub": "participant-1", "role": "participant"}
            self.headers["x-eventhub-auth"] = base64.urlsafe_b64encode(
                json.dumps(principal).encode()
            ).decode().rstrip("=")


class Client:
    def __init__(self, response, **kwargs):
        self.response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def get(self, url, headers=None):
        if isinstance(self.response, Exception):
            raise self.response
        status, payload = self.response
        return httpx.Response(status, json=payload,
                              request=httpx.Request("GET", url))


class PublicationStoreOnlyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = TicketStore(Path(self.temp.name)/"queue.sqlite", "test-publication-hmac-123")
        self.activity = "published-test"

    def tearDown(self):
        self.temp.cleanup()

    def test_durable_publication_across_restart(self):
        self.store.remember_published(self.activity, 1)
        another = TicketStore(self.store.path, "test-publication-hmac-123")
        self.assertTrue(another.recently_published(self.activity))

    def test_unknown_or_expired_is_denied(self):
        self.assertFalse(self.store.recently_published("unknown"))
        self.store.remember_published(self.activity, 1)
        with self.store._connect() as conn:
            conn.execute("UPDATE published_activities SET verified_at=0")
        self.assertFalse(self.store.recently_published(self.activity))

    def test_revoke_and_monotonic_version(self):
        self.store.remember_published(self.activity, 2)
        self.store.remember_published(self.activity, 1)
        with self.store._connect() as conn:
            row = conn.execute(
                "SELECT publication_version FROM published_activities WHERE atividade_id=?",
                (self.activity,)
            ).fetchone()
        self.assertEqual(row["publication_version"], 2)
        self.store.forget_published(self.activity)
        self.assertFalse(self.store.recently_published(self.activity))


@unittest.skipIf(main is None, "FastAPI dependencies are provided by the Docker test runtime")
class PublicationCacheTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = TicketStore(Path(self.temp.name)/"queue.sqlite", "test-publication-hmac-123")
        self.activity = "activity-" + uuid.uuid4().hex
        self.queue_patch = patch.object(main, "queue", return_value=self.store)
        self.env_patch = patch.dict("os.environ", {
            "EVENTHUB_INTERNAL_SECRET": SECRET,
            "EVENTHUB_EVENTS_URL": "http://events:3000",
        })
        self.queue_patch.start()
        self.env_patch.start()

    def tearDown(self):
        self.env_patch.stop()
        self.queue_patch.stop()
        self.temp.cleanup()

    def submit(self, response, seed=1):
        payload = main.Register(
            atividade_id=self.activity, cpf=cpf(seed),
            idempotency_key=uuid.uuid4(),
        )
        with patch.object(main.httpx, "AsyncClient",
                          side_effect=lambda **kw: Client(response, **kw)):
            return asyncio.run(main.register(payload, FakeRequest()))

    def test_published_cache_survives_restart(self):
        self.store.remember_published(self.activity, 1)
        self.assertTrue(self.store.recently_published(self.activity))
        after_restart = TicketStore(self.store.path, "test-publication-hmac-123")
        self.assertTrue(after_restart.recently_published(self.activity))

    def test_unknown_activity_fails_closed_during_outage(self):
        offline = httpx.ConnectError("offline", request=httpx.Request("GET", "http://events:3000"))
        with self.assertRaises(HTTPException) as context:
            self.submit(offline)
        self.assertEqual(context.exception.status_code, 503)
        self.assertEqual(context.exception.detail, "PUBLICACAO_NAO_VERIFICAVEL")
        self.assertEqual(self.store.pending_for_activity(self.activity), [])

    def test_valid_cached_activity_accepts_during_outage(self):
        self.store.remember_published(self.activity, 1)
        offline = httpx.ConnectError("offline", request=httpx.Request("GET", "http://events:3000"))
        result = self.submit(offline)
        self.assertEqual(result["estado"], "REGISTRADO")
        self.assertTrue(result["modo_degradado"])
        self.assertEqual(result["numero_ticket"], 1)

    def test_http_503_uses_recent_cached_publication(self):
        self.store.remember_published(self.activity, 1)
        result = self.submit((503, {"error": "MYSQL_DOWN"}))
        self.assertTrue(result["modo_degradado"])

    def test_positive_validation_warms_cache(self):
        response = (200, {"publicada": True, "atividade_id": self.activity,
                          "capacidade_version": 1})
        result = self.submit(response)
        self.assertFalse(result["modo_degradado"])
        self.assertTrue(self.store.recently_published(self.activity))

    def test_explicit_404_revokes_cached_publication(self):
        self.store.remember_published(self.activity, 1)
        with self.assertRaises(HTTPException) as context:
            self.submit((404, {"error": "ATIVIDADE_NAO_PUBLICADA"}))
        self.assertEqual(context.exception.status_code, 409)
        self.assertFalse(self.store.recently_published(self.activity))

    def test_200_wrong_activity_does_not_poison_cache(self):
        with self.assertRaises(HTTPException) as context:
            self.submit((200, {"publicada": True,
                               "atividade_id": "some-other-activity",
                               "capacidade_version": 1}))
        self.assertEqual(context.exception.status_code, 409)
        self.assertFalse(self.store.recently_published(self.activity))

    def test_expired_publication_fails_closed(self):
        self.store.remember_published(self.activity, 1)
        with self.store._connect() as conn:
            conn.execute("UPDATE published_activities SET verified_at=0")
        self.assertFalse(self.store.recently_published(self.activity))
        offline = httpx.ConnectError("offline", request=httpx.Request("GET", "http://events:3000"))
        with self.assertRaises(HTTPException) as context:
            self.submit(offline)
        self.assertEqual(context.exception.status_code, 503)

    def test_publication_internal_authentication(self):
        data = main.PublishedActivity(atividade_id=self.activity, capacidade_version=1)
        with self.assertRaises(HTTPException) as context:
            main.record_publication(data, FakeRequest(secret="bad", user=False))
        self.assertEqual(context.exception.status_code, 403)
        self.assertFalse(self.store.recently_published(self.activity))
        result = main.record_publication(data, FakeRequest(user=False))
        self.assertEqual(result["result"], "REGISTRADA")
        self.assertTrue(self.store.recently_published(self.activity))

    def test_capacity_version_does_not_imply_publication(self):
        # O espelho so recebe publicada depois do callback; capacity e MySQL.
        self.assertFalse(self.store.recently_published(self.activity))
        self.store.remember_published(self.activity, 2)
        self.store.remember_published(self.activity, 1)
        with self.store._connect() as conn:
            row = conn.execute(
                "SELECT publication_version FROM published_activities WHERE atividade_id=?",
                (self.activity,)
            ).fetchone()
        self.assertEqual(row["publication_version"], 2)


if __name__ == "__main__":
    unittest.main()
