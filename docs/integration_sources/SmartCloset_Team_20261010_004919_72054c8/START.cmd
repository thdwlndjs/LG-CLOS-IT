@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto installfirst
node -e "if(Number(process.versions.node.split('.')[0])!==24)process.exit(1)"
if errorlevel 1 goto installfirst
if not exist "node_modules\vite\bin\vite.js" goto installfirst
echo [SmartCloset] 로컬 생활 시연을 시작합니다.
echo 브라우저에서 http://127.0.0.1:4311/ 을 여세요.
echo 가입, 로그인, .env, API 키 없이 시작합니다. 브라우저 로컬에 저장합니다.
echo 이 창을 유지하세요. 종료는 Ctrl+C. 이미 실행 중이면 중복 실행하지 마세요.
call npm.cmd run dev
set "SC_RESULT=%ERRORLEVEL%"
echo.
echo 서버가 종료되었습니다. 종료 코드: %SC_RESULT%
echo 오류가 있으면 위 메시지를 확인하세요. 4311 또는 4312 사용 중이면 기존 서버부터 종료하세요.
pause
exit /b %SC_RESULT%
:installfirst
echo Node.js 24.x 설치 후 INSTALL.cmd를 먼저 실행해 주세요.
pause
exit /b 1
