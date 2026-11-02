# Inscricoes - EventHub

## Responsabilidades
- SQLite: tickets duraveis, sequencia FIFO unica por atividade, fallback em falhas.
- MySQL/InnoDB: capacidade operacional, ocupacao e reservas com transacao na linha da atividade.
- sql/001_initial.sql: migracao EXCLUSIVA da base eventhub_inscricoes. Nao executar em outras bases.

## Ambiente STI diagnosticado (02/11/2026)
- MySQL iniciado pelo XAMPP, executavel C:/xampp/mysql/bin/mysqld.exe e porta TCP 127.0.0.1:3306.
- Cliente MySQL do XAMPP: 8.4.13.
- Conexao root sem senha recusada, como esperado.
- Nenhuma tabela ou privilegio do servidor foi alterado durante esta verificacao.

## Seguranca e configuracao
- Copiar .env.example para .env apenas no computador de desenvolvimento.
- Banco isolado: eventhub_inscricoes; usuario nao privilegiado: eventhub_registrations.
- As variaveis EVENTHUB_MYSQL_* precisam estar no ambiente do processo; o modulo de conexao nao carrega .env automaticamente.
- Nao reaproveitar usuario ou senha de outros bancos e nunca inserir segredos no repositorio.
- Falta confirmar provisionamento da conta EventHub antes da integracao InnoDB.

## Testes locais
Da raiz do repositorio:
    python -m unittest discover -s services/registrations/tests -v

O emissor SQLite foi testado em disco com 100 chamadas paralelas. Os testes de capacidade usam
regras puras e cursor DB-API simulado: NAO comprovam migracao, locks ou concorrencia InnoDB.

## Provas obrigatorias apos a conta de desenvolvimento estar configurada
- Rodar migracao em eventhub_inscricoes e verificar engine InnoDB.
- Concorrencia de 200 pedidos / 30 vagas sem overbooking e FIFO demonstravel.
- Alteracao de capacidade concorrente, idempotencia de operation_id e retry apos falha.
- Queda apos commit MySQL antes do ACK SQLite, sem duplicacao.
- Recusa e expiracao definitivas promovem proximo ticket; incerteza protege vaga.
