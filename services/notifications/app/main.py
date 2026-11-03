"""Notificacoes EventHub: caixa simulada, SEM envio SMTP.

Recebe eventos idempotentes apenas por autenticacao entre servicos.
As decisoes de reserva permanecem no dominio Inscricoes.
"""
from __future__ import annotations

import base64
import hmac
import json
import os
from contextlib import asynccontextmanager
from typing import Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .store import deliver, init_schema, list_user


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_schema()
    yield


app = FastAPI(title="EventHub - Notificacoes",version="0.2.0",lifespan=lifespan)


def authenticate(request: Request, *, require_user=False):
    expected = os.getenv("EVENTHUB_INTERNAL_SECRET", "")
    provided = request.headers.get("x-eventhub-internal-key", "")
    if len(expected) < 48 or not hmac.compare_digest(expected,provided):
        raise HTTPException(403,detail="SERVICO_NAO_AUTORIZADO")
    if not require_user:
        return None
    value=request.headers.get("x-eventhub-auth", "")
    if not value or len(value)>2500:
        raise HTTPException(401,detail="NAO_AUTENTICADO")
    try:
        payload=json.loads(base64.urlsafe_b64decode(value+"="*(-len(value)%4)))
        if (not isinstance(payload,dict) or not isinstance(payload.get("sub"),str)
            or not payload["sub"]):
            raise ValueError()
        return payload["sub"]
    except (ValueError,TypeError,UnicodeError,json.JSONDecodeError):
        raise HTTPException(401,detail="NAO_AUTENTICADO") from None


class Delivery(BaseModel):
    event_id: UUID
    inscricao_id: UUID
    user_id: str = Field(min_length=1,max_length=64)
    status: Literal[
        "REGISTRADO","EM_FILA","RESERVADO","EM_VERIFICACAO",
        "CONFIRMADO","RECUSADO","EXPIRADO","CANCELADO","SEM_VAGA"
    ]


@app.get("/health",include_in_schema=False)
def health():
    return {"status":"up","service":"notifications",
            "implementation":"simulador-persistente","business_ready":False}


@app.post("/internal/entregar")
def receive(data: Delivery,request: Request):
    authenticate(request)
    try:
        created=deliver(event_id=str(data.event_id),
                        inscricao_id=str(data.inscricao_id),
                        user_id=data.user_id,status=data.status)
    except ValueError:
        raise HTTPException(409,detail="EVENTO_DIVERGENTE") from None
    return {"event_id":str(data.event_id),"entrega":"ENTREGUE_SIMULADA",
            "duplicada":not created}


@app.get("/internal/notificacoes")
def inbox(request: Request):
    user_id=authenticate(request,require_user=True)
    return {"notificacoes":list_user(user_id,limit=50)}
