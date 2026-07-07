$ErrorActionPreference = "Stop"

$dest = "C:\Users\Admin\flutter.zip"
$extractDir = "C:\Users\Admin\flutter"

Write-Host "=== Downloading Flutter SDK from Chinese mirror ==="
Write-Host ""

$url = "https://storage.flutter-io.cn/flutter_infra_release/releases/stable/windows/flutter_windows_3.24.3-stable.zip"
Write-Host "URL: $url"
Write-Host ""

try {
    $webClient = New-Object System.Net.WebClient
    $webClient.Headers.Add("User-Agent", "Mozilla/5.0")
    Write-Host "Download started..."
    $webClient.DownloadFile($url, $dest)

    if (Test-Path $dest) {
        $size = (Get-Item $dest).Length / 1MB
        Write-Host ""
        Write-Host "Download completed! File size: $([math]::Round($size, 1)) MB"
    } else {
        throw "File not found after download"
    }
} catch {
    Write-Host ""
    Write-Host "Download failed: $($_.Exception.Message)"

    Write-Host ""
    Write-Host "Trying alternative method with Invoke-WebRequest..."
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        $size = (Get-Item $dest).Length / 1MB
        Write-Host "Alternative download succeeded! $([math]::Round($size, 1)) MB"
    } catch {
        Write-Host "Alternative also failed: $($_.Exception.Message)"
        exit 1
    }
}

Write-Host ""
Write-Host "Extracting..."
try {
    if (Test-Path $extractDir) {
        Remove-Item -Path $extractDir -Recurse -Force
    }
    Expand-Archive -Path $dest -DestinationPath "C:\Users\Admin" -Force
    Write-Host "Extraction completed!"
} catch {
    Write-Host "Extract failed: $($_.Exception.Message)"
    Write-Host "Trying .NET method..."
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($dest, "C:\Users\Admin")
        Write-Host "Alternative extraction succeeded!"
    } catch {
        Write-Host "All extraction methods failed: $($_.Exception.Message)"
        exit 1
    }
}

Write-Host ""
Write-Host "Verifying installation..."
if (Test-Path "C:\Users\Admin\flutter\bin\flutter.bat") {
    Write-Host "Flutter SDK installed successfully at: C:\Users\Admin\flutter"
    exit 0
} else {
    Write-Host "flutter.bat not found - installation may have failed"
    exit 1
}
