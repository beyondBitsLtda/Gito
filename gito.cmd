@echo off
rem ============================================================================
rem  Gito - clique duplo para abrir
rem ============================================================================
rem  Este arquivo existe para ninguem precisar de terminal. Clique duas vezes,
rem  a janela preta abre, o navegador abre junto, e pronto.
rem
rem  DEIXE A JANELA ABERTA enquanto usar. Fecha-la encerra o app - e e assim
rem  que se fecha o programa. Nao fica nada rodando em segundo plano.
rem
rem  A EXCECAO e o "--oculto", que a inicializacao com o Windows usa: ai o app
rem  roda sem janela, e quem o encerra e o parar-gito.cmd.
rem
rem  ---------------------------------------------------------------------------
rem  O "pushd" NAO E ENFEITE
rem
rem  O app vai viver numa pasta de rede, e o cmd do Windows NAO ACEITA caminho
rem  UNC (\\servidor\pasta) como diretorio atual: ele avisa "CMD does not
rem  support UNC paths as current directories" e cai no C:\Windows - de onde
rem  "node app.js" nao acha arquivo nenhum.
rem
rem  O pushd resolve mapeando uma letra de unidade temporaria para o UNC, e o
rem  popd a devolve no fim. E a unica forma de um .cmd funcionar tanto no disco
rem  local quanto na pasta de rede sem duas versoes dele.
rem ============================================================================

setlocal
title Gito

pushd "%~dp0"
if errorlevel 1 (
    echo.
    echo Nao consegui abrir a pasta do aplicativo:
    echo   %~dp0
    echo.
    echo Se ela esta na rede, confira se voce consegue abri-la no Explorer.
    echo.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo ============================================================
    echo  O Node nao foi encontrado nesta maquina.
    echo ============================================================
    echo.
    echo  O Gito precisa do Node.js para rodar. Voce nao consegue
    echo  instalar sozinho, e nao deve tentar: abra um chamado no
    echo  GLPI pedindo "instalacao do Node.js" que a TI resolve.
    echo.
    pause
    popd
    exit /b 1
)

where git >nul 2>&1
if errorlevel 1 (
    echo.
    echo ============================================================
    echo  O Git nao foi encontrado nesta maquina.
    echo ============================================================
    echo.
    echo  Abra um chamado no GLPI pedindo "Git for Windows".
    echo.
    pause
    popd
    exit /b 1
)

rem ----------------------------------------------------------------------------
rem  JA ESTA RODANDO?
rem
rem  Com o modo oculto, o app pode estar no ar sem janela nenhuma a vista. Subir
rem  um segundo daria "porta 7027 ja esta em uso" - entao o clique duplo passa a
rem  so abrir o navegador no que ja esta rodando.
rem ----------------------------------------------------------------------------
netstat -ano -p tcp | findstr /r /c:"127\.0\.0\.1:7027 .*LISTENING" >nul
if not errorlevel 1 (
    if /i "%~1"=="--oculto" ( popd & exit /b 0 )
    echo.
    echo  O Gito ja esta rodando. Abrindo o navegador...
    start "" "http://127.0.0.1:7027/"
    popd
    exit /b 0
)

if /i "%~1"=="--oculto" goto :oculto

echo.
echo  Iniciando o Gito...
echo  (o navegador abre sozinho - deixe esta janela aberta)
echo.

node "%~dp0app.js" %*

echo.
echo  O Gito foi encerrado.
popd
pause
exit /b 0

rem ----------------------------------------------------------------------------
rem  MODO OCULTO  (gito.cmd --oculto)
rem
rem  Usado pela inicializacao com o Windows. O node sobe SEM janela e este cmd
rem  termina logo em seguida. Para encerrar o app: parar-gito.cmd.
rem
rem  Os caminhos vao para o PowerShell por variavel de ambiente, e nao dentro do
rem  comando: uma pasta com espaco, acento ou apostrofo quebraria as aspas.
rem
rem  Sem janela, o que o app escreveria na tela vai para arquivo - e e ali que
rem  se ve por que ele nao subiu (porta ocupada, git fora do PATH...):
rem    %LOCALAPPDATA%\gito\saida.log e erros.log
rem ----------------------------------------------------------------------------
:oculto
set "GITO_APP=%~dp0app.js"
set "GITO_DIR=%~dp0"
set "GITO_LOG=%LOCALAPPDATA%\gito"
if not exist "%GITO_LOG%" mkdir "%GITO_LOG%"

powershell -NoProfile -Command ^
  "Start-Process -FilePath node -WindowStyle Hidden" ^
  "-ArgumentList ([char]34 + $env:GITO_APP + [char]34), '--sem-navegador'" ^
  "-WorkingDirectory $env:GITO_DIR" ^
  "-RedirectStandardOutput (Join-Path $env:GITO_LOG 'saida.log')" ^
  "-RedirectStandardError (Join-Path $env:GITO_LOG 'erros.log')"

popd
exit /b 0
