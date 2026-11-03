"""Capacidade e fila FIFO com transacoes MySQL/InnoDB para Inscricoes.

A instancia SQL e exclusiva deste servico. A linha activity_capacity sempre e
bloqueada primeiro, inclusive na concessao e na alteracao de capacidade.
Nao importa nem utiliza bancos de Eventos ou Pagamentos.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Callable, Iterator

OCCUPIED = ("RESERVADO", "EM_VERIFICACAO", "CONFIRMADO")


class CapacityError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class CapacityResult:
    operation_id: str
    result: str
    version: int
    capacity: int
    reason: str | None = None


@dataclass(frozen=True)
class GrantResult:
    inscricao_id: str
    atividade_id: str
    numero_ticket: int
    status: str


def decide_admission(*, ocupadas: int, capacidade: int,
                     fila_habilitada: bool, ha_anterior_na_fila: bool,
                     paga: bool) -> str:
    """Regra pura: nenhuma concessao ignora quem espera ha mais tempo."""
    if min(ocupadas, capacidade) < 0:
        raise CapacityError("CAPACIDADE_INVALIDA")
    if ocupadas > capacidade:
        raise CapacityError("OCUPACAO_INCONSISTENTE")
    if ha_anterior_na_fila or ocupadas == capacidade:
        return "EM_FILA" if fila_habilitada else "SEM_VAGA"
    return "RESERVADO" if paga else "CONFIRMADO"


def evaluate_capacity(*, desired: int, committed: int) -> str | None:
    if desired < 0:
        raise CapacityError("CAPACIDADE_INVALIDA")
    if committed < 0:
        raise CapacityError("OCUPACAO_INCONSISTENTE")
    return "CAPACIDADE_INSUFICIENTE" if desired < committed else None


class CapacityStore:
    """Recebe fabrica de conexoes DB-API MySQL com DictCursor e autocommit=False."""

    def __init__(self, connect: Callable[[], Any]):
        self.connect = connect

    @contextmanager
    def _transaction(self) -> Iterator[Any]:
        connection = self.connect()
        try:
            cursor = connection.cursor()
            try:
                yield cursor
                connection.commit()
            finally:
                cursor.close()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _occupancy(cursor: Any, activity: str) -> int:
        cursor.execute(
            "SELECT COUNT(*) AS n FROM registrations WHERE atividade_id=%s "
            "AND status IN ('RESERVADO','EM_VERIFICACAO','CONFIRMADO')",
            (activity,)
        )
        return int(cursor.fetchone()["n"])

    @staticmethod
    def _capacity_row(cursor: Any, activity: str) -> dict | None:
        cursor.execute(
            "SELECT * FROM activity_capacity WHERE atividade_id=%s FOR UPDATE",
            (activity,)
        )
        return cursor.fetchone()

    @staticmethod
    def _existing_operation(cursor: Any, operation_id: str) -> dict | None:
        cursor.execute(
            "SELECT * FROM capacity_operations WHERE operation_id=%s FOR UPDATE",
            (operation_id,)
        )
        return cursor.fetchone()

    def apply_capacity(self, *, activity: str, operation_id: str,
                       expected_version: int, target_version: int,
                       capacity: int, waitlist: bool, hold_minutes: int,
                       paid: bool) -> CapacityResult:
        if not activity or not operation_id or not (1 <= hold_minutes <= 1440):
            raise CapacityError("DADOS_INVALIDOS")
        if expected_version < 0 or target_version != expected_version + 1:
            raise CapacityError("VERSAO_INVALIDA")
        if capacity < 0:
            raise CapacityError("CAPACIDADE_INVALIDA")
        with self._transaction() as cursor:
            previous = self._existing_operation(cursor, operation_id)
            if previous:
                if (previous["atividade_id"] != activity
                    or int(previous["expected_version"]) != expected_version
                    or int(previous["target_version"]) != target_version
                    or int(previous["desired_capacity"]) != capacity
                    or bool(previous["lista_espera_habilitada"]) != waitlist
                    or int(previous["prazo_reserva_min"]) != hold_minutes
                    or bool(previous["atividade_paga"]) != paid):
                    raise CapacityError("OPERACAO_REUTILIZADA_COM_DADOS_DIFERENTES")
                return CapacityResult(
                    operation_id, previous["result"], int(previous["applied_version"]),
                    int(previous["effective_capacity"]), previous["reason"]
                )

            row = self._capacity_row(cursor, activity)
            current_version = int(row["version"]) if row else 0
            current_capacity = int(row["capacity"]) if row else 0
            reason = None
            if expected_version != current_version:
                reason = "VERSAO_DESATUALIZADA"
            elif row and (
                bool(row["lista_espera_habilitada"]) != waitlist
                or int(row["prazo_reserva_min"]) != hold_minutes
                or bool(row["atividade_paga"]) != paid
            ):
                # O contrato de alteracao de capacidade nao altera a politica.
                reason = "POLITICA_DIVERGENTE"
            elif row:
                reason = evaluate_capacity(
                    desired=capacity, committed=self._occupancy(cursor, activity)
                )

            if not reason:
                if row:
                    cursor.execute(
                        """UPDATE activity_capacity SET capacity=%s, version=%s
                           WHERE atividade_id=%s""",
                        (capacity, target_version, activity)
                    )
                else:
                    cursor.execute(
                        """INSERT INTO activity_capacity
                           (atividade_id,capacity,version,lista_espera_habilitada,
                            prazo_reserva_min,atividade_paga)
                           VALUES (%s,%s,%s,%s,%s,%s)""",
                        (activity, capacity, target_version, waitlist, hold_minutes, paid)
                    )
                current_version, current_capacity = target_version, capacity
            result = "REJEITADA" if reason else "APLICADA"
            cursor.execute(
                """INSERT INTO capacity_operations
                   (operation_id,atividade_id,expected_version,target_version,
                    desired_capacity,lista_espera_habilitada,prazo_reserva_min,
                    atividade_paga,result,reason,applied_version,effective_capacity)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (operation_id, activity, expected_version, target_version,
                 capacity, waitlist, hold_minutes, paid,
                 result, reason, current_version, current_capacity)
            )
            return CapacityResult(
                operation_id, result, current_version, current_capacity, reason
            )

    def get_status(self, inscricao_id: str) -> str | None:
        """Consulta de reconciliacao; nao altera nenhum recurso."""
        with self._transaction() as cursor:
            cursor.execute(
                "SELECT status FROM registrations WHERE inscricao_id=%s",
                (inscricao_id,),
            )
            row = cursor.fetchone()
            return row["status"] if row else None

    @staticmethod
    def _promote_locked(cursor: Any, settings: dict) -> list[GrantResult]:
        """Exige lock na linha da atividade. Todos os participantes usam mesmo lock."""
        activity = settings["atividade_id"]
        free = int(settings["capacity"]) - CapacityStore._occupancy(cursor, activity)
        if free < 0:
            raise CapacityError("OCUPACAO_INCONSISTENTE")
        promoted = []
        for _ in range(min(free, 1000)):
            cursor.execute(
                """SELECT inscricao_id,numero_ticket FROM registrations
                   WHERE atividade_id=%s AND status='EM_FILA'
                   ORDER BY numero_ticket LIMIT 1 FOR UPDATE""",
                (activity,),
            )
            first = cursor.fetchone()
            if not first:
                break
            paid = bool(settings["atividade_paga"])
            status = "RESERVADO" if paid else "CONFIRMADO"
            cursor.execute(
                """UPDATE registrations SET status=%s, granted_at=UTC_TIMESTAMP(6),
                   reserva_expira_em=CASE WHEN %s THEN DATE_ADD(UTC_TIMESTAMP(6),
                   INTERVAL %s MINUTE) ELSE NULL END
                   WHERE inscricao_id=%s AND status='EM_FILA'""",
                (status, paid, int(settings["prazo_reserva_min"]), first["inscricao_id"]),
            )
            if cursor.rowcount != 1:
                raise CapacityError("FILA_ALTERADA")
            promoted.append(GrantResult(
                first["inscricao_id"], activity, int(first["numero_ticket"]), status
            ))
        return promoted

    def promote_waiting(self, activity: str) -> list[GrantResult]:
        """Repara vagas abertas e promove exclusivamente pela ordem FIFO."""
        with self._transaction() as cursor:
            settings = self._capacity_row(cursor, activity)
            if not settings:
                raise CapacityError("ATIVIDADE_NAO_SINCRONIZADA")
            return self._promote_locked(cursor, settings)

    def finalize(self, inscricao_id: str, *, expected: str, destination: str
                 ) -> tuple[bool, list[GrantResult]]:
        """Transicao definitiva e liberacao atomica da vaga, seguida de FIFO.

        A confirmacao de resultado de pagamento so pode chamar isto apos
        autenticacao/autorizacao interna. Nao expor diretamente por HTTP.
        """
        transitions = {
            "RESERVADO": {"CANCELADO", "RECUSADO", "EXPIRADO"},
            "CONFIRMADO": {"CANCELADO"},
            "EM_FILA": {"CANCELADO"},
        }
        if destination not in transitions.get(expected, set()):
            raise CapacityError("FINALIZACAO_INVALIDA")
        # Resolver a atividade em uma transacao de leitura separada evita
        # criar um snapshot REPEATABLE READ antes do lock de capacidade.
        # A transacao decisoria comeca travando activity_capacity.
        with self._transaction() as cursor:
            cursor.execute(
                "SELECT atividade_id FROM registrations WHERE inscricao_id=%s",
                (inscricao_id,),
            )
            found = cursor.fetchone()
            if not found:
                raise CapacityError("INSCRICAO_INEXISTENTE")
            activity = found["atividade_id"]
        with self._transaction() as cursor:
            settings = self._capacity_row(cursor, activity)
            if not settings:
                raise CapacityError("ATIVIDADE_NAO_SINCRONIZADA")
            cursor.execute(
                "SELECT status, reserva_expira_em FROM registrations "
                "WHERE inscricao_id=%s FOR UPDATE", (inscricao_id,),
            )
            state = cursor.fetchone()
            if state["status"] == destination:
                return False, []
            if state["status"] != expected:
                raise CapacityError("ESTADO_DESATUALIZADO")
            if destination == "EXPIRADO":
                cursor.execute(
                    """UPDATE registrations SET status=%s
                       WHERE inscricao_id=%s AND status='RESERVADO'
                       AND reserva_expira_em IS NOT NULL
                       AND reserva_expira_em <= UTC_TIMESTAMP(6)""",
                    (destination, inscricao_id),
                )
                if cursor.rowcount != 1:
                    raise CapacityError("PRAZO_NAO_EXPIRADO")
            else:
                cursor.execute(
                    "UPDATE registrations SET status=%s WHERE inscricao_id=%s",
                    (destination, inscricao_id),
                )
            return True, self._promote_locked(cursor, settings)

    def waiting_activities(self, limit: int = 100) -> list[str]:
        """Candidatas a promocao quando uma vaga for liberada ou capacidade subir."""
        with self._transaction() as cursor:
            cursor.execute(
                """SELECT DISTINCT atividade_id FROM registrations
                   WHERE status='EM_FILA' LIMIT %s""",
                (limit,),
            )
            return [row["atividade_id"] for row in cursor.fetchall()]

    def due_expirations(self, limit: int = 50) -> list[str]:
        """Identifica candidatos. finalize revalida prazo sob lock de atividade."""
        with self._transaction() as cursor:
            cursor.execute(
                """SELECT inscricao_id FROM registrations
                   WHERE status='RESERVADO' AND reserva_expira_em<=UTC_TIMESTAMP(6)
                   ORDER BY reserva_expira_em LIMIT %s""",
                (limit,),
            )
            return [row["inscricao_id"] for row in cursor.fetchall()]

    def admit_ticket(self, *, inscricao_id: str, user_id: str,
                     activity: str, numero_ticket: int, cpf_digest: str) -> GrantResult:
        """Importa ticket duravel do SQLite em ordem e concede somente se elegivel.

        Se o MySQL confirmar e a marcacao no SQLite falhar, repetir o mesmo
        inscricao_id devolve o resultado gravado sem ocupar outra vaga.
        """
        if (not inscricao_id or not user_id or not activity
            or numero_ticket <= 0 or len(cpf_digest) != 64
            or any(c not in "0123456789abcdef" for c in cpf_digest)):
            raise CapacityError("TICKET_INVALIDO")
        with self._transaction() as cursor:
            settings = self._capacity_row(cursor, activity)
            if not settings:
                raise CapacityError("ATIVIDADE_NAO_SINCRONIZADA")
            cursor.execute(
                "SELECT * FROM registrations WHERE inscricao_id=%s FOR UPDATE",
                (inscricao_id,)
            )
            previous = cursor.fetchone()
            if previous:
                if (previous["atividade_id"] != activity
                    or int(previous["numero_ticket"]) != numero_ticket
                    or previous["user_id"] != user_id
                    or previous["cpf_digest"] != cpf_digest):
                    raise CapacityError("TICKET_REUTILIZADO_COM_DADOS_DIFERENTES")
                return GrantResult(
                    inscricao_id, activity, numero_ticket, previous["status"]
                )
            if numero_ticket != int(settings["last_ingested_ticket"]) + 1:
                raise CapacityError("TICKET_FORA_DE_ORDEM")
            cursor.execute(
                """SELECT numero_ticket FROM registrations
                   WHERE atividade_id=%s AND status='EM_FILA'
                   ORDER BY numero_ticket LIMIT 1""",
                (activity,)
            )
            waiting = cursor.fetchone() is not None
            status = decide_admission(
                ocupadas=self._occupancy(cursor, activity),
                capacidade=int(settings["capacity"]),
                fila_habilitada=bool(settings["lista_espera_habilitada"]),
                ha_anterior_na_fila=waiting,
                paga=bool(settings["atividade_paga"])
            )
            paid = status == "RESERVADO"
            cursor.execute(
                """INSERT INTO registrations
                   (inscricao_id,user_id,atividade_id,numero_ticket,cpf_digest,status,
                    granted_at,reserva_expira_em)
                   VALUES (%s,%s,%s,%s,%s,%s,
                           CASE WHEN %s THEN UTC_TIMESTAMP(6) ELSE NULL END,
                           CASE WHEN %s THEN DATE_ADD(UTC_TIMESTAMP(6),
                                INTERVAL %s MINUTE) ELSE NULL END)""",
                (inscricao_id,user_id,activity,numero_ticket,cpf_digest,status,
                 status in ("CONFIRMADO", "RESERVADO"),
                 paid, int(settings["prazo_reserva_min"]))
            )
            cursor.execute(
                "UPDATE activity_capacity SET last_ingested_ticket=%s WHERE atividade_id=%s",
                (numero_ticket, activity)
            )
            return GrantResult(inscricao_id, activity, numero_ticket, status)
