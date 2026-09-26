@echo off
rem ============================================================================
rem  Gito - encerrar o app que roda oculto
rem ============================================================================
rem  No modo oculto (o da inicializacao com o Windows) nao ha janela para
rem  fechar. Este arquivo faz esse papel.
rem
rem  QUEM ELE ENCERRA
rem
rem  So o processo que esta escutando na porta do Gito (7027), e so se ele
rem  for um node. Procurar "node.exe" pelo nome derrubaria junto qualquer outro
rem  node que a pessoa tenha aberto - um servidor de desenvolvimento, por
rem  exemplo - e isso nao e problema deste app.
rem
rem  E um processo da propria conta do usuario: nao precisa de administrador.
rem ============================================================================

setlocal
title Gito - encerrar

powershell -NoProfile -Command ^
  "$c = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 7027 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1;" ^
  "if (-not $c) { Write-Host ''; Write-Host '  O Gito nao esta rodando.'; exit 0 };" ^
  "$p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue;" ^
  "if (-not $p -or $p.ProcessName -ne 'node') { Write-Host ''; Write-Host ('  A porta 7027 esta com outro programa: ' + $p.ProcessName + '. Nao mexi nele.'); exit 1 };" ^
  "Stop-Process -Id $p.Id;" ^
  "Write-Host ''; Write-Host '  Gito encerrado.'"

echo.
pause
