"""Outbox transacional do dominio Inscricoes.

Registro no MESMO commit MySQL da mudanca de estado; entrega ao servico
Notificacoes por HTTP externo ao lock; reentrega at-least-once com dedupe
pelo identificador do evento. Sem dados pessoais, apenas IDs opacos.
"""
from __future__ import annotations

import uuid
from typing import Callable, Any


SCHEMA = """CREATE TABLE IF NOT EXISTS registration_outbox (
    event_id CHAR(36) PRIMARY KEY,
    inscricao_id CHAR(36) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    status VARCHAR(24) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    delivered_at DATETIME(6) NULL,
    retry_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    last_error VARCHAR(64) NULL,
    UNIQUE KEY uq_notification_transition (inscricao_id,status),
    INDEX idx_outbox_due (delivered_at,retry_at,created_at),
    CONSTRAINT fk_outbox_registration FOREIGN KEY (inscricao_id)
      REFERENCES registrations(inscricao_id)
) ENGINE=InnoDB"""


class RegistrationOutbox:
    def __init__(self, connect: Callable[[], Any]):
        self.connect = connect
        self.ready = False

    def ensure_schema(self):
        if self.ready:
            return
        connection = self.connect()
        try:
            with connection.cursor() as cursor:
                cursor.execute(SCHEMA)
            connection.commit()
            self.ready = True
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def append_locked(cursor: Any, *, inscricao_id: str, user_id: str, status: str):
        """Chamado apenas dentro da transacao que alterou a inscricao."""
        if not inscricao_id or not user_id or not status:
            raise ValueError("EVENTO_INCOMPLETO")
        cursor.execute(
            """INSERT INTO registration_outbox
               (event_id,inscricao_id,user_id,status)
               VALUES (%s,%s,%s,%s)
               ON DUPLICATE KEY UPDATE event_id=event_id""",
            (str(uuid.uuid4()), inscricao_id, user_id, status),
        )

    def pending(self, limit: int = 40) -> list[dict]:
        self.ensure_schema()
        connection = self.connect()
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """SELECT event_id,inscricao_id,user_id,status
                       FROM registration_outbox
                       WHERE delivered_at IS NULL AND retry_at<=UTC_TIMESTAMP(6)
                       ORDER BY created_at,event_id LIMIT %s""",
                    (limit,),
                )
                rows = [dict(row) for row in cursor.fetchall()]
            connection.commit()
            return rows
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def acknowledge(self, event_id: str):
        self.ensure_schema()
        connection = self.connect()
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """UPDATE registration_outbox SET delivered_at=UTC_TIMESTAMP(6),
                       last_error=NULL WHERE event_id=%s AND delivered_at IS NULL""",
                    (event_id,),
                )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def retry_later(self, event_id: str, code: str):
        self.ensure_schema()
        connection = self.connect()
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """UPDATE registration_outbox SET
                         attempts=attempts+1,
                         retry_at=DATE_ADD(UTC_TIMESTAMP(6),
                           INTERVAL LEAST(300,POW(2,LEAST(attempts,8))) SECOND),
                         last_error=%s
                       WHERE event_id=%s AND delivered_at IS NULL""",
                    (str(code)[:64],event_id),
                )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
