"""API interna do dominio Inscricoes.

O gateway assina a identidade do usuario e envia apenas em rede Docker interna;
cabecalho compartilhado adicional impede acesso cruzado nao autorizado.
"""
from __future__ import annotations

import base64
import hmac
import json
import os
import uuid
from datetime import datetime

import httpx
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .capacity_store import CapacityError, CapacityStore
from .mysql_connection import connect_mysql
from .ticket_store import TicketError, TicketStore

app = FastAPI(title="EventHub - Inscricoes", version="0.2.0")
_queue: TicketStore | None = None


def queue() -> TicketStore:
    global _queue
    if _queue is None:
        _queue = TicketStore(
            os.environ["EVENTHUB_SQLITE_PATH"],
            os.environ["EVENTHUB_CPF_HASH_KEY"]
        )
    return _queue


_capacity = CapacityStore(connect_mysql, enable_outbox=True)


def capacity() -> CapacityStore:
    return _capacity


def caller(request: Request) -> dict | None:
    expected = os.environ.get("EVENTHUB_INTERNAL_SECRET", "")
    received = request.headers.get("x-eventhub-internal-key", "")
    if len(expected) < 48 or not hmac.compare_digest(expected, received):
        raise HTTPException(403, detail="SERVICO_NAO_AUTORIZADO")
    token = request.headers.get("x-eventhub-auth", "")
    if not token:
        return None
    if len(token) > 2500:
        raise HTTPException(403, detail="CONTEXTO_INVALIDO")
    try:
        padded = token + "=" * (-len(token) % 4)
        user = json.loads(base64.urlsafe_b64decode(padded))
        if not isinstance(user, dict) or not isinstance(user.get("sub"), str):
            raise ValueError()
        if user.get("role") not in ("participant", "organizer", "admin"):
            raise ValueError()
        return user
    except (ValueError, TypeError, UnicodeError, json.JSONDecodeError):
        raise HTTPException(403, detail="CONTEXTO_INVALIDO") from None


class CapacityOp(BaseModel):
    atividade_id: str = Field(min_length=1, max_length=64)
    operation_id: uuid.UUID
    expected_version: int = Field(ge=0)
    target_version: int = Field(ge=1)
    capacidade: int = Field(ge=0, le=100000)
    lista_espera_habilitada: bool = True
    prazo_reserva_min: int = Field(default=30, ge=1, le=1440)
    atividade_paga: bool = False


class Register(BaseModel):
    atividade_id: str = Field(min_length=1, max_length=64)
    cpf: str = Field(min_length=11, max_length=20)
    idempotency_key: uuid.UUID


class Cancel(BaseModel):
    pass


@app.get("/health", include_in_schema=False)
def health():
    return {"status":"up","service":"registrations",
            "implementation":"mvp-em-construcao","business_ready":False}


@app.post("/internal/capacidades")
def sync_capacity(op: CapacityOp, request: Request):
    caller(request)
    try:
        result = capacity().apply_capacity(
            activity=op.atividade_id,
            operation_id=str(op.operation_id),
            expected_version=op.expected_version,
            target_version=op.target_version,
            capacity=op.capacidade,
            waitlist=op.lista_espera_habilitada,
            hold_minutes=op.prazo_reserva_min,
            paid=op.atividade_paga,
        )
        data = {
            "result":result.result,
            "version":result.version,
            "capacity":result.capacity,
            "reason":result.reason,
        }
        return data
    except CapacityError as exc:
        raise HTTPException(409, detail=exc.code) from None


@app.post("/internal/inscricoes", status_code=202)
async def register(data: Register, request: Request):
    user = caller(request)
    if not user or user["role"] not in ("participant","admin"):
        raise HTTPException(403, detail="SEM_PERMISSAO")
    # Confirmar publicacao no dominio Eventos. A mera linha no MySQL
    # de Inscricoes nao significa que Eventos publicou a atividade.
    url = os.environ.get("EVENTHUB_EVENTS_URL", "http://events:3000")
    headers = {"x-eventhub-internal-key": os.environ["EVENTHUB_INTERNAL_SECRET"]}
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            response = await client.get(
                f"{url}/internal/atividades/{data.atividade_id}",
                headers=headers
            )
    except httpx.HTTPError:
        raise HTTPException(503, detail="EVENTOS_INDISPONIVEL") from None
    if response.status_code != 200:
        raise HTTPException(409, detail="ATIVIDADE_NAO_PUBLICADA")
    try:
        ticket = queue().issue(
            user_id=user["sub"],
            atividade_id=data.atividade_id,
            cpf=data.cpf,
            idempotency_key=str(data.idempotency_key),
        )
    except TicketError as exc:
        raise HTTPException(409 if exc.code != "CPF_INVALIDO" else 400,
                            detail=exc.code) from None
    return {
        "inscricao_id":ticket.inscricao_id,
        "numero_ticket":ticket.numero_ticket,
        "atividade_id":ticket.atividade_id,
        "estado":ticket.status,
        "mensagem":("Sua solicitacao de vaga foi registrada. "
                    "O resultado sera atualizado no painel de tickets "
                    "e nas notificacoes simuladas da sua conta."),
    }


@app.get("/internal/inscricoes/{inscricao_id}")
def read_registration(inscricao_id: str, request: Request):
    user = caller(request)
    if not user:
        raise HTTPException(401, detail="NAO_AUTENTICADO")
    # Nao retornar dados a usuario que nao e titular.
    ticket = queue().get_owned(inscricao_id, user["sub"])
    if not ticket:
        raise HTTPException(404, detail="INSCRICAO_NAO_ENCONTRADA")
    return {
        "inscricao_id":ticket.inscricao_id,
        "atividade_id":ticket.atividade_id,
        "numero_ticket":ticket.numero_ticket,
        "estado":ticket.status,
    }



class StartPayment(BaseModel):
    attempt_id: uuid.UUID


class PaymentEvent(BaseModel):
    event_id: uuid.UUID
    attempt_id: uuid.UUID
    resultado: str = Field(min_length=2, max_length=32)
    pago_em: datetime | None = None


@app.get("/internal/inscricoes/{inscricao_id}/pagamento")
def payment_context(inscricao_id: str, request: Request):
    user = caller(request)
    if not user or not queue().get_owned(inscricao_id, user["sub"]):
        raise HTTPException(404, detail="INSCRICAO_NAO_ENCONTRADA")
    details = capacity().payment_context(inscricao_id, user["sub"])
    if not details:
        raise HTTPException(409, detail="PEDIDO_AGUARDANDO_PROCESSAMENTO")
    if not details["atividade_paga"]:
        raise HTTPException(409, detail="ATIVIDADE_GRATUITA")
    return details


@app.post("/internal/inscricoes/{inscricao_id}/inicio-pagamento")
def begin_payment(inscricao_id: str, data: StartPayment, request: Request):
    user = caller(request)
    if not user or not queue().get_owned(inscricao_id, user["sub"]):
        raise HTTPException(404, detail="INSCRICAO_NAO_ENCONTRADA")
    try:
        state = capacity().start_payment(inscricao_id)
        try:
            queue().sync_authoritative(inscricao_id, state)
        except (TicketError, OSError):
            pass  # O worker recupera o ACK depois do commit MySQL.
        return {"inscricao_id": inscricao_id, "estado": state,
                "tentativa_id": str(data.attempt_id)}
    except CapacityError as exc:
        raise HTTPException(409, detail=exc.code) from None


@app.post("/internal/inscricoes/{inscricao_id}/resultado-pagamento")
def payment_result(inscricao_id: str, data: PaymentEvent, request: Request):
    user = caller(request)
    if not user or not queue().get_owned(inscricao_id, user["sub"]):
        raise HTTPException(404, detail="INSCRICAO_NAO_ENCONTRADA")
    try:
        state, released = capacity().settle_payment(
            event_id=str(data.event_id),
            attempt_id=str(data.attempt_id),
            inscricao_id=inscricao_id,
            outcome=data.resultado,
            paid_at=data.pago_em,
        )
        try:
            queue().sync_authoritative(inscricao_id, state)
        except (TicketError, OSError):
            pass  # A confirmacao permanece no MySQL, reconciliavel pelo worker.
        return {"inscricao_id": inscricao_id, "estado": state,
                "vaga_liberada": released}
    except CapacityError as exc:
        raise HTTPException(409, detail=exc.code) from None

@app.post("/internal/inscricoes/{inscricao_id}/cancelar")
def cancel_registration(inscricao_id: str, request: Request, _data: Cancel):
    user = caller(request)
    if not user:
        raise HTTPException(401, detail="NAO_AUTENTICADO")
    ticket = queue().get_owned(inscricao_id, user["sub"])
    if not ticket:
        raise HTTPException(404, detail="INSCRICAO_NAO_ENCONTRADA")
    status = capacity().get_status(ticket.inscricao_id)
    if status in ("CANCELADO", "RECUSADO", "EXPIRADO", "SEM_VAGA"):
        return {"inscricao_id":inscricao_id,"estado":status}
    if status in ("REGISTRADO", None):
        raise HTTPException(409, detail="PEDIDO_AGUARDANDO_PROCESSAMENTO")
    if status == "EM_VERIFICACAO":
        raise HTTPException(409, detail="PENDENTE_CONCILIACAO_FINANCEIRA")
    if status not in ("RESERVADO", "EM_FILA", "CONFIRMADO"):
        raise HTTPException(409, detail="ESTADO_NAO_CANCELAVEL")
    try:
        capacity().finalize(
            ticket.inscricao_id, expected=status, destination="CANCELADO"
        )
        queue().sync_authoritative(ticket.inscricao_id, "CANCELADO")
    except CapacityError as exc:
        raise HTTPException(409, detail=exc.code) from None
    return {"inscricao_id":inscricao_id,"estado":"CANCELADO"}
