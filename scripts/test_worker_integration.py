"""Integracao real: worker automatico, fila FIFO, recusa, cancelamento, expiracao.

Executar no container registrations, com registrations-worker ativo.
Usa atividade sintetica unica na base isolada, sem limpar dados.
"""
from __future__ import annotations

import os
import time
import uuid

from app.capacity_store import CapacityStore
from app.mysql_connection import connect_mysql
from app.ticket_store import TicketStore


def cpf(seed: int) -> str:
    result = f"{seed + 3000:09d}"
    for length in (9, 10):
        check = sum(int(result[i]) * (length + 1 - i) for i in range(length))
        check = check * 10 % 11
        result += str(0 if check == 10 else check)
    return result


def poll(expected: dict[str, str], capacity: CapacityStore, *, seconds: int = 30) -> None:
    deadline = time.monotonic() + seconds
    last = {}
    while time.monotonic() < deadline:
        last = {ticket_id: capacity.get_status(ticket_id) for ticket_id in expected}
        if last == expected:
            return
        time.sleep(0.5)
    raise AssertionError(f"Estados MySQL diferentes do esperado: {last} vs {expected}")


def poll_local(queue: TicketStore, expected: dict[str, tuple[str, str]], seconds=30):
    deadline = time.monotonic() + seconds
    last = {}
    while time.monotonic() < deadline:
        last = {
            ticket_id: (queue.get_owned(ticket_id, user_id).status
                        if queue.get_owned(ticket_id, user_id) else None)
            for ticket_id, (user_id, _) in expected.items()
        }
        if all(last[tid] == status for tid, (_, status) in expected.items()):
            return
        time.sleep(0.5)
    raise AssertionError(f"SQLite nao convergiu: {last} vs {expected}")


def main() -> None:
    activity = "worker-" + uuid.uuid4().hex[:18]
    store = CapacityStore(connect_mysql)
    queue = TicketStore(
        os.environ["EVENTHUB_SQLITE_PATH"],
        os.environ["EVENTHUB_CPF_HASH_KEY"],
    )
    start = store.apply_capacity(
        activity=activity, operation_id=str(uuid.uuid4()),
        expected_version=0, target_version=1, capacity=2,
        waitlist=True, hold_minutes=30, paid=True
    )
    assert start.result == "APLICADA"

    tickets = []
    for number in range(4):
        ticket = queue.issue(
            user_id=f"worker-test-{number}", atividade_id=activity,
            cpf=cpf(number), idempotency_key=str(uuid.uuid4()),
        )
        tickets.append(ticket)
    poll({
        tickets[0].inscricao_id: "RESERVADO",
        tickets[1].inscricao_id: "RESERVADO",
        tickets[2].inscricao_id: "EM_FILA",
        tickets[3].inscricao_id: "EM_FILA",
    }, store)

    # Primeira recusa definitiva libera imediatamente e promove ticket 3.
    released, promoted = store.finalize(
        tickets[0].inscricao_id, expected="RESERVADO", destination="RECUSADO"
    )
    assert released and [t.numero_ticket for t in promoted] == [3], promoted
    poll_local(queue, {
        tickets[0].inscricao_id: ("worker-test-0", "RECUSADO"),
        tickets[2].inscricao_id: ("worker-test-2", "RESERVADO"),
    })

    # Cancelamento libera ticket 4, dentro da mesma transacao MySQL.
    released2, promoted2 = store.finalize(
        tickets[1].inscricao_id, expected="RESERVADO", destination="CANCELADO"
    )
    assert released2 and [t.numero_ticket for t in promoted2] == [4], promoted2
    same, promoted_again = store.finalize(
        tickets[1].inscricao_id, expected="RESERVADO", destination="CANCELADO"
    )
    assert not same and not promoted_again
    poll_local(queue, {
        tickets[1].inscricao_id: ("worker-test-1", "CANCELADO"),
        tickets[3].inscricao_id: ("worker-test-3", "RESERVADO"),
    })

    # Depois da recusa definitiva, reinscricao usa novo ticket no FIM da fila.
    fifth = queue.issue(
        user_id="worker-test-0", atividade_id=activity,
        cpf=cpf(0), idempotency_key=str(uuid.uuid4())
    )
    assert fifth.numero_ticket == 5
    poll({fifth.inscricao_id: "EM_FILA"}, store)

    # Expiracao real (UTC) detectada automaticamente, sem expirar EM_VERIFICACAO.
    conn = connect_mysql()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """UPDATE registrations
                   SET reserva_expira_em=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 MINUTE)
                   WHERE inscricao_id=%s AND status='RESERVADO'""",
                (tickets[2].inscricao_id,),
            )
            assert cursor.rowcount == 1
        conn.commit()
    finally:
        conn.close()
    poll({
        tickets[2].inscricao_id: "EXPIRADO",
        fifth.inscricao_id: "RESERVADO",
        tickets[3].inscricao_id: "RESERVADO",
    }, store)
    poll_local(queue, {
        tickets[2].inscricao_id: ("worker-test-2", "EXPIRADO"),
        fifth.inscricao_id: ("worker-test-0", "RESERVADO"),
    })
    conn = connect_mysql()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """SELECT COUNT(*) AS n FROM registrations WHERE atividade_id=%s
                   AND status IN ('RESERVADO','EM_VERIFICACAO','CONFIRMADO')""",
                (activity,),
            )
            assert int(cursor.fetchone()["n"]) == 2
    finally:
        conn.close()
    print("WORKER_INTEGRATION_OK",
          f"activity={activity} submitted=5 capacity=2",
          "initial_waiting=2 refusal_promoted=3 cancellation_promoted=4",
          "expiration_promoted=5 replay_idempotent=true",
          "sqlite_mysql_converged=true overbooking=false")


if __name__ == "__main__":
    main()
