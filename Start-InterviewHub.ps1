$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$data = Join-Path $root 'data'
$tools = Join-Path $data 'tools'
$null = New-Item -ItemType Directory -Force -Path $tools
$cloudflared = Join-Path $tools 'cloudflared.exe'
$port = 8180
$serverOut = Join-Path $data 'server-out.log'
$serverErr = Join-Path $data 'server-error.log'
$tunnelOut = Join-Path $data 'tunnel-out.log'
$tunnelErr = Join-Path $data 'tunnel-error.log'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required. Install Node.js, then run this script again.'
}
if (-not (Test-Path -LiteralPath $cloudflared)) {
  $url = 'https://github.com/cloudflare/cloudflared/releases/download/2026.10.3/cloudflared-windows-amd64.exe'
  Write-Host 'Downloading Cloudflare Tunnel from the official release…'
  Invoke-WebRequest -Uri $url -OutFile $cloudflared
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $cloudflared).Hash.ToLowerInvariant()
  $expected = '76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2'
  if ($actual -ne $expected) {
    Remove-Item -LiteralPath $cloudflared -Force
    throw 'cloudflared checksum did not match the official release. The download was removed.'
  }
}
$node = (Get-Command node).Source
$healthUri = 'http://127.0.0.1:' + $port + '/api/status'
$serverReady = $false
$serverStarted = $false
try {
  $health = Invoke-RestMethod -Uri $healthUri -TimeoutSec 2
  $authUri = $healthUri -replace '/api/status$', '/api/auth/me'
  $auth = Invoke-RestMethod -Uri $authUri -TimeoutSec 2
  $serverReady = $health.storage -eq 'laptop' -and $auth.PSObject.Properties.Name -contains 'authenticated'
} catch {}
if (-not $serverReady) {
  $portAvailable = $false
  for ($candidate = $port; $candidate -le ($port + 10); $candidate++) {
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidate)
    try {
      $probe.Start()
      $probe.Stop()
      $port = $candidate
      $portAvailable = $true
      break
    } catch {
      try { $probe.Stop() } catch {}
    }
  }
  if (-not $portAvailable) { throw 'No free laptop server port was found from 8180 through 8190.' }
  $healthUri = 'http://127.0.0.1:' + $port + '/api/status'
  $oldPort = $env:PORT
  $env:PORT = [string]$port
  $proc = Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory $root -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr -PassThru -WindowStyle Hidden
  $serverStarted = $true
  if ($null -ne $oldPort) { $env:PORT = $oldPort } else { Remove-Item Env:PORT -ErrorAction SilentlyContinue }
  Set-Content -LiteralPath (Join-Path $data 'server.pid') -Value $proc.Id -Encoding ascii
  for ($i=0; $i -lt 25; $i++) {
    Start-Sleep -Seconds 1
    try {
      $health = Invoke-RestMethod -Uri $healthUri -TimeoutSec 2
      $auth = Invoke-RestMethod -Uri ($healthUri -replace '/api/status$', '/api/auth/me') -TimeoutSec 2
      if ($health.storage -eq 'laptop' -and $auth.PSObject.Properties.Name -contains 'authenticated') { $serverReady = $true; break }
    } catch {}
  }
}
if (-not $serverReady) { throw 'The laptop server did not start. See data/server-error.log.' }
$linkFile = Join-Path $data 'share-link.txt'
$existingLink = if (Test-Path -LiteralPath $linkFile) { (Get-Content -LiteralPath $linkFile -Raw).Trim() } else { '' }
$existingPid = 0
if (Test-Path -LiteralPath (Join-Path $data 'tunnel.pid')) {
  try { $existingPid = [int](Get-Content -LiteralPath (Join-Path $data 'tunnel.pid') -Raw) } catch {}
}
$tunnelAlive = $false
$tunnelId = 0
if ($existingPid -gt 0) { $tunnelAlive = [bool](Get-Process -Id $existingPid -ErrorAction SilentlyContinue); if ($tunnelAlive) { $tunnelId = $existingPid } }
if (-not ($tunnelAlive -and $existingLink -match '^https://[a-z0-9-]+\.trycloudflare\.com/?$')) {
  $tunnel = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel','--url',('http://127.0.0.1:' + $port)) -WorkingDirectory $root -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr -PassThru -WindowStyle Hidden
  Set-Content -LiteralPath (Join-Path $data 'tunnel.pid') -Value $tunnel.Id -Encoding ascii
  $tunnelId = $tunnel.Id
  $existingLink = ''
  for ($i=0; $i -lt 30 -and -not $existingLink; $i++) {
    Start-Sleep -Seconds 1
    $logs = ((Get-Content -LiteralPath $tunnelOut -Raw -ErrorAction SilentlyContinue) + [Environment]::NewLine + (Get-Content -LiteralPath $tunnelErr -Raw -ErrorAction SilentlyContinue))
    $match = [regex]::Match($logs, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($match.Success) { $existingLink = $match.Value }
    if (-not (Get-Process -Id $tunnel.Id -ErrorAction SilentlyContinue)) { break }
  }
  if (-not $existingLink) { throw 'The tunnel did not provide a public link. See data/tunnel-error.log.' }
  Set-Content -LiteralPath $linkFile -Value $existingLink -Encoding ascii
}
Write-Host 'Recruiter companies can create their own account from the Hiring workspace tab.'
Write-Host 'Each company can view only its own jobs and candidate submissions. Candidate interviews remain available through the shared link.'
Write-Host 'Company passwords are stored on this laptop as salted password hashes in data/accounts.json.'
Write-Host 'The site and recordings are stored on this laptop in the data folder.'
Write-Host 'Keep this laptop online and leave the server and tunnel running while people use the link.'
Write-Host 'Run Stop-InterviewHub.ps1 when you want to close public access. The link is temporary and will change after a new tunnel starts.'
Write-Host 'This PowerShell process must remain open while the share link is active.'
Write-Host 'Run Stop-InterviewHub.ps1 in another PowerShell window to stop the link.'
try {
  while ($tunnelId -gt 0 -and (Get-Process -Id $tunnelId -ErrorAction SilentlyContinue)) { Start-Sleep -Seconds 2 }
} finally {
  if ($serverStarted -and $proc) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath (Join-Path $data 'share-link.txt') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $data 'server.pid') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $data 'tunnel.pid') -Force -ErrorAction SilentlyContinue
}
