$ErrorActionPreference = 'Stop'
$pythonLocal = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (!(Test-Path -LiteralPath $pythonLocal)) { throw 'Execute configurar.ps1 antes de iniciar.' }
$env:OLLAMA_NO_CLOUD = '1'
$env:HF_HUB_OFFLINE = '1'
$env:HF_HUB_DISABLE_TELEMETRY = '1'
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
& $pythonLocal (Join-Path $PSScriptRoot 'server.py')
