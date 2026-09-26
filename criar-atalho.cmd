@echo off
rem ============================================================================
rem  Cria um atalho do Gito na Area de Trabalho
rem ============================================================================
rem  Rode UMA VEZ. Depois disso o app abre pelo atalho, sem precisar achar a
rem  pasta de rede toda vez.
rem
rem  Nao instala nada e nao precisa de administrador: um atalho e um arquivo
rem  .lnk na sua propria Area de Trabalho, como qualquer outro que voce cria
rem  arrastando um icone.
rem ============================================================================

setlocal
title Gito - criar atalho

set "ALVO=%~dp0gito.cmd"
set "ATALHO=%USERPROFILE%\Desktop\Gito.lnk"

if not exist "%ALVO%" (
    echo Nao achei o gito.cmd ao lado deste arquivo.
    pause
    exit /b 1
)

rem O WScript.Shell e o mesmo componente que o Explorer usa para criar atalho.
rem "WorkingDirectory" fica vazio de proposito: quem resolve a pasta e o proprio
rem gito.cmd, com o pushd - e ele sabe lidar com caminho de rede, coisa que
rem o WorkingDirectory de um atalho nao faz.
rem Os caminhos vao por variavel de ambiente, e nao dentro das aspas do
rem comando: uma pasta com espaco, acento ou apostrofo quebraria o PowerShell.
set "GITO_ALVO=%ALVO%"
set "GITO_ATALHO=%ATALHO%"
powershell -NoProfile -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:GITO_ATALHO);" ^
  "$s.TargetPath = $env:GITO_ALVO;" ^
  "$s.Description = 'Gito - seu trabalho, estacao por estacao';" ^
  "$s.IconLocation = $env:SystemRoot + '\System32\shell32.dll,44';" ^
  "$s.Save()"

if exist "%ATALHO%" (
    echo.
    echo  Pronto. O atalho "Gito" esta na sua Area de Trabalho.
    echo.
) else (
    echo.
    echo  Nao consegui criar o atalho.
    echo  Alternativa manual: clique com o botao DIREITO no gito.cmd,
    echo  escolha "Enviar para" e depois "Area de trabalho (criar atalho)".
    echo.
)

pause
