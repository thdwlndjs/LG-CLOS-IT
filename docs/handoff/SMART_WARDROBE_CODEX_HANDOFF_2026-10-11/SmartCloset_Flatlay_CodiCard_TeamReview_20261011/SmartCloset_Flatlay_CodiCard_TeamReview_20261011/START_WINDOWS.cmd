@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js 22 이상이 필요합니다. 설치 후 창을 다시 열어 주세요.
 pause
 exit /b 1
)
node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
if errorlevel 1 (
 echo Node.js 22 이상이 필요합니다. 현재 버전을 확인해 주세요.
 node --version
 pause
 exit /b 1
)
set "SC_DEMO_PORT=4391"
if defined FLATLAY_PORT set "SC_DEMO_PORT=%FLATLAY_PORT%"
echo 독립 시연: http://127.0.0.1:%SC_DEMO_PORT%
echo 가입이나 API 키 없이 실행됩니다. 팀 배포본은 변경하지 않습니다.
echo 종료하려면 Ctrl+C를 누르세요.
node server.mjs
set "SC_EXIT=%ERRORLEVEL%"
echo.
echo 서버가 종료되었습니다. 오류가 있다면 위 내용을 확인하세요.
echo 포트 사용 중 오류라면 기존 창을 닫거나 README_FIRST.md의 다른 포트 방법을 사용하세요.
pause
exit /b %SC_EXIT%
