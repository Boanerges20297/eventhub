# EventHub — Cadastro, papéis e massa de demonstração

> Escopo: demonstração local no notebook (Docker Compose, interface em `http://127.0.0.1:8088`). **Não utilizar em produção.**

## Fluxo implementado (AS-IS)

1. **Participante / cliente:** cadastro público por e-mail e senha (`POST /api/auth/register`). A API Identidade atribui obrigatoriamente o papel `participant`, sem organização. Depois, `POST /api/auth/login` confere a senha, solicita OTP e `POST /api/auth/verify` conclui o segundo fator antes de criar a sessão HttpOnly de 30 minutos. No laboratório, o código é fictício e pode ser preenchido pelo botão da interface. O participante vê catálogo público de eventos publicados, solicita inscrições por CPF e chave de idempotência, acompanha tickets e notificações simuladas.
2. **Organizador (`organizer`):** gerencia exclusivamente sua organização (`org_id`), seus eventos e atividades; acompanha ocupação e inscrições processadas. Hoje sua criação não é aberta ao cadastro público; existe conta de bootstrap de demonstração e o seed interno opt-in.
3. **Administrador (`admin`):** possui acesso administrativo ampliado no MVP e pode enxergar/gerenciar as organizações. A criação desta conta **não ocorre no cadastro público**. Para demo, somente pelo seed restrito.
4. **Outros perfis:** não há perfil distinto chamado `client` no banco; cliente = `participant`. Não há papéis de palestrante, fiscal ou financeiro implementados. Não apresentar rotas ou permissões inexistentes.

**Regra de segurança:** em nenhuma hipótese o usuário escolhe `role=admin` ou `role=organizer` em seu próprio cadastro. O MVP ainda não possui painel de convite/aprovação de organizadores. Uma futura evolução poderá exigir convite e aceite auditável, sem permitir elevação autônoma de privilégios.

## Massa sintética planejada / sem dados reais

O script `scripts/seed_demo_eventhub.js` gera nove contas em `eventhub_identity`:

| Conta de demonstração | Papel | Organização |
|---|---|---|
| `admin.demo@eventhub.test` | admin | org-demo-admin |
| `organizador.ana@eventhub.test` | organizer | org-demo-academia |
| `organizador.bruno@eventhub.test` | organizer | org-demo-comunidade |
| `cliente.01@eventhub.test` até `cliente.06@eventhub.test` | participant | sem organização |

Os dados de domínio são sempre gerados pelas APIs públicas **autenticadas**, preservando isolamento dos schemas por serviço: três eventos com prefixo `DEMO ·`, atividades gratuitas e pagas simuladas e doze solicitações de inscrições. O cenário inclui vagas confirmadas, reservas de atividade paga e fila de espera. Os CPFs são sintéticos, validados somente para a simulação, e armazenados como HMAC pelo domínio Inscrições. Não utilizar CPF ou e-mail de terceiros.

## Inicialização local autorizada, sem segredos no Git

Antes de executar, conferir `http://127.0.0.1:8088` e manter os volumes MySQL/SQLite de desenvolvimento. O comando abaixo roda **dentro do container Identity** que possui acesso apenas ao seu próprio banco. A chave opt-in bloqueia execução acidental fora da demonstração:

```powershell
.\scripts\seed-demo.ps1
```

O wrapper gera dois artefatos privados: `.demo-credentials.local.json` **dentro do projeto e ignorado pelo Git**, e `docs/TESTE_MOCK_ACESSOS_LOCAL.md` **dentro do projeto, ignorado pelo Git**. O segundo documento contém a lista completa de e-mails e senhas de teste para cada perfil, com cenários associados. Ambos são locais e não podem ser enviados ao Git ou aos logs. Em caso de nova execução, as senhas das contas de demonstração são alteradas, preservando os IDs de usuários e evitando duplicação de eventos e inscrições preexistentes. Para a interface, cada perfil faz login com seu e-mail e a senha correspondente no arquivo local, depois confirma o OTP simulado. Após três senhas erradas a conta é bloqueada temporariamente; não testar senhas ao acaso na apresentação.

Verificação do arquivo sem imprimir as senhas:

```powershell
$demo = Get-Content -Raw .demo-credentials.local.json | ConvertFrom-Json
$demo.accounts | Select-Object label, email, role, org_id
$demo.events | Select-Object title
$demo.metrics | Select-Object activity, confirmed, reserved, waiting
```

**Limitações:** o seed não é um recurso de produção, não envia e-mails, não implementa pagamento real nem gerencia assinatura/licença. Seu uso deve ser estritamente local. O acesso público permanece fechado para novos organizadores e administradores. A simulação não dispensa testes de isolamento e emissão de tickets.

## Auditoria

O seed deve registrar o resultado da execução no checkpoint com evidência do número de contas, eventos e inscrições e confirmação de que a credencial local foi gerada com sucesso. **Nunca incluir senhas no checkpoint.**
