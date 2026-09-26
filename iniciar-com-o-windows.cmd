@echo off
rem ============================================================================
rem  Gito - abrir sozinho quando o Windows liga
rem ============================================================================
rem  Rode UMA VEZ. A partir do proximo logon o Gito sobe junto com o
rem  Windows, OCULTO (sem janela nenhuma), e o endereco http://127.0.0.1:7027/
rem  (ou o atalho da Area de Trabalho) passa a abrir direto, sem esperar.
rem
rem  Sem janela, nao ha o que fechar: para encerrar, use parar-gito.cmd.
rem  Clicar no gito.cmd com ele ja rodando so abre o navegador.
rem
rem  COMO ISSO FUNCIONA, E POR QUE NAO PRECISA DE ADMINISTRADOR
rem
rem  E so um atalho na sua pasta de Inicializacao - a mesma que o Windows abre
rem  com "shell:startup". Nao e servico, nao e tarefa agendada, nao mexe no
rem  registro e nao sai da sua conta de usuario. Qualquer um pode criar ou
rem  apagar o seu, sem pedir nada a TI.
rem
rem  O app continua rodando COMO VOCE - que e o ponto dele. Um servico rodaria
rem  como outra conta, e ai o Z: sumiria e os commits sairiam com autoria
rem  errada.
rem
rem  Rodar este arquivo de novo pergunta se e para ATUALIZAR o atalho (quem
rem  tinha o antigo, minimizado, passa para o oculto) ou REMOVER.
rem ============================================================================

setlocal
title Gito - iniciar com o Windows

set "ALVO=%~dp0gito.cmd"
set "PASTA=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "ATALHO=%PASTA%\Gito.lnk"

if not exist "%ALVO%" (
    echo.
    echo  Nao achei o gito.cmd ao lado deste arquivo.
    echo.
    pause
    exit /b 1
)

if exist "%ATALHO%" (
    echo.
    echo  O Gito JA esta configurado para abrir com o Windows.
    echo.
    echo    A = atualizar o atalho para o modo OCULTO
    echo    R = remover a inicializacao automatica
    echo    N = nao mexer em nada
    echo.
    choice /c ARN /m "O que fazer"
    if errorlevel 3 goto :fim
    if errorlevel 2 goto :remover
    del "%ATALHO%" >nul 2>&1
    goto :criar
)
goto :criar

:remover
del "%ATALHO%" >nul 2>&1
if exist "%ATALHO%" (
    echo  Nao consegui remover. Apague a mao: tecla Windows + R, digite
    echo    shell:startup
    echo  e exclua o atalho "Gito".
) else (
    echo.
    echo  Removido. O Gito nao abre mais sozinho.
)
goto :fim

:criar
rem O atalho chama "gito.cmd --oculto": o cmd sobe o node SEM janela e
rem termina. WindowStyle 7 = minimizado, para nem esse cmd de passagem, que
rem dura um instante, aparecer na frente de ninguem no logon.
rem
rem Os caminhos vao por variavel de ambiente, e nao dentro das aspas simples
rem do comando: uma pasta com apostrofo no nome quebraria o PowerShell.
powershell -NoProfile -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:ATALHO);" ^
  "$s.TargetPath = $env:ALVO;" ^
  "$s.Arguments = '--oculto';" ^
  "$s.WindowStyle = 7;" ^
  "$s.Description = 'Gito - seu trabalho, estacao por estacao';" ^
  "$s.IconLocation = $env:SystemRoot + '\System32\shell32.dll,44';" ^
  "$s.Save()"

if exist "%ATALHO%" (
    echo.
    echo  ============================================================
    echo   Pronto.
    echo  ============================================================
    echo.
    echo   A partir do proximo logon, o Gito abre sozinho e OCULTO:
    echo   sem janela e sem abrir o navegador. Para abrir a tela: o
    echo   atalho da Area de Trabalho, o gito.cmd ou http://127.0.0.1:7027/
    echo.
    echo   Para encerrar o app: parar-gito.cmd
    echo   Se ele nao subir, o motivo fica em:
    echo     %LOCALAPPDATA%\gito\erros.log
    echo.
    echo   Para desligar a inicializacao, rode este mesmo arquivo de novo.
    echo.
) else (
    echo.
    echo  Nao consegui criar o atalho de inicializacao.
    echo.
    echo  Alternativa manual:
    echo    1. tecla Windows + R, digite:  shell:startup
    echo    2. copie para la um atalho do gito.cmd
    echo.
)

:fim
pause
