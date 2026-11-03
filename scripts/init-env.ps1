# Generates local secrets on Windows PowerShell 5.1+. Never overwrites an existing .env.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root '.env'
if (Test-Path $target) {
    Write-Output 'Existing .env preserved. Do not regenerate while a MySQL volume exists.'
    exit 0
}
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $names = @(
        'EVENTHUB_MYSQL_ROOT_PASSWORD',
        'EVENTHUB_MYSQL_REGISTRATIONS_PASSWORD',
        'EVENTHUB_MYSQL_IDENTITY_PASSWORD',
        'EVENTHUB_MYSQL_EVENTS_PASSWORD',
        'EVENTHUB_MYSQL_PAYMENTS_PASSWORD',
        'EVENTHUB_MYSQL_NOTIFICATIONS_PASSWORD',
        'EVENTHUB_CPF_HASH_KEY'
    )
    $lines = @('EVENTHUB_HTTP_PORT=8088')
    foreach ($name in $names) {
        $bytes = New-Object 'byte[]' 24
        $rng.GetBytes($bytes)
        $value = [BitConverter]::ToString($bytes).Replace('-', '')
        $lines += ($name + '=' + $value)
    }
    [System.IO.File]::WriteAllLines(
        $target, $lines, (New-Object System.Text.UTF8Encoding($false))
    )
    Write-Output 'Local .env created; passwords not displayed and not committed.'
}
finally {
    $rng.Dispose()
}
