param([string]$Modelo = 'qwen2.5:7b')
$ErrorActionPreference = 'Stop'
$assistenteDir = $PSScriptRoot
$pythonLocal = Join-Path $assistenteDir '.venv\Scripts\python.exe'
if (!(Test-Path -LiteralPath $pythonLocal)) {
    python -m venv (Join-Path $assistenteDir '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar o ambiente Python. Instale Python 3.11 ou superior.' }
}
& $pythonLocal -m pip install -r (Join-Path $assistenteDir 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar as dependências.' }
& $pythonLocal (Join-Path $assistenteDir 'preparar.py') --model $Modelo
if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar os modelos locais.' }
Write-Host 'Preparação concluída. Execute iniciar.ps1 e conecte pelo botão Obraflux.'
