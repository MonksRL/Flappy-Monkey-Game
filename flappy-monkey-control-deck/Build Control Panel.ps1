$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$sourceFile = Join-Path $PSScriptRoot "flappy_monkey_control_deck.py"
$outputDirectory = Join-Path $PSScriptRoot "dist"
$workDirectory = Join-Path $PSScriptRoot "build"
$specDirectory = $PSScriptRoot

if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
    throw "Control Panel source was not found at $sourceFile"
}

$launcher = Get-Command py -ErrorAction SilentlyContinue
$python = Get-Command python -ErrorAction SilentlyContinue
if ($launcher) {
    $pythonExecutable = $launcher.Source
    $pythonPrefix = @("-3")
} elseif ($python) {
    $pythonExecutable = $python.Source
    $pythonPrefix = @()
} else {
    $installedPython = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA "Programs\Python") -Filter "python.exe" -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "Python3(1[1-9]|[2-9][0-9])\\python\.exe$" } |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if (-not $installedPython) {
        throw "Python 3.11 or newer is required. Install it from python.org and enable Add Python to PATH."
    }
    $pythonExecutable = $installedPython.FullName
    $pythonPrefix = @()
}

Write-Host "Installing/updating the Windows build tools..." -ForegroundColor Cyan
& $pythonExecutable @pythonPrefix -m pip install --upgrade "Pillow>=10,<13" "PyInstaller>=6.10,<7"
if ($LASTEXITCODE -ne 0) { throw "The Python build dependencies could not be installed." }

$dataArguments = @(
    "--add-data", "$(Join-Path $repositoryRoot 'Default Monkey.png');.",
    "--add-data", "$(Join-Path $repositoryRoot 'monkey-192.png');.",
    "--add-data", "$(Join-Path $PSScriptRoot 'assets\control-panel-icon-atlas.png');assets",
    "--add-data", "$(Join-Path $PSScriptRoot 'assets\control-panel-icon-atlas.json');assets"
)

Write-Host "Building the portable Control Panel..." -ForegroundColor Cyan
& $pythonExecutable @pythonPrefix -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --windowed `
    --name "Flappy Monkey Control Panel" `
    --icon (Join-Path $repositoryRoot "icon.ico") `
    --distpath $outputDirectory `
    --workpath $workDirectory `
    --specpath $specDirectory `
    @dataArguments `
    $sourceFile
if ($LASTEXITCODE -ne 0) { throw "PyInstaller did not finish successfully." }

$builtApp = Join-Path $outputDirectory "Flappy Monkey Control Panel.exe"
if (-not (Test-Path -LiteralPath $builtApp -PathType Leaf)) {
    throw "The build finished without producing the expected executable."
}

Write-Host ""
Write-Host "Build complete:" -ForegroundColor Green
Write-Host $builtApp
Write-Host "Share that EXE only with approved Flappy Monkey staff."
