"""Regras puras do resultado de pagamento — sem acesso a provedor ou banco.

RN03: primeira recusa definitiva libera; indeterminado nao libera.
Pagamento efetuado dentro da reserva pode confirmar com callback posterior.
O instante do pagamento deve vir da fonte confiavel, nunca do navegador.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone


class PaymentRuleError(ValueError):
    pass


@dataclass(frozen=True)
class PaymentDecision:
    registration_status: str
    frees_seat: bool
    needs_review: bool


def _aware(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise PaymentRuleError("DATA_SEM_FUSO")
    return value.astimezone(timezone.utc)


def payment_decision(
    *, registration_status: str, outcome: str,
    reservation_deadline: datetime, paid_at: datetime | None = None
) -> PaymentDecision:
    if registration_status not in {"EM_VERIFICACAO", "CONFIRMADO", "RECUSADO", "EXPIRADO"}:
        raise PaymentRuleError("ESTADO_INVALIDO")
    deadline = _aware(reservation_deadline)
    if registration_status in {"CONFIRMADO", "RECUSADO", "EXPIRADO"}:
        raise PaymentRuleError("RESULTADO_DEFINITIVO_EXISTENTE")
    if outcome == "INDETERMINADO":
        return PaymentDecision("EM_VERIFICACAO", False, True)
    if outcome == "RECUSADO_DEFINITIVO":
        return PaymentDecision("RECUSADO", True, False)
    if outcome == "EXPIRADO_DEFINITIVO":
        # Exige verificacao confiavel do provedor de que NAO houve pagamento
        # tempestivo. Nao confundir com mero timeout.
        return PaymentDecision("EXPIRADO", True, False)
    if outcome == "PAGO":
        if paid_at is None:
            raise PaymentRuleError("HORARIO_PAGAMENTO_NAO_COMPROVADO")
        if _aware(paid_at) <= deadline:
            return PaymentDecision("CONFIRMADO", False, False)
        # Sem confirmar nem liberar automaticamente em pagamento tardio:
        # precisa de tratamento financeiro administrativo.
        return PaymentDecision("EM_VERIFICACAO", False, True)
    raise PaymentRuleError("RESULTADO_DESCONHECIDO")
