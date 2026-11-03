"""Worker: testes deterministas, sem conectar a bancos de outros projetos."""
from __future__ import annotations

import tempfile
import unittest
import uuid
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.worker import RegistrationWorker
from app.capacity_store import CapacityError, GrantResult
from app.ticket_store import TicketError, TicketStore


def cpf_for(seed: int) -> str:
    digits = f"{seed + 1000:09d}"
    for size in (9, 10):
        check = sum(int(digits[i]) * (size + 1 - i) for i in range(size)) * 10 % 11
        digits += str(0 if check == 10 else check)
    return digits


class InMemoryMySQLContract:
    def __init__(self):
        self.status = {}
        self.admitted = []
        self.synced = True
        self.expiration_ids = []
        self.promoted = []

    def get_status(self, ticket_id):
        return self.status.get(ticket_id)

    def admit_ticket(self, *, inscricao_id, user_id, activity, numero_ticket, cpf_digest):
        if not self.synced:
            raise CapacityError("ATIVIDADE_NAO_SINCRONIZADA")
        self.admitted.append((inscricao_id, numero_ticket))
        self.status[inscricao_id] = "RESERVADO" if numero_ticket == 1 else "EM_FILA"
        return GrantResult(inscricao_id, activity, numero_ticket, self.status[inscricao_id])

    def due_expirations(self, limit=100):
        return list(self.expiration_ids)

    def finalize(self, ticket_id, *, expected, destination):
        self.status[ticket_id] = destination
        return True, []

    def waiting_activities(self, limit=100):
        return ["A"] if self.promoted else []

    def promote_waiting(self, activity):
        return self.promoted


class WorkerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.queue = TicketStore(Path(self.tmp.name) / "queue.sqlite", "dev-secret-only-for-tests")
        self.mysql = InMemoryMySQLContract()
        self.worker = RegistrationWorker(self.queue, self.mysql)

    def tearDown(self):
        self.tmp.cleanup()

    def issue(self, index):
        return self.queue.issue(
            user_id=f"u-{index}", atividade_id="A", cpf=cpf_for(index),
            idempotency_key=str(uuid.uuid4())
        )

    def test_fifo_ingests_in_ticket_order(self):
        tickets = [self.issue(i) for i in range(5)]
        first = self.worker.run_once()
        self.assertEqual(first.ingested, 5)
        self.assertEqual([no for _, no in self.mysql.admitted], [1, 2, 3, 4, 5])
        self.assertEqual(self.queue.get_owned(tickets[0].inscricao_id, "u-0").status,
                         "RESERVADO")
        self.assertEqual(self.queue.get_owned(tickets[4].inscricao_id, "u-4").status,
                         "EM_FILA")
        self.assertEqual(self.worker.run_once().ingested, 0)

    def test_unsynced_activity_preserves_ticket(self):
        ticket = self.issue(0)
        self.mysql.synced = False
        self.assertEqual(self.worker.run_once().ingested, 0)
        self.assertEqual(self.queue.get_owned(ticket.inscricao_id, "u-0").status, "REGISTRADO")
        self.mysql.synced = True
        self.assertEqual(self.worker.run_once().ingested, 1)

    def test_crash_after_mysql_commit_before_sqlite_ack(self):
        ticket = self.issue(0)
        self.mysql.status[ticket.inscricao_id] = "RESERVADO"
        result = self.worker.run_once()
        self.assertEqual(result.reconciled, 1)
        self.assertEqual(result.ingested, 0)
        self.assertEqual(self.mysql.admitted, [])
        self.assertEqual(self.queue.get_owned(ticket.inscricao_id, "u-0").status, "RESERVADO")

    def test_lost_promotion_ack_recovered(self):
        first = self.issue(0)
        second = self.issue(1)
        self.worker.run_once()
        self.mysql.status[second.inscricao_id] = "RESERVADO"
        synced = self.worker.run_once()
        self.assertEqual(synced.reconciled, 1)
        self.assertEqual(self.queue.get_owned(second.inscricao_id, "u-1").status, "RESERVADO")
        self.assertEqual(self.queue.get_owned(first.inscricao_id, "u-0").status, "RESERVADO")

    def test_authoritative_jump_ahead_but_no_regression(self):
        ticket = self.issue(0)
        self.queue.sync_authoritative(ticket.inscricao_id, "EXPIRADO")
        with self.assertRaisesRegex(TicketError, "REGRESSAO_DE_ESTADO"):
            self.queue.sync_authoritative(ticket.inscricao_id, "RESERVADO")

    def test_due_expiration_wakes_reconciliation_next_cycle(self):
        ticket = self.issue(0)
        self.worker.run_once()
        self.mysql.expiration_ids = [ticket.inscricao_id]
        result = self.worker.run_once()
        self.assertEqual(result.expired, 1)
        self.mysql.expiration_ids = []
        self.assertEqual(self.worker.run_once().reconciled, 1)
        self.assertEqual(self.queue.get_owned(ticket.inscricao_id, "u-0").status, "EXPIRADO")

    def test_reconcile_is_idempotent(self):
        ticket = self.issue(0)
        self.queue.sync_authoritative(ticket.inscricao_id, "EM_FILA")
        self.queue.sync_authoritative(ticket.inscricao_id, "EM_FILA")
        self.assertEqual(self.queue.get_owned(ticket.inscricao_id, "u-0").status, "EM_FILA")


if __name__ == "__main__":
    unittest.main()
