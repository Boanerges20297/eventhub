# EventHub — Roteiro de demonstração e homologação local

Data prevista: **13/11/2026**. Ambiente: notebook Windows, Docker Compose **eventhub**. Uso acadêmico e desenvolvimento, sem publicação externa.

## Entrada e contas
- Acesse **http://127.0.0.1:8088** no próprio notebook, somente após conferir os containers.
- Consulte as nove contas e senhas no arquivo **docs/TESTE_MOCK_ACESSOS_LOCAL.md**, privado e ignorado pelo Git.
- Administração: `admin.demo@eventhub.test`.
- Organizadores: `organizador.ana@eventhub.test` (Academia) e `organizador.bruno@eventhub.test` (Comunidade).
- Participantes: `cliente.01@eventhub.test` até `cliente.06@eventhub.test`.
- Entrar com e-mail e senha; a etapa de **OTP simulado local** oferece **Preencher código de teste** e **Confirmar OTP**. Marcar dispositivo confiável é opcional. Fazer logout ao mudar de conta.

## Passos sugeridos — executar um de cada vez
1. **Anônimo:** abrir tela de entrada, conferir acesso a catálogo e opção de cadastro, sem painel privado.
2. **Administrador:** entrar com a conta admin, concluir OTP, confirmar painel e opções de gerenciamento de organizações.
3. **Organizador A:** sair do admin, entrar como Ana, abrir **Organizar**, listar eventos e atividades da própria organização, consultar capacidade e inscrições.
4. **Organizador B:** sair, entrar como Bruno, confirmar que os dados de Ana não estão disponíveis; testar isolamento de organização, sem alterar dados.
5. **Participante:** sair, entrar como cliente.01, abrir **Explorar eventos** e **Minhas inscrições**, observar tickets e notificações.
6. **Inscrição e fila:** usar uma atividade fictícia previamente provisionada, conferir estados `RESERVADO`, `EM_FILA` e promoção sem overbooking; atenção à autoridade exclusiva do MySQL para ocupação.
7. **Pagamento:** somente simular aceite, recusa ou indeterminação; **não existe cobrança financeira real**.
8. **Segurança:** registrar OTP e sessão HttpOnly, CSRF, RBAC, isolamento por recurso, bloqueio após três erros e rate limiting (não forçar bloqueios das contas de demo).
9. **Encerramento:** logout, confirmar retorno à tela pública e finalizar a apresentação com o diagrama de comunicação e o checkpoint de testes.

## Evidências e limitações
- Evidências de 12 verificações integradas de autenticação/segurança, oito testes Node e seis fluxos E2E no checkpoint `CHECKPOINT_INTEGRACAO_SECURITY_2026-11-12.md`.
- MySQL/InnoDB é autoridade de ocupação; SQLite guarda tickets duráveis; Gateway controla entrada e autenticação, com serviços isolados.
- OTP, pagamentos e notificações são **simulados**. Ainda não há SMTP, adquirente real, check-in, certificados nem implantação pública.
- Os limites de segurança permanecem habilitados. Após três senhas incorretas a conta pode ficar bloqueada; quatro cadastros por dez minutos a partir do mesmo IP podem disparar HTTP 429.
- O arquivo com senhas e o JSON `.demo-credentials.local.json` **nunca devem ser commitados**.

## Comandos seguros no notebook
```powershell
cd "$HOME\Desktop\Projetos\EventHub"
git status --short --branch
docker compose ps
Invoke-WebRequest http://127.0.0.1:8088/ -UseBasicParsing
Invoke-RestMethod http://127.0.0.1:8088/api/health
```

Para regenerar somente a massa sintética — e **trocar todas as senhas** — usar `.\scripts\seed-demo.ps1` exclusivamente se necessário. Evitar durante a demonstração. Nunca executar `docker compose down -v`.

## Critério para dizer "pronto"
Somente declarar uma etapa **validada** depois de executá-la no navegador com a conta correspondente, observar o estado na interface e confirmar o resultado. Manter checkpoint técnico separado da homologação visual.
