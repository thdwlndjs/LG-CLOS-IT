# 2차 공유본 통합 진행 현황

검증 완료, `dev`에서 사용자 로컬 QA와 최종 승인을 기다린다. 승인 전 `main` 병합·추가 원격 푸시·배포 금지.

## 기준과 Git 상태

- 작업 기준: [SECOND_HANDOFF_PLAN.md](SECOND_HANDOFF_PLAN.md). 작업 시작 main과 2차 공유본 `docs/integration_sources/SmartCloset_Team_20261010_004919_72054c8/src/`를 비교했다.
- 시작 시 main과 origin/main은 같았고 tracked 변경·추적된 .env가 없었다.
- 안정 버전 체크포인트 `972ee33`을 main에 커밋·푸시한 뒤 dev를 생성했다. 현재 main과 origin/main은 이 체크포인트 그대로다.
- 통합 코드 커밋: `dfd2833 feat: integrate second handoff UI with existing backend`. 본 진행 문서는 별도 docs 커밋이다. 두 커밋 모두 dev에만 남기며 원격에 올리지 않는다.
- 원본 공유본은 수정하지 않고 미추적 상태로 보존한다. 환경변수·비밀정보·test-results는 커밋에서 제외한다.
- backend, DB Migration, `docs/contracts/`, 기존 설계 문서, infra, 배포 설정은 변경하지 않았다.

## 기능별 결과

파일 경로의 기본 디렉터리는 `web/src/mirror/source/`다.

| 영역 | 구분·결과 | 주요 파일 | 검증·제한 |
|---|---|---|---|
| 미러 IA·내비게이션 | 공유본 개선 반영 완료 | MirrorExperience, MirrorHome, PhotoWardrobeStage | 좌우 옷장·중앙 미러의 배경·좌표 유지, 전체 화면 및 화면 이동 연결 |
| 코디 편집·비교 | 공유본 신규/개선 반영 완료 | MirrorOutfitWorkspace, MirrorCompare | 카드 탐색→편집→비교→빠른 상의 교체→편집 복귀, 서버 허용 DRESS 유지 |
| 사진·소유자·카드 정보 | 공유본 개선 및 기존 계약 연결 완료 | core/app, core/outfitAssets, outfitCardPresentation | 로딩/누락/오류 구분, 같은 기기의 다른 소유자 의류 조회, 사진 ID/버전 변경 시 오래된 선택 저장 차단 |
| 업로드·Mock 피팅 | 기존 API 연결 완료 | ServerMockFitting, BackendPanel, MirrorRegistration | 명시적 동의·인물 사진 업로드→MOCK 비동기 작업→결과 조회, 실제 Decart 호출 없음 |
| 코디 확정·카드 | 기존 계약 연결 완료 | secondHandoffActions, ServerCardShare, serverActions | 세션 종료→확인된 슬롯 LED, 카드 PNG 렌더/저장/명시적 공유, 자동 착용/계획 생성 없음 |
| 캘린더·생활 이력 | 공유본 개선 및 기존 계약 연결 완료 | MirrorCalendar, ServerWearConfirmation, lifeHistory, lifeSnapshot | 실제 서버의 불변 착용 구성 조회, 명시적 날짜·시간 입력, 전송 전 취소 및 응답 유실 후 재진입 복구/중복 방지 |
| 관리·위치 | 계약 범위 내 반영 완료 | MirrorCareEvidence, MirrorCareOverview, ServerCareRecord | 관리 일정 등록과 실제 완료 분리, 근거 없는 가이드 요청 차단, 기존 등록 위치 저장. 소급 완료 제한은 아래 참조 |
| 메인 전용 기능 | 보존 | IntegrationActions, integrations/backendClient | 로그인/기기, Mock PURCHASED·LIKED, 일괄 적재, 보관·회수 도구 유지. /legacy 유지 |

동일 기능은 메인 API 어댑터를 유지했다. 공유본의 별도 서버/PGlite/Supabase Auth·자동 생활 데이터 설치/보정은 중복 또는 계약 충돌로 도입하지 않았다. 예시 표시 도우미는 실제 DB 사진·위치·이력을 대체하지 않는다. 공유본의 개발자 `/dev` 앱을 새 제품 진입점으로 추가하지 않았다.

## 계약 충돌·미반영 범위

| 항목 | 처리 | 후속 판단 |
|---|---|---|
| 코디 확정으로 착용 예정/실제 착용 생성 | 서버 확정 버튼은 기존 세션 종료(save_outfit=false)와 LED만 실행. 실제 착용은 별도 USER 확인 | 착용 예정 생성은 현행 계약에 없으므로 미지원 |
| 참고 사진으로 코디 재구성 | 현행 API 미지원 안내, 사진 없이 기존 추천 기능 유지 | 별도 계약 승인 필요 |
| 과거 관리 완료의 소급 입력 | 기존 일정을 선택해 완료. 일정 생성보다 앞선 completed_at은 서버 TIME_MISMATCH 그대로 거부 | backend/app/application/sprint5.py의 schedule_complete 제약. 시간 조작·백엔드 변경으로 우회하지 않음 |
| 공유본 생활 Fixture·자동 보정 | 실제 사용자/DB에 자동 설치하지 않음 | 기존 실제 보유 의류와 소유자·기기 연결 보존 |
| 매장 접속에서 집 LED | 서버 403 차단 유지. 코디 선택 완료와 LED 차단을 구분 표시 | 물리 LED 장치 검증은 별도 |

## 실행한 검증

- 타입 검사·production build 통과. 기존 500KB 초과 번들 경고는 남아 있다.
- API·캘린더 회귀 16/16, 변경 상태/사진 참조/공유 의류/DRESS/시간 입력 테스트 5/5 통과.
- 격리 실DB+브라우저 E2E 10/10 통과. readiness(DB/Redis/Storage/renderer), 로그인·공유 기기·사진·등록, 편집/비교, Mock VTON, 응답 유실 후 확정 재시도·LED 자동 소등·자동 착용 미생성, 카드 PNG 공유, 별도 착용 취소/재시도/복구, 관리 일정/완료/위치 저장, LIKED 조회의 보유 의류 미생성 및 매장 LED 403을 확인했다.
- 관리 근거가 없는 테스트 의류는 가이드를 생성하지 않는 상태를 확인했다. 근거 있는 가이드 전체 및 구매 일괄 등록은 이번 E2E에서 재실행하지 않았다.
- 테스트 쓰기는 전용 임시 DB/API/worker에만 수행했고 종료 시 자원을 정리했다. 실제 로컬·클라우드 DB의 적재/착용/관리 기록은 수정하지 않았다. 실제 로컬 보유 의류 6벌의 사진은 읽기 전용 브라우저 확인을 했다.
- 시작 main·원본 2차 UI와 통합 UI를 실제 브라우저에서 확인했다. 전체 해상도/모든 UI 상태의 시각 QA가 완료됐다는 의미는 아니다.
- 증적(로컬, Git 제외): test-results/second-handoff-live-evidence.json, second-handoff-browser-evidence.json, second-handoff-browser.log, second-handoff-compare.png, second-integrated-wardrobe.png. 최종 E2E 완료: 2026-10-10 06:12 KST.
- Ruff(신규 Python 검증 스크립트), Git diff whitespace, 커밋 대상 비밀정보 검사 통과. sip/shower의 독립 문서 검토 후 서비스 준비·데모 로그인 조건·정확한 코드 커밋을 보완했다. ssotize 감사에서 이 문서와 작업 지시의 계약/승인 범위 정합성을 확인했으며 다른 문서는 통합·변경하지 않았다. 검증은 외부 API 응답·DB 읽기·생성된 PNG를 확인하며, Mock 이미지의 실제 피팅 품질이나 사용자 시각 QA를 대신하지 않는다.

재현 명령(프로젝트 루트, 기존 .venv·web 의존성·Compose API 이미지/서비스 필요):

```powershell
docker compose --env-file .env -f infra/compose.yaml --profile test up -d api worker postgres-test
Invoke-RestMethod http://127.0.0.1:8000/health/ready
npm run build --prefix web
node --test web/test/api.test.mjs web/test/calendar.test.mjs web/test/second-handoff-state.test.mjs
.\.venv\Scripts\python.exe scripts/verify_second_handoff.py
```

API 이미지 또는 renderer 이미지가 없는 환경은 먼저 `docker compose --env-file .env -f infra/compose.yaml build api renderer`로 빌드한다. readiness의 status=ready, database/redis/storage/renderer=ok가 선행 조건이다. 최초 환경 구성·Migration·실제 보유 데이터 적재는 이 작업에서 자동 수행하지 않는다.

검증 스크립트는 기존 로컬 API 이미지와 실행 중인 Redis·MinIO·private renderer 네트워크를 사용한다. 실제 사용자 데이터 대신 임시 DB에서 합성 의류·이미지·기기만 사용하며, VTON과 LED는 MOCK이다.

## 로컬 실행과 사용자 QA

현재 작업용 dev 서버: http://127.0.0.1:5181/ . 실행 중이면 주소를 바로 열면 된다. 기존 5173은 안정 버전 preview일 수 있다.

서버가 꺼져 있을 때 프로젝트 루트에서:

```powershell
git switch dev
docker compose --env-file .env -f infra/compose.yaml up -d
$env:WEB_PORT = '5181'
npm run dev --prefix web
```

시연용 로그인은 기존 로컬 demo 계정에 접속하며 현재 작업 환경에서 적재된 보유 6벌을 조회한다. 로컬/test + DEMO_AUTH_ENABLED + AUTH_MODE=DEMO 조건의 기존 API 기능이다. 공개 배포에서는 차단된다. 데이터가 없는 새 DB에서는 6벌을 기대하지 않으며 Fixture를 자동 설치하지 않는다. 계정 미준비(503)나 비활성(403)은 기존 환경 설정·계정 준비 상태를 확인한다.

기존 .env와 설치된 web 의존성을 사용한다. 최초 의존성 설치가 필요할 때만 `npm ci --prefix web`을 실행한다.

1. 마이→내 계정→시연용 로그인→옷장: 실제 보유 6벌 사진, 상세/검색, 계정·기기 표시.
2. 코디→새 코디→상의·하의 선택→미러로 비교: 상의 교체, 편집 복귀, 제목/카드 탐색.
3. 명시적 인물 사진 동의·업로드→Mock 피팅→코디 확정: MOCK 표시와 LED 위치 확인 결과. 위치가 미확인인 실제 의류는 임의 점등하지 않는다. VTON 준비 조건 미충족은 오류 안내를 확인한다.
4. 코디카드 저장→카드 이미지 공유: 실제 PNG와 공유 링크. 링크를 가진 사람은 만료 전 이미지를 볼 수 있다.
5. 캘린더 월/날짜 탐색→별도 실제 착용 기록: 입력·취소·상태를 확인한다. 확정만으로 착용 기록이 생기면 안 된다.
6. 의류 상세→라벨·관리법/실제 관리 또는 이동 기록: 근거 누락 안내, 관리 일정과 완료의 구분, 등록된 위치 선택.
7. 내 계정의 기존 PURCHASED·LIKED·보관/회수 도구 접근. 실제 구매 적재 버튼은 쓰기 작업이다.

실제 착용·관리·위치·구매 적재는 로컬 DB에 기록되므로 본인이 확인한 값만 입력한다. 기록을 남기지 않으려면 취소/닫기를 사용한다.

## 남은 작업·이어가기

1. 사용자 로컬 시각/조작 QA와 피드백 반영을 dev에서 진행한다. 미승인 상태다.
2. 물리 LED, 실제 Decart 유료 요청, 클라우드 재배포는 이번 작업의 미검증 범위다.
3. 소급 관리 완료·착용 예정·참고 사진 재구성이 필요하면 계약 변경 여부를 먼저 결정한다.
4. 최종 승인 후에만 main 병합·원격 푸시·배포를 진행한다. 충돌은 덮어쓰지 않고 보고한다.
