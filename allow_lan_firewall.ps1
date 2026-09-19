# ==============================================================================
# Script: Mo cong Windows Firewall cho Dashboard System Monitor (Port 8000)
# Chay script nay duoi quyen Administrator (Run as Administrator)
# ==============================================================================

$RuleName = "Allow Dashboard LAN Access"
$Port = 8000

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "  [+] CAU HINH WINDOWS FIREWALL - CHO PHEP TRUY CAP LAN" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# Kiem tra quyen Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "Vui long chay PowerShell voi quyen Administrator (Right-click -> Run as Administrator) de tao Firewall Rule."
    Write-Host "Lenh can chay:" -ForegroundColor Yellow
    Write-Host "New-NetFirewallRule -DisplayName `"$RuleName`" -Direction Inbound -LocalPort $Port -Protocol TCP -Action Allow`n" -ForegroundColor White
    Pause
    exit 1
}

# Kiem tra xem Rule da ton tai chua
$existingRule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue

if ($existingRule) {
    Write-Host "[*] Firewall Rule '$RuleName' da ton tai tren he thong!" -ForegroundColor Green
    Set-NetFirewallRule -DisplayName $RuleName -Enabled True -Action Allow -Direction Inbound -Protocol TCP -LocalPort $Port
    Write-Host "[+] Da cap nhat va bat (Enabled) Firewall Rule thanh cong.`n" -ForegroundColor Green
} else {
    Write-Host "[*] Dang tao moi Inbound Firewall Rule cho Port $Port (TCP)..." -ForegroundColor Yellow
    New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -LocalPort $Port -Protocol TCP -Action Allow | Out-Null
    Write-Host "[+] Da tao thanh cong Firewall Rule '$RuleName'!`n" -ForegroundColor Green
}

# Hien thi dia chi IP LAN de truy cap
$lanIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object -First 1).IPAddress

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  [*] Dashboard Local : http://localhost:$Port" -ForegroundColor White
if ($lanIP) {
    Write-Host "  [*] Dashboard LAN   : http://${lanIP}:$Port" -ForegroundColor Yellow
}
Write-Host "========================================================`n" -ForegroundColor Cyan

Write-Host "Cac thiet bi khac trong cung mang Wi-Fi / LAN hien tai da co the truy cap vao Dashboard!" -ForegroundColor Green
