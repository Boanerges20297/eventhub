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
from fastapi import FastAPI, HTTPException, Query, Request
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


class PublishedActivity(BaseModel):
    atividade_id: str = Field(min_length=1, max_length=64)
    capacidade_version: int = Field(ge=1)


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


@app.post("/internal/publicacoes")
def record_publication(data: PublishedActivity, request: Request):
    # Somente servicos com a chave interna podem declarar publicacao.
    # Eventos chama esta rota APOS o commit que marca a atividade publicada.
    caller(request)
    queue().remember_published(data.atividade_id, data.capacidade_version)
    return {"result":"REGISTRADA"}


@app.post("/internal/inscricoes", status_code=202)
async def register(data: Register, request: Request):
    user = caller(request)
    if not user or user["role"] not in ("participant","admin"):
        raise HTTPException(403, detail="SEM_PERMISSAO")
    # Eventos e a autoridade de publicacao. O cache duravel so recebe
    # atividade publicada apos confirmacao em Eventos; nunca por mera
    # sincronizacao de capacidade MySQL.
    url = os.environ.get("EVENTHUB_EVENTS_URL", "http://events:3000")
    headers = {"x-eventhub-internal-key": os.environ["EVENTHUB_INTERNAL_SECRET"]}
    degraded = False
    response = None
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            response = await client.get(
                f"{url}/internal/atividades/{data.atividade_id}",
                headers=headers
            )
    except httpx.RequestError:
        degraded = True

    if response is not None:
        if response.status_code == 200:
            try:
                published = response.json()
                valid = (published.get("publicada") is True
                         and published.get("atividade_id") == data.atividade_id
                         and type(published.get("capacidade_version")) is int
                         and published["capacidade_version"] > 0)
            except (ValueError, TypeError, AttributeError):
                valid = False
            if not valid:
                queue().forget_published(data.atividade_id)
                raise HTTPException(409, detail="ATIVIDADE_NAO_PUBLICADA")
            queue().remember_published(data.atividade_id,
                                       published["capacidade_version"])
        elif response.status_code in (404, 410):
            queue().forget_published(data.atividade_id)
            raise HTTPException(409, detail="ATIVIDADE_NAO_PUBLICADA")
        elif response.status_code >= 500:
            degraded = True
        else:
            # Uma resposta de autorizacao/validacao nao pode ser contornada
            # por uma copia antiga da publicacao.
            raise HTTPException(503, detail="VALIDACAO_EVENTOS_INDISPONIVEL")

    if degraded and not queue().recently_published(data.atividade_id):
        # Nao adivinha publicacao nem transforma capacidade em permissao.
        raise HTTPException(503, detail="PUBLICACAO_NAO_VERIFICAVEL")
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
        "modo_degradado": degraded,
        "mensagem":(("Sua solicitacao foi registrada localmente durante "
                     "uma indisponibilidade. Guarde o numero do ticket; "
                     "a confirmacao da vaga sera processada apos a recuperacao.")
                    if degraded else
                    ("Sua solicitacao de vaga foi registrada. "
                     "O resultado sera atualizado no painel de tickets "
                     "e nas notificacoes simuladas da sua conta.")),
    }



@app.get("/internal/atividades/{atividade_id}/resumo")
def activity_summary(atividade_id: str, request: Request):
    """Aggregated status counts only. Caller must be an authorized backend.

    Events verifies organization ownership before querying this internal endpoint.
    No participant identifiers, CPF digests or individual tickets are returned.
    """
    caller(request)
    if not atividade_id or len(atividade_id) > 64:
        raise HTTPException(400, detail="ATIVIDADE_INVALIDA")
    connection = connect_mysql()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT capacity FROM activity_capacity WHERE atividade_id=%s",
                (atividade_id,)
            )
            settings = cursor.fetchone()
            if not settings:
                raise HTTPException(404, detail="ATIVIDADE_NAO_SINCRONIZADA")
            cursor.execute(
                "SELECT status,COUNT(*) AS quantidade FROM registrations "
                "WHERE atividade_id=%s GROUP BY status",
                (atividade_id,)
            )
            counts = {row["status"]: int(row["quantidade"])
                      for row in cursor.fetchall()}
    finally:
        connection.close()
    occupied = sum(counts.get(s, 0) for s in
                   ("RESERVADO", "EM_VERIFICACAO", "CONFIRMADO"))
    capacity_value = int(settings["capacity"])
    return {
        "capacidade": capacity_value,
        "ocupadas": occupied,
        "vagas_livres": max(0, capacity_value - occupied),
        "confirmadas": counts.get("CONFIRMADO", 0),
        "reservadas": counts.get("RESERVADO", 0),
        "em_verificacao": counts.get("EM_VERIFICACAO", 0),
        "em_fila": counts.get("EM_FILA", 0),
        "em_processamento": counts.get("REGISTRADO", 0),
        "total_registradas": sum(counts.values()),
    }

@app.get("/internal/atividades/{atividade_id}/inscricoes")
def activity_registrations(
    atividade_id: str,
    request: Request,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10000),
    estado: str | None = Query(default=None, max_length=24),
):
    """Read-only list of processed tickets for an authorized organizer.

    Caller is the Events service, which has already checked org ownership.
    Do not export CPF, digest, email, user_id or payment details. MySQL is the
    authoritative source for processed registration status. SQLite-only tickets
    awaiting reconciliation are intentionally not included in this listing.
    """
    caller(request)
    if not atividade_id or len(atividade_id) > 64:
        raise HTTPException(400, detail="ATIVIDADE_INVALIDA")
    states = {
        "REGISTRADO", "EM_FILA", "RESERVADO", "EM_VERIFICACAO",
        "CONFIRMADO", "RECUSADO", "EXPIRADO", "CANCELADO", "SEM_VAGA",
    }
    if estado is not None and estado not in states:
        raise HTTPException(400, detail="ESTADO_INVALIDO")
    connection = connect_mysql()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT atividade_id FROM activity_capacity WHERE atividade_id=%s",
                (atividade_id,),
            )
            if not cursor.fetchone():
                raise HTTPException(404, detail="ATIVIDADE_NAO_SINCRONIZADA")
            condition = "atividade_id=%s"
            params = [atividade_id]
            if estado:
                condition += " AND status=%s"
                params.append(estado)
            cursor.execute(
                f"SELECT COUNT(*) AS quantidade FROM registrations WHERE {condition}",
                tuple(params),
            )
            total = int(cursor.fetchone()["quantidade"])
            cursor.execute(
                "SELECT inscricao_id,numero_ticket,status "
                f"FROM registrations WHERE {condition} "
                "ORDER BY numero_ticket ASC LIMIT %s OFFSET %s",
                tuple([*params, limit, offset]),
            )
            rows = cursor.fetchall()
    finally:
        connection.close()
    return {
        "atividade_id": atividade_id,
        "total": total,
        "limit": limit,
        "offset": offset,
        "estado": estado,
        "origem": "mysql_processadas",
        "inscricoes": [
            {
                "inscricao_id": row["inscricao_id"],
                "numero_ticket": int(row["numero_ticket"]),
                "estado": row["status"],
            }
            for row in rows
        ],
    }


@app.get("/internal/inscricoes")
def list_registrations(request: Request,
                       limit: int = Query(default=50, ge=1, le=100),
                       offset: int = Query(default=0, ge=0, le=10000)):
    user = caller(request)
    if not user:
        raise HTTPException(401, detail="NAO_AUTENTICADO")
    return queue().list_owned(user["sub"], limit=limit, offset=offset)


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
