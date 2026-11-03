"""Inbox persistente do servico Notificacoes (banco exclusivo).

Entrega simulada, sem SMTP e sem dados pessoais, idempotente por event_id.
"""
import os
from contextlib import contextmanager
from typing import Iterator

import pymysql


def connect():
    database = os.getenv("EVENTHUB_MYSQL_DATABASE", "")
    username = os.getenv("EVENTHUB_MYSQL_USER", "")
    password = os.getenv("EVENTHUB_MYSQL_PASSWORD", "")
    if database != "eventhub_notifications" or not username or not password:
        raise RuntimeError("BANCO_NOTIFICACOES_INCORRETO")
    if username.lower() in ("root", "admin"):
        raise RuntimeError("USUARIO_PRIVILEGIADO_NAO_PERMITIDO")
    return pymysql.connect(
        host=os.getenv("EVENTHUB_MYSQL_HOST", "mysql"),
        port=int(os.getenv("EVENTHUB_MYSQL_PORT", "3306")),
        user=username, password=password, database=database,
        charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
        autocommit=False, connect_timeout=5, read_timeout=10, write_timeout=10,
    )


@contextmanager
def transaction() -> Iterator:
    connection=connect()
    try:
        with connection.cursor() as cursor:
            yield cursor
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_schema():
    with transaction() as cur:
        cur.execute(
            """CREATE TABLE IF NOT EXISTS notification_deliveries (
                event_id CHAR(36) PRIMARY KEY,
                inscricao_id CHAR(36) NOT NULL,
                user_id VARCHAR(64) NOT NULL,
                status VARCHAR(24) NOT NULL,
                state VARCHAR(24) NOT NULL DEFAULT 'ENTREGUE_SIMULADA',
                created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                UNIQUE KEY uq_notification_subject (inscricao_id,status),
                INDEX idx_notifications_user (user_id,created_at)
            ) ENGINE=InnoDB"""
        )


def deliver(*,event_id,inscricao_id,user_id,status):
    with transaction() as cur:
        cur.execute(
            """SELECT inscricao_id,user_id,status FROM notification_deliveries
               WHERE event_id=%s FOR UPDATE""", (event_id,),
        )
        existing=cur.fetchone()
        if existing:
            if (existing["inscricao_id"]!=inscricao_id or
                existing["user_id"]!=user_id or existing["status"]!=status):
                raise ValueError("EVENTO_DIVERGENTE")
            return False
        cur.execute(
            """INSERT INTO notification_deliveries
               (event_id,inscricao_id,user_id,status)
               VALUES (%s,%s,%s,%s)""",
            (event_id,inscricao_id,user_id,status)
        )
        return True


def list_user(user_id,limit=50):
    with transaction() as cur:
        cur.execute(
            """SELECT event_id,inscricao_id,status,state,created_at
               FROM notification_deliveries WHERE user_id=%s
               ORDER BY created_at DESC LIMIT %s""",
            (user_id,limit)
        )
        result=[]
        for row in cur.fetchall():
            result.append({
                "event_id":row["event_id"],
                "inscricao_id":row["inscricao_id"],
                "estado_inscricao":row["status"],
                "entrega":row["state"],
                "criado_em":row["created_at"].isoformat()+"Z"
            })
        return result
