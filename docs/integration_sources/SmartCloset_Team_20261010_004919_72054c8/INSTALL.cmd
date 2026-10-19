@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missingnode
node -e "if(Number(process.versions.node.split('.')[0])!==24)process.exit(1)"
if errorlevel 1 goto missingnode
where npm.cmd >nul 2>nul
if errorlevel 1 goto missingnode
echo [SmartCloset] 잠금 파일 기준으로 의존성을 설치합니다. 인터넷이 필요합니다.
call npm.cmd ci --no-audit --no-fund
if errorlevel 1 goto failed
echo.
echo 설치 완료. START.cmd를 실행해 주세요. 가입과 API 키는 필요하지 않습니다.
pause
exit /b 0
:missingnode
echo Node.js 24.x와 npm이 필요합니다. 검증 버전: Node.js 24.18.0.
echo https://nodejs.org/ 에서 설치한 뒤 이 창을 새로 열어 주세요.
pause
exit /b 1
:failed
echo.
echo 설치에 실패했습니다. 위 오류를 확인하세요.
echo 인터넷 연결, 폴더 쓰기 권한, Node.js 24.x를 확인한 뒤 INSTALL.cmd를 다시 실행하세요.
pause
exit /b 1
