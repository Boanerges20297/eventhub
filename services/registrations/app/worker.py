"""Worker unico FIFO do EventHub.

Regras: ticket aceito somente apos commit SQLite; MySQL concede vaga sob
lock por atividade; ACK SQLite pode ser repetido apos crash. Nenhuma
operacao publica ou pedido HTTP existe neste processo.
"""
from __future__ import annotations

import logging
import os
import time
import httpx
from dataclasses import dataclass

from .capacity_store import CapacityError, CapacityStore
from .mysql_connection import connect_mysql
from .ticket_store import TicketStore

LOG = logging.getLogger("eventhub.registrations.worker")


@dataclass(frozen=True)
class CycleResult:
    ingested: int
    reconciled: int
    expired: int
    promoted: int


class RegistrationWorker:
    def __init__(self, queue: TicketStore, capacity: CapacityStore):
        self.queue = queue
        self.capacity = capacity

    def run_once(self) -> CycleResult:
        # Recupera antes de ingerir: commit MySQL pode ter acontecido sem ACK SQLite.
        reconciled = 0
        for local in self.queue.reconciliation_candidates(limit=1000):
            actual = self.capacity.get_status(local.inscricao_id)
            if actual is not None and actual != local.status:
                self.queue.sync_authoritative(local.inscricao_id, actual)
                reconciled += 1

        ingested = 0
        for pending in self.queue.pending_ingestion(limit=200):
            try:
                result = self.capacity.admit_ticket(
                    inscricao_id=pending["inscricao_id"],
                    user_id=pending["user_id"],
                    activity=pending["atividade_id"],
                    numero_ticket=pending["numero_ticket"],
                    cpf_digest=pending["cpf_digest"],
                )
            except CapacityError as error:
                if error.code == "ATIVIDADE_NAO_SINCRONIZADA":
                    # Esperar sincronizacao inicial, sem descartar o ticket.
                    continue
                if error.code == "TICKET_FORA_DE_ORDEM":
                    # Outra instancia pode estar conciliando ticket anterior.
                    continue
                raise
            self.queue.sync_authoritative(result.inscricao_id, result.status)
            ingested += 1

        expired = 0
        for ticket_id in self.capacity.due_expirations(limit=100):
            try:
                changed, _ = self.capacity.finalize(
                    ticket_id, expected="RESERVADO", destination="EXPIRADO"
                )
                if changed:
                    expired += 1
            except CapacityError as error:
                if error.code not in {"ESTADO_DESATUALIZADO", "PRAZO_NAO_EXPIRADO"}:
                    raise

        promoted = 0
        for activity in self.capacity.waiting_activities(limit=100):
            promoted += len(self.capacity.promote_waiting(activity))
        # O proximo ciclo reconcilia os estados promovidos/expirados no SQLite.
        self.deliver_notifications()
        return CycleResult(ingested, reconciled, expired, promoted)

    def deliver_notifications(self) -> None:
        """Entrega at-least-once, sem conexao HTTP durante transacao de vagas."""
        outbox = getattr(self.capacity, "outbox", None)
        if outbox is None:
            return
        secret = os.environ.get("EVENTHUB_INTERNAL_SECRET", "")
        if len(secret) < 48:
            LOG.error("notificacao pendente: segredo interno ausente")
            return
        endpoint = os.environ.get(
            "EVENTHUB_NOTIFICATIONS_URL", "http://notifications:8000"
        ).rstrip("/") + "/internal/entregar"
        for event in outbox.pending(limit=40):
            try:
                response = httpx.post(
                    endpoint, json=event,
                    headers={"x-eventhub-internal-key": secret},
                    timeout=4.0,
                )
                if response.status_code != 200:
                    outbox.retry_later(event["event_id"],
                                       f"HTTP_{response.status_code}")
                    continue
                outbox.acknowledge(event["event_id"])
            except httpx.HTTPError:
                outbox.retry_later(event["event_id"], "REDE_INDISPONIVEL")


def main() -> None:
    logging.basicConfig(
        level=os.getenv("EVENTHUB_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    queue = TicketStore(
        os.environ["EVENTHUB_SQLITE_PATH"],
        os.environ["EVENTHUB_CPF_HASH_KEY"],
    )
    service = RegistrationWorker(queue, CapacityStore(connect_mysql, enable_outbox=True))
    interval = max(1.0, float(os.getenv("EVENTHUB_WORKER_INTERVAL_SECONDS", "2")))
    LOG.info("worker iniciado; fila persistente ativa")
    while True:
        try:
            result = service.run_once()
            if any((result.ingested, result.reconciled,
                    result.expired, result.promoted)):
                LOG.info("ciclo: ingeridos=%d conciliados=%d expirados=%d promovidos=%d",
                         result.ingested, result.reconciled,
                         result.expired, result.promoted)
        except Exception as error:
            # Sem log de dados pessoais, senha de banco ou payload.
            LOG.error("ciclo falhou; tentara novamente: tipo=%s",
                      type(error).__name__)
        time.sleep(interval)


if __name__ == "__main__":
    main()
