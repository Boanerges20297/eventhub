# Windows PowerShell 5.1+. Create only missing secrets; NEVER regenerate existing DB keys.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root '.env'
$existing = @{}
$lines = New-Object 'System.Collections.Generic.List[string]'
if (Test-Path $target) {
    foreach ($line in [IO.File]::ReadAllLines($target)) {
        $lines.Add($line)
        if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') { $existing[$matches[1]] = $matches[2] }
    }
}
if (-not $existing.ContainsKey('EVENTHUB_HTTP_PORT')) {
    $lines.Add('EVENTHUB_HTTP_PORT=8088')
}
if (-not $existing.ContainsKey('EVENTHUB_BOOTSTRAP_EMAIL')) {
    $lines.Add('EVENTHUB_BOOTSTRAP_EMAIL=demo-organizador@eventhub.local')
}
$names = @(
    'EVENTHUB_MYSQL_ROOT_PASSWORD',
    'EVENTHUB_MYSQL_REGISTRATIONS_PASSWORD',
    'EVENTHUB_MYSQL_IDENTITY_PASSWORD',
    'EVENTHUB_MYSQL_EVENTS_PASSWORD',
    'EVENTHUB_MYSQL_PAYMENTS_PASSWORD',
    'EVENTHUB_MYSQL_NOTIFICATIONS_PASSWORD',
    'EVENTHUB_CPF_HASH_KEY',
    'EVENTHUB_JWT_SECRET',
    'EVENTHUB_INTERNAL_SECRET',
    'EVENTHUB_BOOTSTRAP_PASSWORD'
)
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $added = 0
    foreach ($name in $names) {
        if ($existing.ContainsKey($name)) {
            if (-not $existing[$name]) { throw "Existing secret is empty: $name. Fix manually." }
            continue
        }
        $bytes = New-Object 'byte[]' 32
        $rng.GetBytes($bytes)
        $value = [BitConverter]::ToString($bytes).Replace('-', '')
        $lines.Add($name + '=' + $value)
        $added += 1
    }
    if ($added -gt 0 -or -not (Test-Path $target)) {
        [IO.File]::WriteAllLines($target, $lines, (New-Object Text.UTF8Encoding($false)))
    }
    Write-Output "Local environment ready; new secrets created: $added; values withheld."
}
finally { $rng.Dispose() }
