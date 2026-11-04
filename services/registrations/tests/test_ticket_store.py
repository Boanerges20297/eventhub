import tempfile
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.ticket_store import TicketError, TicketStore, normalize_cpf


def valid_cpf(seed: int) -> str:
    digits = f"{seed:09d}"
    for size in (9, 10):
        check = sum(int(digits[i]) * (size + 1 - i) for i in range(size)) * 10 % 11
        digits += str(0 if check == 10 else check)
    return digits


class TicketStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "queue.db"
        self.store = TicketStore(self.path, "test-secret-only-not-for-prod")
        self.activity = "atividade-A"

    def tearDown(self):
        self.temp.cleanup()

    def issue(self, seed: int, *, user: str = "u1", key: str | None = None,
              activity: str | None = None):
        return self.store.issue(
            user_id=user, atividade_id=activity or self.activity,
            cpf=valid_cpf(seed), idempotency_key=key or str(uuid.uuid4())
        )

    def test_cpf_validation(self):
        self.assertEqual(normalize_cpf("529.982.247-25"), "52998224725")
        for invalid in ("111.111.111-11", "52998224726", "123456", ""):
            with self.subTest(invalid=invalid), self.assertRaises(TicketError):
                normalize_cpf(invalid)

    def test_issue_and_retry_same_intention(self):
        key = str(uuid.uuid4())
        first = self.issue(1, key=key)
        second = self.issue(1, key=key)
        self.assertEqual(first, second)
        self.assertEqual(first.numero_ticket, 1)
        self.assertEqual(len(self.store.pending_for_activity(self.activity)), 1)

    def test_same_key_different_payload_conflict(self):
        key = str(uuid.uuid4())
        self.issue(1, key=key)
        with self.assertRaisesRegex(TicketError, "CHAVE_REUTILIZADA"):
            self.issue(2, key=key)

    def test_same_active_cpf_with_new_key_is_rejected(self):
        self.issue(1)
        with self.assertRaisesRegex(TicketError, "CPF_JA_INSCRITO"):
            self.issue(1, user="u2")

    def test_different_activity_has_independent_ticket(self):
        self.assertEqual(self.issue(1, activity="A").numero_ticket, 1)
        self.assertEqual(self.issue(1, activity="B").numero_ticket, 1)

    def test_reentry_after_definitive_refusal_at_end_of_fifo(self):
        first = self.issue(1)
        self.issue(2, user="u2")
        self.store.update_from_worker(first.inscricao_id, "REGISTRADO", "RESERVADO")
        self.store.update_from_worker(first.inscricao_id, "RESERVADO", "RECUSADO")
        again = self.issue(1, key=str(uuid.uuid4()))
        self.assertEqual(again.numero_ticket, 3)
        self.assertNotEqual(again.inscricao_id, first.inscricao_id)

    def test_payment_uncertain_blocks_reentry(self):
        first = self.issue(1)
        self.store.update_from_worker(first.inscricao_id, "REGISTRADO", "RESERVADO")
        self.store.update_from_worker(first.inscricao_id, "RESERVADO", "EM_VERIFICACAO")
        with self.assertRaisesRegex(TicketError, "CPF_JA_INSCRITO"):
            self.issue(1)

    def test_invalid_transition_or_double_finalize(self):
        first = self.issue(1)
        with self.assertRaisesRegex(TicketError, "TRANSICAO_INVALIDA"):
            self.store.update_from_worker(first.inscricao_id, "REGISTRADO", "RECUSADO")
        self.store.update_from_worker(first.inscricao_id, "REGISTRADO", "CANCELADO")
        with self.assertRaisesRegex(TicketError, "ESTADO_DESATUALIZADO"):
            self.store.update_from_worker(first.inscricao_id, "REGISTRADO", "CANCELADO")

    def test_list_owned_persists_is_scoped_and_paginated(self):
        first = self.issue(1, user="alice")
        self.issue(2, user="bob")
        latest = self.issue(3, user="alice", activity="B")
        page1 = self.store.list_owned("alice", limit=1)
        self.assertEqual(page1["total"], 2)
        self.assertEqual(page1["inscricoes"][0]["inscricao_id"], latest.inscricao_id)
        page2 = self.store.list_owned("alice", limit=1, offset=1)
        self.assertEqual(page2["inscricoes"][0]["inscricao_id"], first.inscricao_id)
        self.assertEqual(self.store.list_owned("bob")["total"], 1)
        self.assertEqual(self.store.list_owned("other")["total"], 0)
        self.assertEqual(page1["inscricoes"][0]["estado"], "REGISTRADO")
        self.assertNotIn("status", page1["inscricoes"][0])
        self.assertNotIn("cpf_digest", page1["inscricoes"][0])
        self.assertNotIn("idempotency_key", page1["inscricoes"][0])
        restarted = TicketStore(self.path, "test-secret-only-not-for-prod")
        self.assertEqual(restarted.list_owned("alice")["total"], 2)

    def test_list_owned_rejects_unbounded_queries(self):
        for limit, offset in ((0, 0), (101, 0), (5, -1), (5, 10001)):
            with self.subTest(limit=limit, offset=offset):
                with self.assertRaisesRegex(TicketError, "PAGINACAO_INVALIDA"):
                    self.store.list_owned("alice", limit, offset)

    def test_persistence_across_restart(self):
        first = self.issue(1)
        restarted = TicketStore(self.path, "test-secret-only-not-for-prod")
        self.assertEqual(restarted.get_owned(first.inscricao_id, "u1"), first)
        self.assertIsNone(restarted.get_owned(first.inscricao_id, "other"))
        second = restarted.issue(user_id="u2", atividade_id=self.activity,
                                 cpf=valid_cpf(2), idempotency_key=str(uuid.uuid4()))
        self.assertEqual(second.numero_ticket, 2)

    def test_100_parallel_issues_have_unique_sequential_tickets(self):
        def submit(seed):
            return self.issue(seed, user=f"user-{seed}")
        with ThreadPoolExecutor(max_workers=16) as pool:
            tickets = list(pool.map(submit, range(1, 101)))
        numbers = sorted(t.numero_ticket for t in tickets)
        self.assertEqual(numbers, list(range(1, 101)))
        self.assertEqual(len({t.inscricao_id for t in tickets}), 100)

    def test_parallel_retry_same_key_yields_one_ticket(self):
        key = str(uuid.uuid4())
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.issue(1, key=key), range(20)))
        self.assertEqual(len({t.inscricao_id for t in results}), 1)
        self.assertEqual(len(self.store.pending_for_activity(self.activity)), 1)


if __name__ == "__main__":
    unittest.main()
