$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$data = Join-Path $root 'data'
foreach ($name in @('tunnel.pid','server.pid')) {
  $pidFile = Join-Path $data $name
  if (Test-Path -LiteralPath $pidFile) {
    try {
      $processId = [int](Get-Content -LiteralPath $pidFile -Raw)
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    } catch {}
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  }
}
Remove-Item -LiteralPath (Join-Path $data 'share-link.txt') -Force -ErrorAction SilentlyContinue
Write-Host 'Interview Hub public link stopped. Laptop data remains in the data folder.'
