@echo off
setlocal enabledelayedexpansion
:: ����
set PORT=20128
set MAX_ATTEMPTS=3
set LOG_FILE=%TEMP%\omniroute.log
echo ========================================
echo Reiniciando aplicacao na porta %PORT%...
echo ========================================
echo.
:: ������ɱ��ռ�ö˿ڵĽ���
:kill_by_port
set attempt=1
:kill_loop
if !attempt! gtr %MAX_ATTEMPTS% goto kill_failed
echo Tentativa !attempt! de %MAX_ATTEMPTS%...
:: ����ռ�ö˿ڵ� PID
set "PID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
    set "PID=%%a"
)
if "!PID!"=="" (
    echo Porta %PORT% esta livre
    goto kill_success
)
echo Matando processos na porta %PORT%: !PID!
:: ��һ�γ���ʹ�� taskkill ������ֹ
if !attempt! equ 1 (
    taskkill /PID !PID! 2>nul
    if !errorlevel! equ 0 (
        echo   - SIGTERM enviado para PID !PID!
    )
    timeout /t 2 /nobreak >nul
) else (
    :: ǿ����ֹ
    taskkill /F /PID !PID! 2>nul
    if !errorlevel! equ 0 (
        echo   - SIGKILL enviado para PID !PID!
    )
    timeout /t 1 /nobreak >nul
)
set /a attempt+=1
goto kill_loop
:kill_failed
echo ERRO: Nao foi possivel liberar a porta %PORT% apos %MAX_ATTEMPTS% tentativas
echo Processos ainda ativos:
netstat -ano | findstr :%PORT%
echo.
echo Sugestao: Execute manualmente como Administrador:
echo    netstat -ano ^| findstr :%PORT%
echo    taskkill /F /PID ^<PID^>
exit /b 1
:kill_success
echo.
:: ����֮ǰ�Ĺ���
echo Limpando build anterior (.next)...
if exist .next (
    rmdir /s /q .next
    echo .next removido
)
echo.
:: ִ�й���
echo Fazendo build limpo...
call npm run build
if errorlevel 1 (
    echo Build falhou!
    exit /b 1
)
echo Build concluido com sucesso
echo.
:: ȷ���˿��ڹ�������Ȼ����
echo Verificando porta antes de iniciar...
timeout /t 1 /nobreak >nul
:: ����������
echo Iniciando servidor na porta %PORT%...
echo Log file: %LOG_FILE%
:: �����־�ļ�
type nul > %LOG_FILE%
:: ��̨���� Next.js ������
start /B cmd /c "npx next start --port %PORT%"
set SERVER_PID=!ERRORLEVEL!
echo Inicializando servidor... >> %LOG_FILE%
echo Aguardando servidor iniciar...
:: �ȴ�����������
for /l %%i in (1,1,15) do (
    timeout /t 1 /nobreak >nul
    powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:%PORT%' -TimeoutSec 2 -UseBasicParsing; exit 0 } catch { exit 1 }" 
    if !errorlevel! equ 0 (
        echo.
        echo Servidor rodando em http://localhost:%PORT%
        echo Pressione Ctrl+C para parar
        echo ----------------------------------------
        goto server_started
    )
    echo | set /p "=."
)
echo.
echo Servidor iniciou mas nao respondeu no health check
echo Verifique o log: %LOG_FILE%
:server_started
echo.
echo Dica: Para iniciar MITM automaticamente, descomente as linhas no script
echo.
:: ��ʾ��־
echo Logs em tempo real (Ctrl+C para sair):
echo.
if exist "%LOG_FILE%" (
    type "%LOG_FILE%"
) else (
    echo Arquivo de log nao encontrado
)
:: ���ִ��ڴ򿪲������־
:monitor_logs
timeout /t 2 /nobreak >nul
if exist "%LOG_FILE%" (
    type "%LOG_FILE%"
)
goto monitor_logs
:: ������
:cleanup
echo.
echo Parando servidor...
taskkill /F /FI "IMAGENAME eq node.exe" /FI "WINDOWTITLE eq *next*" 2>nul
echo Servidor parado. Porta %PORT% liberada.
exit /b 0