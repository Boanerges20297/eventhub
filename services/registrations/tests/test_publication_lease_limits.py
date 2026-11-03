"""Testes de limites e riscos do lease local de publicacao EventHub.

Documenta o compromisso de consistencia: durante particao de rede, cache
conhecido pode estar desatualizado ate o fim do lease.
"""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.ticket_store import TicketStore


class CacheLeaseBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.store=TicketStore(Path(self.temp.name)/"lease.sqlite", "test-publication-key-for-stress")
        self.activity="activity-known"

    def tearDown(self):
        self.temp.cleanup()

    def test_24_hour_boundary_and_expiration(self):
        with patch("app.ticket_store.time.time", return_value=200000):
            self.store.remember_published(self.activity, 1)
        with patch("app.ticket_store.time.time", return_value=200000+86400):
            self.assertTrue(self.store.recently_published(self.activity))
        with patch("app.ticket_store.time.time", return_value=200000+86401):
            self.assertFalse(self.store.recently_published(self.activity))

    def test_request_cannot_extend_expiration_beyond_one_day(self):
        with patch("app.ticket_store.time.time", return_value=200000):
            self.store.remember_published(self.activity, 1)
        with patch("app.ticket_store.time.time", return_value=200000+86401):
            self.assertFalse(self.store.recently_published(self.activity, 999999999))

    def test_negative_or_zero_lease_denies(self):
        self.store.remember_published(self.activity, 1)
        self.assertFalse(self.store.recently_published(self.activity, 0))
        self.assertFalse(self.store.recently_published(self.activity, -1))

    def test_clock_reversal_denies(self):
        with patch("app.ticket_store.time.time", return_value=200000):
            self.store.remember_published(self.activity, 1)
        with patch("app.ticket_store.time.time", return_value=199999):
            self.assertFalse(self.store.recently_published(self.activity))

    def test_explicit_revocation_invalidates_cache(self):
        self.store.remember_published(self.activity, 3)
        self.store.forget_published(self.activity)
        self.assertFalse(self.store.recently_published(self.activity))

    def test_revocation_unknown_during_partition_is_not_detectable(self):
        # Este cenario propositalmente comprova uma LIMITACAO, nao seguranca:
        # Eventos poderia ter revogado apos ultimo ACK; SQLite nao saberia.
        with patch("app.ticket_store.time.time", return_value=200000):
            self.store.remember_published(self.activity, 1)
        with patch("app.ticket_store.time.time", return_value=200030):
            self.assertTrue(self.store.recently_published(self.activity))
        # Aceite ate expirar nao prova publicacao atual em Eventos.
        # Sem conectividade, nao ha garantia forte de revogacao instantanea.

if __name__=="__main__":
    unittest.main()
