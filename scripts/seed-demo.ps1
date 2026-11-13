# EventHub: dados e logins de teste mock. Uso EXCLUSIVO no notebook local.
# Na raiz do projeto: .\scripts\seed-demo.ps1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$composeName = ((docker compose config --format json) | ConvertFrom-Json).name
if ($LASTEXITCODE -ne 0 -or $composeName -ne 'eventhub') {
    throw 'Projeto Docker inesperado. Seed permitido apenas no EventHub local.'
}
$id = (docker compose ps -q identity).Trim()
if ($LASTEXITCODE -ne 0 -or $id -notmatch '^[a-fA-F0-9]{12,64}$') {
    throw 'Container Identity nao disponivel.'
}

$seedPath = Join-Path $PSScriptRoot 'seed_demo_eventhub.js'
$privateJson = Join-Path $root '.demo-credentials.local.json'
$privateDoc = Join-Path $root 'docs\TESTE_MOCK_ACESSOS_LOCAL.md'

# As credenciais nao aparecem no terminal; o script deposita os dois
# arquivos privados no /tmp do container, extraidos por docker cp.
docker cp $seedPath ($id + ':/app/seed_demo_eventhub.js')
if ($LASTEXITCODE -ne 0) { throw 'Copia UTF-8 do seed falhou.' }
docker compose exec -T -e EVENTHUB_ENABLE_DEMO_SEED=1 identity node /app/seed_demo_eventhub.js --demo-local
if ($LASTEXITCODE -ne 0) {
    throw "Seed interrompido ou falhou. Codigo: $LASTEXITCODE"
}
docker cp ($id + ':/tmp/eventhub-demo-credentials.json') $privateJson
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel obter o JSON de credenciais.' }
docker cp ($id + ':/tmp/eventhub-demo-logins.md') $privateDoc
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel obter o documento mock.' }

$demo = Get-Content -Raw -Encoding UTF8 $privateJson | ConvertFrom-Json
if ($demo.accounts.Count -ne 9 -or $demo.events.Count -ne 3) {
    throw 'Contagem inesperada de perfis ou eventos no JSON de teste.'
}
foreach ($account in $demo.accounts) {
    if (-not $account.password -or -not $account.email) {
        throw 'Arquivo de acessos incompleto.'
    }
}
if ((Get-Item $privateDoc).Length -lt 300) {
    throw 'Documento mock nao foi gravado corretamente.'
}

$roles = $demo.accounts | Group-Object role | ForEach-Object {
    "$($_.Name)=$($_.Count)"
}
Write-Output ('DEMO_MOCK_READY accounts=9 events=3 roles=' + ($roles -join ','))
Write-Output ('DEMO_MOCK_REQUESTS_NEW=' + $demo.registrations.issued)
Write-Output ('DEMO_MOCK_REQUESTS_EXISTING=' + $demo.registrations.already)
Write-Output 'DOC_PRIVADO_LOCAL=docs/TESTE_MOCK_ACESSOS_LOCAL.md'
Write-Output 'JSON_LOCAL=.demo-credentials.local.json'
Write-Output 'ACESSOS_VALIDOS=9 (autenticacao realizada pelo seed)'
