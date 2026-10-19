# 새 폴더 복원·실행 검증 결과

2026-10-10 / 기준 커밋 72054c8, 구현 5eb809e. 원본 프로젝트는 변경하지 않았습니다.

최신 파일을 안전한 전달용 구성으로 복사 → ZIP 생성 → 비어 있던 별도 verify-fresh 폴더에 압축 해제 → INSTALL.cmd 실제 실행 → 검사/서버/브라우저 조작 순서로 검증했습니다. 검사 완료 뒤 보고서·실제 캡처만 추가하고, 원본과 복원본의 소스·필수 자산 404개 해시가 변하지 않았음을 대조하여 최종 ZIP을 만들었습니다. node_modules·.env·개인 브라우저 저장정보는 가져오지 않았습니다. 설치는 npm의 정상 패키지 설치/캐시 경로를 사용하며 원본 프로젝트의 node_modules를 참조하거나 복사하지 않습니다.

| 검사 | 실제 결과 |
|---|---|
| Windows 설치기 INSTALL.cmd | PASS, npm ci로 100 패키지 설치, Node 24.18.0/npm 11.16.0 |
| 전체 자동검사 | 522 PASS / 0 FAIL / 1 SKIP |
| SKIP 사유 | 임시 비인물 MP4 fixture가 없는 선택적 FFmpeg 검사 |
| TypeScript / Vite build | PASS / PASS |
| START.cmd 기본 실행 | UI 4311 + API 4312 정상 시작 |
| 키 없는 실행 | 검증 프로세스의 상속 키 변수를 비워 모든 키 없음 확인. .env 없음, database_configured=false, ai_mode=mock, live_enabled=false |
| 오류 창 유지 | 이미 켜진 포트로 재실행하여 EADDRINUSE 원인·종료 코드·pause 출력 확인 |
| 기본 주소의 의류/배경 파일 | 의류 PNG 48 + 배경 PNG 2 = 50개 HTTP bytes/해시 일치 |
| 수진 브라우저 | S02 사진 로딩, 같은 셔츠 이력·한글 관리·출처·로컬 도움, L2_UPPER_GROUP LED 확인 |
| 휘재 브라우저 | 홈 카드→상의 H02 교체→H08/H15 유지→카드 저장→오늘 선택→같은 구성 사진과 LED |
| 달력·저장 유지 | 날짜 카드, 저장 카드 5/5 페이지, 프로필 왕복·새로고침·앱 종료/재시작 후 재조회 PASS |

브라우저 조작은 **복원본의 같은 소스**를 별도 포트 4371로 띄워 검증했습니다. 원래 사용자의 4311 브라우저 저장영역을 건드리지 않기 위한 격리이며, 팀원의 실제 실행 주소는 127.0.0.1:4311입니다. START.cmd 기본 4311/4312 실행도 별도로 확인했습니다. 검수용 카드/기록은 이 검사 브라우저에만 저장되고 ZIP에는 포함하지 않습니다.

최초 설치 시 npm은 기존 패키지의 install-script 승인 안내를 출력했지만 이번 설치·타입검사·빌드가 통과했습니다. Vite의 기존 큰 번들/PURE 주석 경고는 남아 있습니다. 새 패키지·서비스·유료 호출을 추가하지 않았습니다.

이번 실행에서 live 피팅/유료 AI/원격 DB/로그인/물리 센서는 검증하지 않았습니다. 이미지 17벌 미연결, 신발·가방 4벌 위치 없음, 검색 출처 재확인 상태 등 제한은 START_HERE_KO.md에 그대로 표시했습니다. 예시 이미지와 생활 시연 자료를 실물 또는 실제 API 성공으로 보고하지 않습니다.

실제 복원본 화면: restored-sujin-care.jpg / restored-hwijae-calendar.jpg / restored-after-restart.jpg. ZIP 전체 파일 검사는 `node scripts/verify-handoff.mjs`로 재실행할 수 있습니다. FILE_MANIFEST.json은 자기 자신을 제외한 모든 전달 파일의 SHA-256/크기를 포함합니다.
