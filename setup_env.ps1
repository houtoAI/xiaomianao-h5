$flutterBin = "C:\Users\Admin\flutter\bin"

# 设置 Flutter 中国镜像环境变量（用户级别，持久化）
[Environment]::SetEnvironmentVariable("PUB_HOSTED_URL", "https://pub.flutter-io.cn", "User")
[Environment]::SetEnvironmentVariable("FLUTTER_STORAGE_BASE_URL", "https://storage.flutter-io.cn", "User")
Write-Host "Set PUB_HOSTED_URL and FLUTTER_STORAGE_BASE_URL (User scope)"

# 更新 PATH - 将 Flutter bin 添加到用户 PATH
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$flutterBin*") {
    $newPath = "$userPath;$flutterBin"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "Added C:\Users\Admin\flutter\bin to User PATH"
} else {
    Write-Host "Flutter bin already in User PATH"
}

# 同时设置当前会话的环境变量（立即可用）
$env:PUB_HOSTED_URL = "https://pub.flutter-io.cn"
$env:FLUTTER_STORAGE_BASE_URL = "https://storage.flutter-io.cn"
$env:Path = "$flutterBin;$env:Path"

Write-Host ""
Write-Host "Environment configuration completed!"
Write-Host "Flutter command available in new terminal sessions"
Write-Host ""

# 验证
$flutterPath = Join-Path $flutterBin "flutter.bat"
if (Test-Path $flutterPath) {
    Write-Host "flutter.bat found at: $flutterPath"
    exit 0
} else {
    Write-Host "ERROR: flutter.bat not found!"
    exit 1
}
