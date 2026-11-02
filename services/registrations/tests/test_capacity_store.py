"""Testes de dominio e contratos DB-API, nao substituem testes InnoDB reais."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.capacity_store import (
    CapacityError, CapacityStore, CapacityResult,
    decide_admission, evaluate_capacity,
)


class CapacityRulesTest(unittest.TestCase):
    def test_free_seat_paid_is_reserved(self):
        self.assertEqual(decide_admission(
            ocupadas=2, capacidade=3, fila_habilitada=True,
            ha_anterior_na_fila=False, paga=True), "RESERVADO")

    def test_free_seat_free_activity_confirms(self):
        self.assertEqual(decide_admission(
            ocupadas=2, capacidade=3, fila_habilitada=True,
            ha_anterior_na_fila=False, paga=False), "CONFIRMADO")

    def test_full_waitlist_enabled_waits(self):
        self.assertEqual(decide_admission(
            ocupadas=3, capacidade=3, fila_habilitada=True,
            ha_anterior_na_fila=False, paga=True), "EM_FILA")

    def test_full_without_waitlist_is_terminal(self):
        self.assertEqual(decide_admission(
            ocupadas=3, capacidade=3, fila_habilitada=False,
            ha_anterior_na_fila=False, paga=True), "SEM_VAGA")

    def test_waiting_ticket_has_priority_over_newcomer(self):
        self.assertEqual(decide_admission(
            ocupadas=1, capacidade=3, fila_habilitada=True,
            ha_anterior_na_fila=True, paga=True), "EM_FILA")

    def test_waitlist_disabled_does_not_skip_older(self):
        self.assertEqual(decide_admission(
            ocupadas=1, capacidade=3, fila_habilitada=False,
            ha_anterior_na_fila=True, paga=True), "SEM_VAGA")

    def test_inconsistent_occupancy_rejected(self):
        with self.assertRaisesRegex(CapacityError, "OCUPACAO_INCONSISTENTE"):
            decide_admission(ocupadas=4, capacidade=3,
                             fila_habilitada=True, ha_anterior_na_fila=False, paga=True)

    def test_capacity_below_occupancy_rejected(self):
        self.assertEqual(evaluate_capacity(desired=29, committed=30),
                         "CAPACIDADE_INSUFICIENTE")
        self.assertIsNone(evaluate_capacity(desired=30, committed=30))
        self.assertIsNone(evaluate_capacity(desired=31, committed=30))

    def test_negative_capacity_rejected(self):
        with self.assertRaisesRegex(CapacityError, "CAPACIDADE_INVALIDA"):
            evaluate_capacity(desired=-1, committed=0)


class FakeCursor:
    def __init__(self, results):
        self.results = list(results)
        self.statements = []
        self.closed = False

    def execute(self, sql, args=()):
        self.statements.append((sql, args))

    def fetchone(self):
        return self.results.pop(0) if self.results else None

    def close(self):
        self.closed = True


class FakeConnection:
    def __init__(self, results):
        self.cur = FakeCursor(results)
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def cursor(self):
        return self.cur

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


class CapacityTransactionContractTest(unittest.TestCase):
    def test_new_activity_version_one_persists(self):
        conn = FakeConnection([None, None])
        store = CapacityStore(lambda: conn)
        result = store.apply_capacity(
            activity="A", operation_id="op1", expected_version=0,
            target_version=1, capacity=30, waitlist=True, hold_minutes=30, paid=True
        )
        self.assertEqual(result, CapacityResult("op1", "APLICADA", 1, 30, None))
        self.assertTrue(conn.committed)
        self.assertTrue(conn.closed)
        self.assertTrue(conn.cur.closed)
        self.assertTrue(any("INSERT INTO activity_capacity" in x for x, _ in conn.cur.statements))

    def test_reject_decrease_below_occupied_without_update(self):
        conn = FakeConnection([
            None,
            {"version": 1, "capacity": 30, "lista_espera_habilitada": 1,
             "prazo_reserva_min": 30, "atividade_paga": 1},
            {"n": 28}
        ])
        result = CapacityStore(lambda: conn).apply_capacity(
            activity="A", operation_id="op2", expected_version=1,
            target_version=2, capacity=27, waitlist=True, hold_minutes=30, paid=True
        )
        self.assertEqual(result.result, "REJEITADA")
        self.assertEqual(result.reason, "CAPACIDADE_INSUFICIENTE")
        self.assertEqual(result.capacity, 30)
        self.assertTrue(conn.committed)
        self.assertFalse(any("UPDATE activity_capacity" in x for x, _ in conn.cur.statements))

    def test_duplicate_op_returns_persisted_result(self):
        conn = FakeConnection([{
            "atividade_id": "A", "expected_version": 0,
            "target_version": 1, "desired_capacity": 30,
            "lista_espera_habilitada": 1, "prazo_reserva_min": 30,
            "atividade_paga": 1, "result": "APLICADA",
            "applied_version": 1, "effective_capacity": 30, "reason": None
        }])
        result = CapacityStore(lambda: conn).apply_capacity(
            activity="A", operation_id="op1", expected_version=0,
            target_version=1, capacity=30, waitlist=True, hold_minutes=30, paid=True
        )
        self.assertEqual(result.result, "APLICADA")
        self.assertEqual(len(conn.cur.statements), 1)
        self.assertTrue(conn.committed)

    def test_duplicate_op_modified_payload_rolls_back(self):
        conn = FakeConnection([{
            "atividade_id": "A", "expected_version": 0,
            "target_version": 1, "desired_capacity": 31,
            "lista_espera_habilitada": 1, "prazo_reserva_min": 30,
            "atividade_paga": 1, "result": "APLICADA",
            "applied_version": 1, "effective_capacity": 31, "reason": None
        }])
        with self.assertRaisesRegex(CapacityError, "OPERACAO_REUTILIZADA"):
            CapacityStore(lambda: conn).apply_capacity(
                activity="A", operation_id="op1", expected_version=0,
                target_version=1, capacity=30, waitlist=True, hold_minutes=30, paid=True
            )
        self.assertTrue(conn.rolled_back)
        self.assertTrue(conn.closed)

    def test_ingestion_must_not_skip_ticket(self):
        conn = FakeConnection([
            {"last_ingested_ticket": 1, "capacity": 10,
             "lista_espera_habilitada": 1, "atividade_paga": 1, "prazo_reserva_min": 30},
            None
        ])
        with self.assertRaisesRegex(CapacityError, "TICKET_FORA_DE_ORDEM"):
            CapacityStore(lambda: conn).admit_ticket(
                inscricao_id="id3", user_id="u3",
                activity="A", numero_ticket=3, cpf_digest="f" * 64
            )
        self.assertTrue(conn.rolled_back)


if __name__ == "__main__":
    unittest.main()
