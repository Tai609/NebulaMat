param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Language = ""   # optional BCP-47 tag, e.g. zh-Hans-CN / en-US / ja-JP
)

$ErrorActionPreference = 'Stop'

# Resolve full path and validate existence
$resolved = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).Path)
if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
  Write-Error "File not found: $resolved"
  exit 2
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]

# Async helper: converts WinRT IAsyncOperation<T> into a .NET Task and awaits it.
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await([object]$WinRtTask, [Type]$ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

# Open the image file and decode a software bitmap (Win32 screen-grab / PNG / JPG supported).
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolved)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

# Pick OCR engine: explicit language if supplied, else user-profile languages.
if ($Language -ne "") {
  $lang = New-Object Windows.Globalization.Language $Language
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
  if (-not $engine) {
    Write-Warning "OCR engine not available for '$Language'; falling back to user-profile languages."
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  }
} else {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
}
if (-not $engine) {
  Write-Error "No OCR engine available on this machine."
  exit 3
}

$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

# Output each recognized line, with confidence when available.
Write-Output ("# OCR OUTPUT for: " + [System.IO.Path]::GetFileName($resolved))
Write-Output ("# Engine language: " + $engine.RecognizerLanguage.LanguageTag)
$n = 0
foreach ($line in $result.Lines) {
  $n++
  Write-Output ("[L{0}] {1}" -f $n, $line.Text)
}
Write-Output ("# Lines: " + $n)
