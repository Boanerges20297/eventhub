"""Emissor duravel de tickets EventHub (SQLite, propriedade de Inscricoes).

Este modulo NAO concede vagas. A concessao e a ocupacao pertencem ao worker
transacional MySQL/InnoDB. O SQLite ordena e preserva pedidos durante falhas.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
import time
import uuid
from dataclasses import dataclass
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

ACTIVE = frozenset({
    "REGISTRADO", "EM_FILA", "RESERVADO", "EM_VERIFICACAO", "CONFIRMADO"
})
TERMINAL = frozenset({"RECUSADO", "EXPIRADO", "CANCELADO", "SEM_VAGA"})
TRANSITIONS = {
    "REGISTRADO": frozenset({"EM_FILA", "RESERVADO", "CONFIRMADO", "CANCELADO", "SEM_VAGA"}),
    "EM_FILA": frozenset({"RESERVADO", "CONFIRMADO", "CANCELADO", "SEM_VAGA"}),
    "RESERVADO": frozenset({"EM_VERIFICACAO", "CONFIRMADO", "RECUSADO", "EXPIRADO", "CANCELADO"}),
    "EM_VERIFICACAO": frozenset({"CONFIRMADO", "RECUSADO", "EXPIRADO", "CANCELADO"}),
    "CONFIRMADO": frozenset({"CANCELADO"}),
}


class TicketError(ValueError):
    """Erro de validacao ou conflito do contrato de tickets."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def normalize_cpf(value: str) -> str:
    if not isinstance(value, str):
        raise TicketError("CPF_INVALIDO")
    digits = "".join(c for c in value if c.isdigit())
    if len(digits) != 11 or len(set(digits)) == 1:
        raise TicketError("CPF_INVALIDO")
    for size in (9, 10):
        check = (sum(int(digits[i]) * (size + 1 - i) for i in range(size)) * 10) % 11
        if check == 10:
            check = 0
        if check != int(digits[size]):
            raise TicketError("CPF_INVALIDO")
    return digits


@dataclass(frozen=True)
class Ticket:
    inscricao_id: str
    atividade_id: str
    numero_ticket: int
    status: str


class TicketStore:
    def __init__(self, db_path: str | Path, cpf_hash_key: str):
        if not cpf_hash_key or len(cpf_hash_key) < 16:
            raise ValueError("EVENTHUB_CPF_HASH_KEY precisa ter pelo menos 16 caracteres")
        self.path = str(db_path)
        self.key = cpf_hash_key.encode("utf-8")
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        try:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA busy_timeout=30000")
            yield connection
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS ticket_sequence (
                    atividade_id TEXT PRIMARY KEY,
                    ultimo_ticket INTEGER NOT NULL CHECK (ultimo_ticket >= 0)
                );
                CREATE TABLE IF NOT EXISTS ticket_requests (
                    inscricao_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    atividade_id TEXT NOT NULL,
                    numero_ticket INTEGER NOT NULL CHECK (numero_ticket > 0),
                    cpf_digest TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    payload_fingerprint TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'REGISTRADO',
                    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                    UNIQUE(atividade_id, numero_ticket),
                    UNIQUE(user_id, atividade_id, idempotency_key)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_active_cpf_activity
                  ON ticket_requests(atividade_id, cpf_digest)
                  WHERE status IN ('REGISTRADO','EM_FILA','RESERVADO','EM_VERIFICACAO','CONFIRMADO');
                CREATE INDEX IF NOT EXISTS idx_fifo
                  ON ticket_requests(atividade_id, numero_ticket);
                CREATE INDEX IF NOT EXISTS idx_owned_recent
                  ON ticket_requests(user_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS published_activities (
                    atividade_id TEXT PRIMARY KEY,
                    publication_version INTEGER NOT NULL CHECK (publication_version > 0),
                    verified_at INTEGER NOT NULL
                );
            """)

    def remember_published(self, atividade_id: str, version: int) -> None:
        """Espelha somente publicacao ja confirmada por Eventos no SQLite.

        A sincronizacao de capacidade nao chama este metodo: criar capacidade
        ainda nao significa que a atividade esteja publicada.
        """
        if not atividade_id or version < 1:
            raise TicketError("PUBLICACAO_INVALIDA")
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO published_activities
                   (atividade_id, publication_version, verified_at) VALUES (?,?,?)
                   ON CONFLICT(atividade_id) DO UPDATE SET
                   publication_version=MAX(publication_version,excluded.publication_version),
                   verified_at=excluded.verified_at""",
                (atividade_id, int(version), int(time.time()))
            )

    def forget_published(self, atividade_id: str) -> None:
        """Resposta explicita de nao-publicacao prevalece sobre cache."""
        with self._connect() as connection:
            connection.execute(
                "DELETE FROM published_activities WHERE atividade_id=?", (atividade_id,)
            )

    def recently_published(self, atividade_id: str, max_age_seconds: int = 86400) -> bool:
        """Falha fechada em atividade desconhecida, expirada ou clock retrocedido."""
        if max_age_seconds <= 0:
            return False
        with self._connect() as connection:
            row = connection.execute(
                "SELECT verified_at FROM published_activities WHERE atividade_id=?",
                (atividade_id,)
            ).fetchone()
        if row is None:
            return False
        age = int(time.time()) - int(row["verified_at"])
        return 0 <= age <= min(max_age_seconds, 86400)

    def _digest(self, cpf: str) -> str:
        return hmac.new(self.key, cpf.encode("ascii"), hashlib.sha256).hexdigest()

    @staticmethod
    def _ticket(row: sqlite3.Row) -> Ticket:
        return Ticket(row["inscricao_id"], row["atividade_id"], row["numero_ticket"], row["status"])

    def issue(self, *, user_id: str, atividade_id: str, cpf: str, idempotency_key: str) -> Ticket:
        if not user_id or not atividade_id:
            raise TicketError("IDENTIFICADOR_OBRIGATORIO")
        try:
            if str(uuid.UUID(idempotency_key)) != idempotency_key.lower():
                raise ValueError()
        except (ValueError, TypeError, AttributeError):
            raise TicketError("IDEMPOTENCY_KEY_INVALIDA") from None
        normalized = normalize_cpf(cpf)
        digest = self._digest(normalized)
        fingerprint = hashlib.sha256(json.dumps({
            "atividade_id": atividade_id, "cpf": normalized
        }, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                same_key = connection.execute(
                    """SELECT * FROM ticket_requests
                       WHERE user_id=? AND atividade_id=? AND idempotency_key=?""",
                    (user_id, atividade_id, idempotency_key)
                ).fetchone()
                if same_key:
                    if same_key["payload_fingerprint"] != fingerprint:
                        raise TicketError("CHAVE_REUTILIZADA_COM_DADOS_DIFERENTES")
                    result = self._ticket(same_key)
                    connection.execute("COMMIT")
                    return result
                active = connection.execute(
                    """SELECT inscricao_id FROM ticket_requests
                       WHERE atividade_id=? AND cpf_digest=? AND
                       status IN ('REGISTRADO','EM_FILA','RESERVADO','EM_VERIFICACAO','CONFIRMADO')""",
                    (atividade_id, digest)
                ).fetchone()
                if active:
                    raise TicketError("CPF_JA_INSCRITO")
                connection.execute(
                    """INSERT INTO ticket_sequence (atividade_id, ultimo_ticket)
                       VALUES (?, 1) ON CONFLICT(atividade_id)
                       DO UPDATE SET ultimo_ticket=ultimo_ticket+1""",
                    (atividade_id,)
                )
                numero = connection.execute(
                    "SELECT ultimo_ticket FROM ticket_sequence WHERE atividade_id=?", (atividade_id,)
                ).fetchone()[0]
                ticket_id = str(uuid.uuid4())
                connection.execute(
                    """INSERT INTO ticket_requests
                       (inscricao_id,user_id,atividade_id,numero_ticket,cpf_digest,idempotency_key,payload_fingerprint)
                       VALUES (?,?,?,?,?,?,?)""",
                    (ticket_id,user_id,atividade_id,numero,digest,idempotency_key,fingerprint)
                )
                connection.execute("COMMIT")
                return Ticket(ticket_id, atividade_id, numero, "REGISTRADO")
            except Exception:
                connection.execute("ROLLBACK")
                raise

    def get_owned(self, inscricao_id: str, user_id: str) -> Ticket | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM ticket_requests WHERE inscricao_id=? AND user_id=?",
                (inscricao_id, user_id)
            ).fetchone()
            return self._ticket(row) if row else None

    def list_owned(self, user_id: str, limit: int = 50, offset: int = 0) -> dict:
        """Historico persistente do titular, sem expor CPF/hash ou outros usuarios.

        A leitura usa somente SQLite e permanece disponivel na queda do MySQL.
        O estado pode aguardar a conciliacao do worker.
        """
        if not user_id or not 1 <= limit <= 100 or not 0 <= offset <= 10000:
            raise TicketError("PAGINACAO_INVALIDA")
        with self._connect() as connection:
            total = connection.execute(
                "SELECT COUNT(*) FROM ticket_requests WHERE user_id=?", (user_id,)
            ).fetchone()[0]
            rows = connection.execute(
                """SELECT inscricao_id, atividade_id, numero_ticket, status AS estado, created_at
                   FROM ticket_requests WHERE user_id=?
                   ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?""",
                (user_id, limit, offset),
            ).fetchall()
        return {
            "inscricoes": [dict(row) for row in rows],
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    def pending_for_activity(self, atividade_id: str) -> list[Ticket]:
        """Fila ordenada; NAO concede vagas nem ultrapassa MySQL."""
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT * FROM ticket_requests WHERE atividade_id=?
                   AND status IN ('REGISTRADO','EM_FILA')
                   ORDER BY numero_ticket ASC""",
                (atividade_id,)
            ).fetchall()
            return [self._ticket(row) for row in rows]

    def pending_ingestion(self, limit: int = 200) -> list[dict]:
        """Pedidos ainda nao confirmados localmente; inclui hash, nunca CPF em claro."""
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT inscricao_id, user_id, atividade_id, numero_ticket, cpf_digest
                   FROM ticket_requests WHERE status='REGISTRADO'
                   ORDER BY atividade_id, numero_ticket LIMIT ?""",
                (limit,),
            ).fetchall()
            return [dict(row) for row in rows]

    def reconciliation_candidates(self, limit: int = 500) -> list[Ticket]:
        """Estados ativos para restaurar ACK perdido do MySQL."""
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT * FROM ticket_requests
                   WHERE status IN ('REGISTRADO','EM_FILA','RESERVADO',
                                    'EM_VERIFICACAO','CONFIRMADO')
                   ORDER BY updated_at ASC, atividade_id, numero_ticket LIMIT ?""",
                (limit,),
            ).fetchall()
            return [self._ticket(row) for row in rows]

    def sync_authoritative(self, inscricao_id: str, destination: str) -> Ticket:
        """Concilia salto de estados apos commit MySQL e ACK SQLite perdido.

        O MySQL deve ser consultado por ID antes desta chamada; esta nao e API publica.
        Aceita apenas caminho valido no grafo, nunca regressao de estado.
        """
        if destination not in ACTIVE | TERMINAL:
            raise TicketError("ESTADO_INVALIDO")
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                row = connection.execute(
                    "SELECT * FROM ticket_requests WHERE inscricao_id=?", (inscricao_id,)
                ).fetchone()
                if not row:
                    raise TicketError("TICKET_INEXISTENTE")
                state = row["status"]
                if state != destination:
                    reached, frontier = {state}, [state]
                    while frontier:
                        current = frontier.pop()
                        for future in TRANSITIONS.get(current, ()):
                            if future not in reached:
                                reached.add(future)
                                frontier.append(future)
                    if destination not in reached:
                        raise TicketError("REGRESSAO_DE_ESTADO")
                    connection.execute(
                        """UPDATE ticket_requests SET status=?,
                           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                           WHERE inscricao_id=?""",
                        (destination, inscricao_id),
                    )
                connection.execute("COMMIT")
                return Ticket(row["inscricao_id"], row["atividade_id"],
                              row["numero_ticket"], destination)
            except Exception:
                connection.execute("ROLLBACK")
                raise

    def update_from_worker(self, inscricao_id: str, expected: str, destination: str) -> Ticket:
        """Uso EXCLUSIVO do worker apos validar a transicao no MySQL; nao e endpoint publico."""
        if destination not in TRANSITIONS.get(expected, frozenset()):
            raise TicketError("TRANSICAO_INVALIDA")
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                changed = connection.execute(
                    """UPDATE ticket_requests SET status=?,
                       updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                       WHERE inscricao_id=? AND status=?""",
                    (destination, inscricao_id, expected)
                )
                if changed.rowcount != 1:
                    raise TicketError("ESTADO_DESATUALIZADO")
                row = connection.execute(
                    "SELECT * FROM ticket_requests WHERE inscricao_id=?", (inscricao_id,)
                ).fetchone()
                connection.execute("COMMIT")
                return self._ticket(row)
            except Exception:
                connection.execute("ROLLBACK")
                raise
