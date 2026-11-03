"""Prova de integracao LOCAL contra MySQL/InnoDB e SQLite reais.

Executar APENAS pelo container registrations (variaveis de banco isolado presentes).
Gera atividade descartavel com identificador unico e 200 CPFs sinteticos.
Nao altera outros bancos nem remove dados; guarda evidencias da execucao.
"""
from __future__ import annotations

import os
import sys
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, "/app")

from app.capacity_store import CapacityStore
from app.mysql_connection import connect_mysql
from app.ticket_store import TicketStore


def fake_valid_cpf(index: int) -> str:
    digits = f"{1000 + index:09d}"
    for size in (9, 10):
        digit = sum(int(digits[i]) * (size + 1 - i) for i in range(size))
        digit = (digit * 10) % 11
        digits += str(0 if digit == 10 else digit)
    return digits


def main() -> None:
    activity = "integration-" + uuid.uuid4().hex[:16]
    capacity = CapacityStore(connect_mysql)
    op = str(uuid.uuid4())
    initial = capacity.apply_capacity(
        activity=activity, operation_id=op, expected_version=0,
        target_version=1, capacity=30, waitlist=True,
        hold_minutes=30, paid=True
    )
    assert initial.result == "APLICADA"
    queue = TicketStore(
        os.environ["EVENTHUB_SQLITE_PATH"],
        os.environ["EVENTHUB_CPF_HASH_KEY"],
    )

    def submit(index: int):
        cpf = fake_valid_cpf(index)
        ticket = queue.issue(
            user_id=f"test-user-{index}",
            atividade_id=activity,
            cpf=cpf,
            idempotency_key=str(uuid.uuid4()),
        )
        return ticket, index, cpf

    with ThreadPoolExecutor(max_workers=20) as pool:
        issued = list(pool.map(submit, range(200)))

    issued.sort(key=lambda item: item[0].numero_ticket)
    assert [t.numero_ticket for t, _, _ in issued] == list(range(1, 201))
    status_counts = Counter()

    for ticket, index, cpf in issued:
        result = capacity.admit_ticket(
            inscricao_id=ticket.inscricao_id,
            user_id=f"test-user-{index}",
            activity=activity,
            numero_ticket=ticket.numero_ticket,
            cpf_digest=queue._digest(cpf),
        )
        assert result.status in {"RESERVADO", "EM_FILA"}
        queue.update_from_worker(ticket.inscricao_id, "REGISTRADO", result.status)
        status_counts[result.status] += 1
        if ticket.numero_ticket in (1, 30, 31, 200):
            replay = capacity.admit_ticket(
                inscricao_id=ticket.inscricao_id,
                user_id=f"test-user-{index}",
                activity=activity,
                numero_ticket=ticket.numero_ticket,
                cpf_digest=queue._digest(cpf),
            )
            assert replay == result

    assert status_counts == Counter({"RESERVADO": 30, "EM_FILA": 170}), status_counts

    conn = connect_mysql()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """SELECT status, COUNT(*) AS total FROM registrations
                   WHERE atividade_id=%s GROUP BY status""",
                (activity,),
            )
            mysql_counts = {row["status"]: row["total"] for row in cursor.fetchall()}
    finally:
        conn.close()
    assert mysql_counts == dict(status_counts), mysql_counts

    rejected = capacity.apply_capacity(
        activity=activity, operation_id=str(uuid.uuid4()),
        expected_version=1, target_version=2, capacity=29,
        waitlist=True, hold_minutes=30, paid=True,
    )
    assert rejected.result == "REJEITADA"
    assert rejected.reason == "CAPACIDADE_INSUFICIENTE"

    repeated = capacity.apply_capacity(
        activity=activity, operation_id=op,
        expected_version=0, target_version=1, capacity=30,
        waitlist=True, hold_minutes=30, paid=True,
    )
    assert repeated == initial
    print(
        "REAL_INTEGRATION_OK "
        f"activity={activity} tickets=200 reserved={status_counts['RESERVADO']} "
        f"waiting={status_counts['EM_FILA']} "
        "no_overbooking=true fifo=true idempotency=true "
        "capacity_reduction_rejected=true"
    )


if __name__ == "__main__":
    main()
