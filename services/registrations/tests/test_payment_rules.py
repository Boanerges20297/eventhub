import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.payment_rules import PaymentRuleError, payment_decision


class PaymentRulesTest(unittest.TestCase):
    def setUp(self):
        self.deadline = datetime(2026, 11, 2, 21, 30, tzinfo=timezone.utc)

    def decide(self, outcome, paid_at=None):
        return payment_decision(
            registration_status="EM_VERIFICACAO",
            outcome=outcome, reservation_deadline=self.deadline, paid_at=paid_at
        )

    def test_definitive_first_refusal_releases(self):
        result = self.decide("RECUSADO_DEFINITIVO")
        self.assertEqual(result.registration_status, "RECUSADO")
        self.assertTrue(result.frees_seat)

    def test_indeterminate_preserves_reservation(self):
        result = self.decide("INDETERMINADO")
        self.assertEqual(result.registration_status, "EM_VERIFICACAO")
        self.assertFalse(result.frees_seat)
        self.assertTrue(result.needs_review)

    def test_paid_before_deadline_with_late_callback_confirms(self):
        paid = self.deadline - timedelta(seconds=1)
        result = self.decide("PAGO", paid)
        self.assertEqual(result.registration_status, "CONFIRMADO")
        self.assertFalse(result.frees_seat)

    def test_paid_at_deadline_confirms(self):
        self.assertEqual(self.decide("PAGO", self.deadline).registration_status, "CONFIRMADO")

    def test_paid_after_deadline_requires_review(self):
        result = self.decide("PAGO", self.deadline + timedelta(seconds=1))
        self.assertEqual(result.registration_status, "EM_VERIFICACAO")
        self.assertTrue(result.needs_review)

    def test_missing_provider_payment_time_is_not_approved(self):
        with self.assertRaisesRegex(PaymentRuleError, "HORARIO_PAGAMENTO"):
            self.decide("PAGO")

    def test_non_timezone_aware_provider_timestamp_rejected(self):
        with self.assertRaisesRegex(PaymentRuleError, "DATA_SEM_FUSO"):
            self.decide("PAGO", datetime(2026, 11, 2, 21, 29))

    def test_verified_definitive_expiration_releases(self):
        self.assertTrue(self.decide("EXPIRADO_DEFINITIVO").frees_seat)

    def test_terminal_state_cannot_be_reopened(self):
        with self.assertRaisesRegex(PaymentRuleError, "RESULTADO_DEFINITIVO"):
            payment_decision(
                registration_status="RECUSADO", outcome="PAGO",
                reservation_deadline=self.deadline, paid_at=self.deadline
            )


if __name__ == "__main__":
    unittest.main()
