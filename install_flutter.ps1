$dest = "C:\Users\Admin\flutter.zip"
Write-Host "Downloading Flutter SDK..."

try {
    $url = "https://storage.googleapis.com/flutter_infra_release/releases/stable/windows/flutter_windows_3.24.3-stable.zip"
    $webClient = New-Object System.Net.WebClient
    $webClient.DownloadFile($url, $dest)
    $size = (Get-Item $dest).Length / 1MB
    Write-Host "Download completed. Size: $([math]::Round($size, 1)) MB"
    exit 0
} catch {
    Write-Host "Official mirror failed: $($_.Exception.Message)"
    Write-Host "Trying Tsinghua mirror..."
    try {
        $url2 = "https://mirrors.tuna.tsinghua.edu.cn/flutter/flutter_infra/releases/stable/windows/flutter_windows_3.24.3-stable.zip"
        $webClient = New-Object System.Net.WebClient
        $webClient.DownloadFile($url2, $dest)
        $size = (Get-Item $dest).Length / 1MB
        Write-Host "Download completed (Tsinghua mirror). Size: $([math]::Round($size, 1)) MB"
        exit 0
    } catch {
        Write-Host "Both downloads failed: $($_.Exception.Message)"
        exit 1
    }
}
