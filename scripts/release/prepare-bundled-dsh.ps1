[CmdletBinding()]
param(
    [string]$NodeVersion = "22.23.2",
    [string]$NodeZipSha256 = "1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97",
    [string]$NodeArchivePath,
    [string]$Destination
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$manifestDir = Join-Path $PSScriptRoot "bundled-dsh"
if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = Join-Path $repoRoot "apps\desktop\src-tauri\dsh\windows-x64"
}
$destinationPath = [IO.Path]::GetFullPath($Destination)
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot "apps\desktop\src-tauri\dsh"))
if (-not $destinationPath.StartsWith($allowedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Destination must stay below $allowedRoot"
}

$lockFile = Join-Path $manifestDir "package-lock.json"
if (-not (Test-Path -LiteralPath $lockFile -PathType Leaf)) {
    throw "Missing $lockFile. Regenerate the dedicated bundled-runtime lock before packaging."
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("nebulamat-dsh-" + [Guid]::NewGuid().ToString("N"))
$downloadedNodeArchive = Join-Path $tempRoot "node.zip"
$nodeFolderName = "node-v$NodeVersion-win-x64"
$nodeUrl = "https://nodejs.org/dist/v$NodeVersion/$nodeFolderName.zip"
$staging = Join-Path $tempRoot "staging"

try {
    New-Item -ItemType Directory -Path $tempRoot, $staging -Force | Out-Null
    if ([string]::IsNullOrWhiteSpace($NodeArchivePath)) {
        Write-Host "Downloading Node.js $NodeVersion for Windows x64..."
        Invoke-WebRequest -UseBasicParsing -Uri $nodeUrl -OutFile $downloadedNodeArchive
        $nodeArchive = $downloadedNodeArchive
    }
    else {
        $nodeArchive = [IO.Path]::GetFullPath($NodeArchivePath)
        if (-not (Test-Path -LiteralPath $nodeArchive -PathType Leaf)) {
            throw "Node.js archive does not exist: $nodeArchive"
        }
        Write-Host "Using cached Node.js archive $nodeArchive"
    }
    $actualHash = (Get-FileHash -LiteralPath $nodeArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $NodeZipSha256.ToLowerInvariant()) {
        throw "Node.js archive checksum mismatch: expected $NodeZipSha256, got $actualHash"
    }

    Expand-Archive -LiteralPath $nodeArchive -DestinationPath $tempRoot
    $nodeRoot = Join-Path $tempRoot $nodeFolderName
    $nodeExe = Join-Path $nodeRoot "node.exe"
    $npmCli = Join-Path $nodeRoot "node_modules\npm\bin\npm-cli.js"
    if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf) -or
        -not (Test-Path -LiteralPath $npmCli -PathType Leaf)) {
        throw "Downloaded Node.js archive is incomplete"
    }

    Copy-Item -LiteralPath (Join-Path $manifestDir "package.json") -Destination $staging
    Copy-Item -LiteralPath $lockFile -Destination $staging
    $originalPath = $env:Path
    $env:Path = $nodeRoot + [IO.Path]::PathSeparator + $originalPath
    Push-Location $staging
    try {
        & $nodeExe $npmCli ci --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            throw "npm ci failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
        $env:Path = $originalPath
    }

    $dshEntry = Join-Path $staging "node_modules\@deepseek-ai\dsh\lib\bin.js"
    if (-not (Test-Path -LiteralPath $dshEntry -PathType Leaf)) {
        throw "Installed DSH CLI entry is missing: $dshEntry"
    }

    Get-ChildItem -LiteralPath (Join-Path $staging "node_modules") -Recurse -File |
        Where-Object { $_.Name -like "*.d.ts" -or $_.Name -like "*.map" } |
        ForEach-Object { [IO.File]::Delete('\\?\' + $_.FullName) }

    Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $staging "node.exe")
    Copy-Item -LiteralPath (Join-Path $nodeRoot "LICENSE") -Destination (Join-Path $staging "LICENSE.node.txt")
    $manifest = [ordered]@{
        schemaVersion = 1
        architecture = "windows-x64"
        nodeVersion = $NodeVersion
        nodeArchiveSha256 = $actualHash
        dshVersion = "0.1.0-rc.6"
    }
    $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $staging "runtime-manifest.json") -Encoding utf8

    if (Test-Path -LiteralPath $destinationPath) {
        Remove-Item -LiteralPath $destinationPath -Recurse -Force
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
    Move-Item -LiteralPath $staging -Destination $destinationPath

    $entryHash = (Get-FileHash -LiteralPath (Join-Path $destinationPath "node_modules\@deepseek-ai\dsh\lib\bin.js") -Algorithm SHA256).Hash
    Write-Host "Bundled DSH runtime prepared at $destinationPath"
    Write-Host "Node.js: $NodeVersion"
    Write-Host "DeepSeek Harness: 0.1.0-rc.6"
    Write-Host "DSH entry SHA-256: $entryHash"
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
