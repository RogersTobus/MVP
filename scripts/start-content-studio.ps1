$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$workDirectory = Join-Path $projectRoot "work"
$stdoutPath = Join-Path $workDirectory "dev-server.out.log"
$stderrPath = Join-Path $workDirectory "dev-server.err.log"
$pidPath = Join-Path $workDirectory "dev-server.pid"

$existingServer = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1

if ($existingServer) {
  Write-Host "콘텐츠 스튜디오가 이미 실행 중입니다: http://127.0.0.1:3000"
  exit 0
}

$systemNode = Get-Command node -ErrorAction SilentlyContinue
$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$nodePath = if ($systemNode) { $systemNode.Source } elseif (Test-Path $bundledNode) { $bundledNode } else { $null }

if (-not $nodePath) {
  throw "Node.js를 찾을 수 없습니다. Node.js를 설치하거나 Codex 데스크톱 앱에서 이 프로젝트를 열어 주세요."
}

$nextPath = Join-Path $projectRoot "node_modules\next\dist\bin\next"
if (-not (Test-Path $nextPath)) {
  throw "필요한 파일이 없습니다. 프로젝트 폴더에서 pnpm install을 먼저 실행해 주세요."
}
$nextArgument = '"' + $nextPath + '"'

New-Item -ItemType Directory -Force -Path $workDirectory | Out-Null
Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue

$serverProcess = Start-Process `
  -FilePath $nodePath `
  -ArgumentList $nextArgument, "dev", "--hostname", "0.0.0.0", "--port", "3000" `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

Set-Content -LiteralPath $pidPath -Value $serverProcess.Id

for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Milliseconds 500

  if ($serverProcess.HasExited) {
    $errorText = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { "알 수 없는 오류" }
    throw "콘텐츠 스튜디오 실행에 실패했습니다.`n$errorText"
  }

  $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($listener) {
    Write-Host "콘텐츠 스튜디오를 실행했습니다: http://127.0.0.1:3000"
    Write-Host "문제가 생기면 work\dev-server.err.log에서 원인을 확인할 수 있습니다."
    exit 0
  }
}

throw "서버가 제한 시간 안에 시작되지 않았습니다. work\dev-server.err.log를 확인해 주세요."
