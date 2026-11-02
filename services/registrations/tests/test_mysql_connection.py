import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.mysql_connection import connect_mysql


class MySQLConnectionSafetyTest(unittest.TestCase):
    def test_refuses_another_database(self):
        with patch.dict(os.environ, {
            "EVENTHUB_MYSQL_DATABASE": "controlep4",
            "EVENTHUB_MYSQL_USER": "eventhub_registrations",
            "EVENTHUB_MYSQL_PASSWORD": "sample-not-real",
        }):
            with self.assertRaisesRegex(RuntimeError, "BANCO_INCORRETO"):
                connect_mysql()

    def test_requires_app_credentials(self):
        with patch.dict(os.environ, {
            "EVENTHUB_MYSQL_DATABASE": "eventhub_inscricoes",
            "EVENTHUB_MYSQL_USER": "",
            "EVENTHUB_MYSQL_PASSWORD": "",
        }):
            with self.assertRaisesRegex(RuntimeError, "CREDENCIAIS_EVENTHUB_NAO_CONFIGURADAS"):
                connect_mysql()

    def test_refuses_root_connection(self):
        with patch.dict(os.environ, {
            "EVENTHUB_MYSQL_DATABASE": "eventhub_inscricoes",
            "EVENTHUB_MYSQL_USER": "root",
            "EVENTHUB_MYSQL_PASSWORD": "sample-not-real",
        }):
            with self.assertRaisesRegex(RuntimeError, "USUARIO_PRIVILEGIADO_NAO_PERMITIDO"):
                connect_mysql()


if __name__ == "__main__":
    unittest.main()
