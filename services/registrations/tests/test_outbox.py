"""Teste isolado do contrato Outbox; MySQL real verificado em E2E."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.outbox import RegistrationOutbox


class Cursor:
    def __init__(self,results=None):
        self.sql=[]
        self.results=list(results or [])
    def execute(self,query,args=()):
        self.sql.append((query,args))
    def fetchall(self):
        return self.results
    def __enter__(self):
        return self
    def __exit__(self,*_):
        pass


class Connection:
    def __init__(self,results=None):
        self.cur=Cursor(results)
        self.committed=False
        self.rolled_back=False
        self.closed=False
    def cursor(self):
        return self.cur
    def commit(self):
        self.committed=True
    def rollback(self):
        self.rolled_back=True
    def close(self):
        self.closed=True


class OutboxTest(unittest.TestCase):
    def test_append_does_not_include_cpf_or_network(self):
        cursor=Cursor()
        RegistrationOutbox.append_locked(
            cursor,inscricao_id="i",user_id="u",status="RESERVADO")
        self.assertEqual(len(cursor.sql),1)
        statement,args=cursor.sql[0]
        self.assertIn("ON DUPLICATE KEY UPDATE",statement)
        self.assertEqual(args[1:],("i","u","RESERVADO"))
        self.assertEqual(len(args[0]),36)

    def test_schema_created_once_and_not_during_business_commit(self):
        calls=[]
        def connect():
            connection=Connection()
            calls.append(connection)
            return connection
        outbox=RegistrationOutbox(connect)
        outbox.ensure_schema()
        outbox.ensure_schema()
        self.assertEqual(len(calls),1)
        self.assertTrue(calls[0].committed)
        self.assertIn("CREATE TABLE IF NOT EXISTS registration_outbox",
                      calls[0].cur.sql[0][0])

    def test_pending_read_and_ack(self):
        calls=[]
        def connect():
            conn=Connection([{"event_id":"event-1","status":"CONFIRMADO"}])
            calls.append(conn)
            return conn
        outbox=RegistrationOutbox(connect)
        outbox.ready=True
        self.assertEqual(len(outbox.pending(limit=3)),1)
        outbox.acknowledge("event-1")
        self.assertEqual(len(calls),2)
        self.assertEqual(calls[1].cur.sql[0][1],("event-1",))
        self.assertIn("delivered_at=UTC_TIMESTAMP",calls[1].cur.sql[0][0])

    def test_retry_records_backoff(self):
        conn=Connection()
        outbox=RegistrationOutbox(lambda:conn)
        outbox.ready=True
        outbox.retry_later("event-2","REDE_INDISPONIVEL")
        sql,args=conn.cur.sql[0]
        self.assertIn("retry_at=DATE_ADD",sql)
        self.assertEqual(args,("REDE_INDISPONIVEL","event-2"))
        self.assertTrue(conn.committed)


if __name__=="__main__":
    unittest.main()
