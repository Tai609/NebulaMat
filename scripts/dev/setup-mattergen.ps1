param(
    [string]$TargetPath = "",
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$revision = "ac9ddd406171138c3f037d06b9b53fedbbb1c536"
$repository = "https://github.com/microsoft/mattergen.git"

if ([string]::IsNullOrWhiteSpace($TargetPath)) {
    $TargetPath = Join-Path (Get-Location) ".external\mattergen"
}
$TargetPath = [IO.Path]::GetFullPath($TargetPath)

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git is required to fetch MatterGen"
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv is required; install it from https://docs.astral.sh/uv/"
}

if (-not (Test-Path (Join-Path $TargetPath ".git"))) {
    New-Item -ItemType Directory -Force -Path (Split-Path $TargetPath) | Out-Null
    & git clone --filter=blob:none $repository $TargetPath
}
& git -C $TargetPath fetch --depth 1 origin $revision
& git -C $TargetPath checkout --detach $revision

if ($SkipInstall) {
    Write-Output "MatterGen checkout ready at $TargetPath ($revision); installation skipped."
    exit 0
}

$venv = Join-Path $TargetPath ".venv"
& uv venv $venv --python 3.10 --allow-existing
& uv pip install --python (Join-Path $venv "Scripts\python.exe") -e $TargetPath
Write-Output "MatterGen environment ready at $venv ($revision)."
Write-Output "The upstream project targets Linux + CUDA; use a registered GPU machine for generation."
