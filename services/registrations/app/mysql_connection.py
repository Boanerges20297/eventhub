"""Conexao MySQL para a base EXCLUSIVA do servico Inscricoes.

Nao carrega credenciais de outros projetos e nunca publica segredos em logs.
A migracao SQL so deve rodar apos configurar usuario de baixo privilegio.
"""
from __future__ import annotations

import os


def connect_mysql():
    host = os.getenv("EVENTHUB_MYSQL_HOST", "127.0.0.1")
    port = int(os.getenv("EVENTHUB_MYSQL_PORT", "3306"))
    database = os.getenv("EVENTHUB_MYSQL_DATABASE", "eventhub_inscricoes")
    username = os.getenv("EVENTHUB_MYSQL_USER", "")
    password = os.getenv("EVENTHUB_MYSQL_PASSWORD", "")
    if database != "eventhub_inscricoes":
        raise RuntimeError("BANCO_INCORRETO: permitido apenas eventhub_inscricoes")
    if not username or not password:
        raise RuntimeError("CREDENCIAIS_EVENTHUB_NAO_CONFIGURADAS")
    if username.lower() in {"root", "admin"}:
        raise RuntimeError("USUARIO_PRIVILEGIADO_NAO_PERMITIDO")
    import pymysql
    return pymysql.connect(
        host=host, port=port, user=username, password=password, database=database,
        charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
        autocommit=False, connect_timeout=5, read_timeout=10, write_timeout=10
    )
