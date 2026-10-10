# 2차 공유본 통합 진행 현황

사용자가 main 반영을 승인해 통합 및 이미지 캐시 변경을 `37f695d`까지 main에 반영·푸시했다. 후속 공개 시연 로그인 수정은 main에서 검증·커밋·배포하며 진행 상태를 아래에 기록한다.

## 기준과 Git 상태

- 작업 기준: [SECOND_HANDOFF_PLAN.md](SECOND_HANDOFF_PLAN.md). 작업 시작 main과 2차 공유본 `docs/integration_sources/SmartCloset_Team_20261010_004919_72054c8/src/`를 비교했다.
- 시작 시 main과 origin/main은 같았고 tracked 변경·추적된 .env가 없었다.
- 안정 버전 체크포인트 `972ee33`을 main에 커밋·푸시한 뒤 dev를 생성했다. 이후 사용자 승인으로 main/origin/main을 `37f695d`까지 갱신했다.
- 통합 코드 커밋: `dfd2833 feat: integrate second handoff UI with existing backend`. 추천 홈 후속 커밋: `d824004 feat: add daily outfit and seasonal storage demo`. 진행 문서는 별도 docs 커밋으로 관리한다. 초기 통합은 dev에서 수행했고, 사용자 승인 이후 main으로 반영했다.
- 원본 공유본은 수정하지 않고 미추적 상태로 보존한다. 환경변수·비밀정보·test-results는 커밋에서 제외한다.
- 초기 2차 UI 통합에서는 backend·DB·배포 계약을 변경하지 않았다. 후속 공개 시연 로그인은 아래 범위만 추가하며 DB Schema/Migration 및 원본 설계 문서는 유지한다.

## 공개 시연 로그인 수정

- 재현: Vercel 버튼 → Render `POST /api/v1/integration/demo-login`이 `403 Demo login is disabled`로 실패했다. 로컬은 200. 공개 버튼은 유지하고 백엔드 opt-in을 추가했다.
- 코드: `backend/app/core/config.py`, `backend/app/api/v1/integration.py`, `scripts/provision_public_demo.py`, `render.yaml`. 기존 JWT·레거시 로컬 DEMO 계약·기기별 조회·소유권·Private Storage를 유지한다.
- `PUBLIC_DEMO_LOGIN_ENABLED`는 기본 false, 활성화 시 명시적 `PUBLIC_DEMO_MEMBER_ID` 필수다. 지정 계정은 login=public-demo, enabled=true, role=MEMBER, 기기 연결 조건을 모두 만족해야 한다. 클라이언트가 사용자 ID를 선택하지 못한다. 기존 개인 OWNER 계정으로 대체하지 않는다.
- 실제 클라우드에 별도 MEMBER/기기 연결을 준비했다. 재실행 created=false를 확인했다. 기존 실제 의류 6벌은 소유자·이미지·착용 기록을 바꾸지 않고 기기 연결 계약으로 조회한다. 공개 계정의 공유 데이터와 운영상 조회 범위는 [CLOUD_DEPLOYMENT.md](../CLOUD_DEPLOYMENT.md#계정과-환경변수)에 기록했다.
- 검증: 단위/계약 157개 통과, 설정 17개 포함, 실 PostgreSQL/Redis 로그인 통합 2개 통과. 공개 로그인·다른 household 404·기존 소유자의 의류 수정 차단·비밀번호 로그인 차단·로그아웃 토큰 취소 및 비활성/미준비 실패를 확인한다. Ruff 및 OpenAPI validator 통과.
- 환경 오류: Windows pytest 기본 Temp 접근 거부는 Git 제외 basetemp로, 테스트 PostgreSQL 55432 포트 바인딩 거부는 Git 제외 Compose override에서 테스트 DB 호스트 포트를 제거해 해결했다. 시스템 권한·보안 설정을 변경하지 않았다. 클라우드 DB TLS는 기존 공식 CA로 검증하며 인증서 검증을 끄지 않았다.
- 구현 커밋 `4878d34` main 푸시 및 [CI 38041047056](https://github.com/thdwlndjs/LG-CLOS-IT/actions/runs/38041047056) frontend/backend/free-cloud-image/deploy 성공. [Deployment smoke 38041245481](https://github.com/thdwlndjs/LG-CLOS-IT/actions/runs/38041245481)도 통과했지만 이후 실제 API가 이전 `37f695d`를 응답하고 브라우저 로그인 403을 재현했다. 따라서 해당 smoke 성공만으로 완료 처리하지 않았다.
- Render 상태와 실제 응답 불일치는 재시작 후에도 지속됐다. [공식 Trigger Deploy API](https://api-docs.render.com/reference/create-deploy)로 동일 검증 커밋 `4878d34`를 `clearCache=clear` 재배포했고 이후 실제 버전/ready를 확인했다. 플랫폼 내부 원인은 확정하지 않으며 코드 결함과 배포 실행 상태를 구분한다. 서비스 플랜은 free 그대로다.
- 최종 실제 Vercel 브라우저: 시연용 버튼 200 → MEMBER 세션 → 의류 사진 6/6 ready → 로그아웃 성공. pageerror=0, 실패 요청=0. 실제 의류 6벌/READY 사진 6개, 착용/관리 기록 0건을 독립 SQL로 확인했다. JWT 토큰·서명 URL 쿼리·비밀번호는 증적에 기록하지 않는다. 증적: Git 제외 `test-results/public-demo-browser.json`, `test-results/public-demo-wardrobe-success.png`.
- 공개 시연 재현: `node web/test/public-demo-browser.mjs`. 기본 Vercel 주소와 기존 공개 옷장 6벌을 사용한다. 다른 공개 프론트는 `PUBLIC_WEB_ORIGIN` 환경변수로 지정한다. 일반 개인 계정의 비밀번호는 필요하지 않다.

## 기능별 결과

파일 경로의 기본 디렉터리는 `web/src/mirror/source/`다.

| 영역 | 구분·결과 | 주요 파일 | 검증·제한 |
|---|---|---|---|
| 미러 IA·내비게이션 | 공유본 개선 및 추천 홈 반영 완료 | MirrorExperience, MirrorHome, PhotoWardrobeStage, homeRecommendations, homeServerActions | 좌우 옷장·중앙 미러의 배경·좌표 유지, 오늘의 코디/계절 보관 추천·출처 전환 |
| 코디 편집·비교 | 공유본 신규/개선 반영 완료 | MirrorOutfitWorkspace, MirrorCompare | 카드 탐색→편집→비교→빠른 상의 교체→편집 복귀, 서버 허용 DRESS 유지 |
| 사진·소유자·카드 정보 | 공유본 개선 및 기존 계약 연결 완료 | core/app, core/outfitAssets, outfitCardPresentation | 로딩/누락/오류 구분, 같은 기기의 다른 소유자 의류 조회, 사진 ID/버전 변경 시 오래된 선택 저장 차단 |
| 업로드·Mock 피팅 | 기존 API 연결 완료 | ServerMockFitting, BackendPanel, MirrorRegistration | 명시적 동의·인물 사진 업로드→MOCK 비동기 작업→결과 조회, 실제 Decart 호출 없음 |
| 코디 확정·카드 | 기존 계약 연결 완료 | secondHandoffActions, ServerCardShare, serverActions | 세션 종료→확인된 슬롯 LED, 카드 PNG 렌더/저장/명시적 공유, 자동 착용/계획 생성 없음 |
| 캘린더·생활 이력 | 공유본 개선 및 기존 계약 연결 완료 | MirrorCalendar, ServerWearConfirmation, lifeHistory, lifeSnapshot | 실제 서버의 불변 착용 구성 조회, 명시적 날짜·시간 입력, 전송 전 취소 및 응답 유실 후 재진입 복구/중복 방지 |
| 관리·위치 | 계약 범위 내 반영 완료 | MirrorCareEvidence, MirrorCareOverview, ServerCareRecord | 관리 일정 등록과 실제 완료 분리, 근거 없는 가이드 요청 차단, 기존 등록 위치 저장. 소급 완료 제한은 아래 참조 |
| 메인 전용 기능 | 보존 | IntegrationActions, integrations/backendClient | 로그인/기기, Mock PURCHASED·LIKED, 일괄 적재, 보관·회수 도구 유지. /legacy 유지 |

동일 기능은 메인 API 어댑터를 유지했다. 공유본의 별도 서버/PGlite/Supabase Auth·자동 생활 데이터 설치/보정은 중복 또는 계약 충돌로 도입하지 않았다. 예시 표시 도우미는 실제 DB 사진·위치·이력을 대체하지 않는다. 공유본의 개발자 `/dev` 앱을 새 제품 진입점으로 추가하지 않았다.

## 추천 홈 시연 요구사항

재현은 아래 [실행한 검증](#실행한-검증)과 [로컬 실행과 사용자 QA](#로컬-실행과-사용자-qa)를 따른다. 모드 전환 버튼은 홈의 시간/인사 아래, 관리 추천·사용 이력은 중앙 스마트미러 내부 스크롤 영역에 있다. 실제 기록의 `내 옷 추천 받기`와 `실제 보관 추천 조회`가 각각 아래 추천/보관 API를 호출한다.

- 홈의 저장 코디 재조회 안내를 오늘의 코디 추천·계절 보관 추천·사용 이력으로 바꿨다. 기존 저장 카드 라이브러리는 코디 메뉴에 유지한다.
- 조회 시점 실제 로컬 DB: 활성 보유 의류 6벌, 퇴역 시드 3벌, 착용/관리/환경 측정 0건. 감사 로그 105건·코디 세션 이벤트 9건은 기술적 사용 로그이며 실제 착용으로 계산하지 않는다.
- 기본 `겨울 전환 시연`은 오늘 16°C→다음 주 7°C, 옷장/첫 번째 방/두 번째 방의 온도·습도 및 최근 7일 사용 횟수를 표시한다. 이 값은 Mock으로 생성한 화면 전용 시나리오다. 실제 보유 사진·의류 ID를 사용할 때도 착용 가능 상태·보온성을 확정하지 않는다. 실제 event/environment/app state에는 가짜 기록을 주입하지 않는다.
- 방 비교는 시연용 범위(습도 40~55%, 온도 25°C 이하)로 두 번째 방을 후보로 제시한다. 소재별 안전 보관 권장치나 실제 방 측정값이 아니다. 나시·반팔은 설명용 예시이며 실제 보유로 등록하지 않는다. 이동은 자동 실행하지 않는다.
- `실제 기록`은 서버 이력을 표시하고, 버튼으로 기존 `/context-snapshots`(MOCK 날씨), `/outfit-recommendations`, `/storage-optimization-jobs`(dry_run=true)를 호출한다. 의류 상태·위치·이력이 미확인이라 추천할 수 없으면 그 상태를 안내한다. 호출 결과를 Mock 성공으로 대체하지 않는다.
- 실제 모드를 기본으로 시작하려면 Vite 실행 전 `$env:VITE_HOME_DEMO_SCENARIO = 'off'`를 설정한다. 미설정 시 시연 모드이며 화면에서 언제든 전환할 수 있다. 공개 환경 반영 여부는 이후 승인·배포 단계에서 결정한다.
- OpenAI API·유료 서비스 호출은 추가하지 않았다. 현재는 규칙과 고정된 Mock 시나리오로 추천 이유를 표시한다. LLM 설명, 실제 주간 예보/센서, 보온성 메타데이터 검증은 별도 통합 범위이며 구현됐다고 보고하지 않는다.
- 검증: 타입/빌드, 단위·회귀 25/25, 격리 DB 브라우저 E2E 11/11. Mock 화면/코디 비교 및 실제 추천·보관 조회 후 보유 의류·착용·관리·카드 건수가 자동 증가하지 않음을 확인했다. 로컬 실제 사진도 확인했다. 관리 추천/사용 이력은 중앙 미러 안에서 스크롤해 본다.

## 의류 이미지 Cache-first

- 원인: 사진 조회 Signed URL은 60초 후 만료된다. 기존 화면은 URL을 계속 보관하고 오류 후 재발급하지 않아 로그인 65초 뒤 옷장 진입 시 6장 중 3장이 MinIO `403 Request has expired`로 실패했다. 기존 재조회 버튼으로 6장 모두 복구되어 원본 파일 손실과 구분했다.
- `imageBlobCache.js`와 `useCachedImage.ts`를 통해 미러 의류 사진과 `/legacy` 의류 사진이 세션 내 Blob/Object URL을 공유한다. 캐시 키는 `image_asset_id`에 대응하는 asset ID와 version이며, 동시 요청은 같은 Promise를 사용한다. 캐시 적중 시 이미지 다운로드와 추가 개별 의류 조회를 하지 않는다.
- DB/API 변경 없음. 기존 의류 조회 응답의 `image.asset_id`, `read_url`, `expires_at`를 사용한다. 목록 API는 기존 계약대로 Signed URL을 응답하므로 명시적 목록 재조회 자체의 서버 URL 생성은 유지한다. 탭 전환이나 60초 타이머로 목록/URL을 갱신하지 않는다.
- 캐시 미스는 아직 유효한 응답 URL을 우선 사용한다. 이미 만료됐으면 기존 `GET /garments/{id}`로 새 URL을 조회한다. 다운로드가 401/403이면 새 URL로 1회만 재시도한다. 새 이미지 ID 또는 로그인 세대가 달라지면 과거 이미지 다운로드를 중단한다. 다른 HTTP 오류는 자동 재시도하지 않는다.
- 정상 등록 계약에서 최종 파일은 같은 ID로 덮어쓰지 않는다. `backend/app/application/assets.py`의 READY finalize는 기존 SHA256과 다르면 거부하고 파일을 다시 쓰지 않는다. 교체는 새로운 이미지 ID다. 현재 asset version=1을 유지하며 캐시 키도 version을 포함한다. 저장소를 직접 조작하는 계약 외 덮어쓰기는 감지 대상이 아니다.
- 등록/교체 응답 및 의류 목록 재조회에서 이미지 ID 변경·누락·의류 삭제를 감지해 캐시를 무효화한다. 로그아웃·로그인 계정 전환·인증 만료 시 전부 abort/revoke/clear한다. 삭제를 다른 클라이언트에서 수행한 경우 기존 API를 재조회하기 전까지 실시간 감지하지 않는다. 페이지 새로고침은 메모리 캐시를 비운다. 영구 저장·주기 갱신은 없다.
- 검증: 타입/빌드 통과, 이미지 캐시 8개 및 기존 관련 회귀 25개 합계 33/33 통과. 실제 로컬 브라우저에서 강제 403 1회 복구 후 65초 만료를 지나도 6장 모두 정상 표시됐다. 다운로드 총 7회(6장 + 실패 1회), 개별 URL 재조회 총 4회(실패 복구 1회 + 만료된 캐시 미스 3회). 탭 재진입과 명시적 목록 재조회 후 다운로드·개별 URL 재조회가 추가되지 않았으며 로그아웃 시 Object URL 해제도 통과했다. 개발 중 브라우저 QA의 중간 timeout 이후 변경을 멈춘 최종 상태로 전체 시나리오를 재실행해 통과를 확인했다. 의류 DB는 변경하지 않았다.
- 범위: 의류 사진 렌더링. 코디카드·VTON 결과·인물 이미지의 별도 다운로드/공유 흐름까지 같은 재발급 계약을 구현했다고 간주하지 않는다. 메모리 캐시는 로그인 세션 동안 이미 열어본 사진을 유지하므로 장시간 대량 사용 시 용량 제한/LRU는 후속 검토 대상이다.

```powershell
node --test web/test/image-cache.test.mjs web/test/api.test.mjs web/test/calendar.test.mjs web/test/second-handoff-state.test.mjs web/test/home-recommendations.test.mjs
node web/test/image-cache-browser.mjs
```

브라우저 명령은 기존 로컬 demo 계정·보유 의류 6벌과 http://127.0.0.1:5181/ 환경을 전제로 한다. 다른 주소는 `$env:WEB_URL`로 지정한다. 증적은 Git 제외 `test-results/photo-cache-browser.json`에 기록하며 Signed URL 쿼리/토큰은 기록하지 않는다.

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
- API·캘린더 회귀 16/16, 변경 상태/사진 참조/공유 의류/DRESS/시간 입력 5/5, 홈 Mock 격리/사진/이력 집계 4/4: 총 25/25 통과.
- 격리 실DB+브라우저 E2E 11/11 통과. 홈 Mock 시나리오·실제 추천 API·보관 dry-run을 추가로 확인했으며, readiness(DB/Redis/Storage/renderer), 로그인·공유 기기·사진·등록, 편집/비교, Mock VTON, 응답 유실 후 확정 재시도·LED 자동 소등·자동 착용 미생성, 카드 PNG 공유, 별도 착용 취소/재시도/복구, 관리 일정/완료/위치 저장, LIKED 조회의 보유 의류 미생성 및 매장 LED 403을 확인했다.
- 관리 근거가 없는 테스트 의류는 가이드를 생성하지 않는 상태를 확인했다. 근거 있는 가이드 전체 및 구매 일괄 등록은 이번 E2E에서 재실행하지 않았다.
- 테스트 쓰기는 전용 임시 DB/API/worker에만 수행했고 종료 시 자원을 정리했다. 실제 로컬·클라우드 DB의 적재/착용/관리 기록은 수정하지 않았다. 실제 로컬 보유 의류 6벌의 사진은 읽기 전용 브라우저 확인을 했다.
- 시작 main·원본 2차 UI와 통합 UI를 실제 브라우저에서 확인했다. 전체 해상도/모든 UI 상태의 시각 QA가 완료됐다는 의미는 아니다.
- 증적(로컬, Git 제외): test-results/second-handoff-live-evidence.json, second-handoff-browser-evidence.json, second-handoff-browser.log, second-handoff-compare.png, second-integrated-wardrobe.png. 최종 E2E 완료: 2026-10-10 12:16 KST. 홈 증적: test-results/home-owned-demo.png, home-storage-demo.png, home-winter-demo.png.
- Ruff(신규 Python 검증 스크립트), Git diff whitespace, 커밋 대상 비밀정보 검사 통과. sip/shower의 독립 문서 검토 후 서비스 준비·데모 로그인 조건·정확한 코드 커밋을 보완했다. ssotize 감사에서 이 문서와 작업 지시의 계약/승인 범위 정합성을 확인했으며 다른 문서는 통합·변경하지 않았다. 검증은 외부 API 응답·DB 읽기·생성된 PNG를 확인하며, Mock 이미지의 실제 피팅 품질이나 사용자 시각 QA를 대신하지 않는다.

재현 명령(프로젝트 루트, 기존 .venv·web 의존성·Compose API 이미지/서비스 필요):

```powershell
docker compose --env-file .env -f infra/compose.yaml --profile test up -d api worker postgres-test
Invoke-RestMethod http://127.0.0.1:8000/health/ready
npm run build --prefix web
node --test web/test/api.test.mjs web/test/calendar.test.mjs web/test/second-handoff-state.test.mjs web/test/home-recommendations.test.mjs
.\.venv\Scripts\python.exe scripts/verify_second_handoff.py
```

API 이미지 또는 renderer 이미지가 없는 환경은 먼저 `docker compose --env-file .env -f infra/compose.yaml build api renderer`로 빌드한다. readiness의 status=ready, database/redis/storage/renderer=ok가 선행 조건이다. 최초 환경 구성·Migration·실제 보유 데이터 적재는 이 작업에서 자동 수행하지 않는다.

검증 스크립트는 기존 로컬 API 이미지와 실행 중인 Redis·MinIO·private renderer 네트워크를 사용한다. 실제 사용자 데이터 대신 임시 DB에서 합성 의류·이미지·기기만 사용하며, VTON과 LED는 MOCK이다.

## 로컬 실행과 사용자 QA

현재 작업용 dev 서버: http://127.0.0.1:5181/ . 실행 중이면 주소를 바로 열면 된다. 기존 5173은 안정 버전 preview일 수 있다.

서버가 꺼져 있을 때 프로젝트 루트에서:

```powershell
git switch main
docker compose --env-file .env -f infra/compose.yaml up -d
$env:WEB_PORT = '5181'
npm run dev --prefix web
```

시연용 로그인은 기존 로컬 demo 계정에 접속하며 현재 작업 환경에서 적재된 보유 6벌을 조회한다. 로컬/test + DEMO_AUTH_ENABLED + AUTH_MODE=DEMO 조건의 기존 API 기능이다. 공개 배포는 아래 별도 MEMBER opt-in 경로를 사용한다. 데이터가 없는 새 DB에서는 6벌을 기대하지 않으며 Fixture를 자동 설치하지 않는다. 계정 미준비(503)나 비활성(403)은 기존 환경 설정·계정 준비 상태를 확인한다.

기존 .env와 설치된 web 의존성을 사용한다. 최초 의존성 설치가 필요할 때만 `npm ci --prefix web`을 실행한다.

1. 마이→내 계정→시연용 로그인→홈: 오늘의 코디 추천, 겨울 전환 시연/실제 기록 전환, 아래로 스크롤해 계절·보관 추천과 사용 이력 확인. 옷장에서는 실제 보유 6벌 사진·상세/검색·기기 표시.
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
4. main 반영은 사용자 승인으로 완료했다. 후속 변경도 커밋과 실제 배포 검증을 기록하고 원격 충돌은 덮어쓰지 않는다.

## 스타일 보관함 QA 수정 (2026-10-10)

- 필터를 `내 옷장 / 쇼핑몰` 두 탭으로 변경했다. 전체·인스타 탭을 제거하고 기본 탭은 내 옷장으로 설정했다.
- 내 옷장은 기존 기기 접근 범위의 `app.garments()` 전체를 표시한다. 카테고리나 저장한 코디로 제한하지 않는다. 의류 선택은 기존 코디 초안의 해당 품목에 연결하며, 쇼핑몰은 기존 외부 구매 후보 흐름을 유지한다. DB·API·원본 디자인 계약은 변경하지 않았다.
- 로컬 브라우저에서 실제 의류 6개 표시, 두 탭 전환, 의류 선택 후 빌더 진입을 확인했다. 화면 캡처를 확인하고 긴 안내 문구를 줄였다. `npm test --prefix web` 33개 통과, `npm run build --prefix web` 통과(기존 번들 크기 경고). 별도 cold read에서 차단 문제는 발견되지 않았다. 공개 배포 화면 검증은 이 변경에서 수행하지 않았다.

## 모바일 미러 반응형 지시서 (2026-10-10)

- [추가 변경 지시서](MOBILE_MIRROR_RESPONSIVE_CHANGE_REQUEST.md)를 작성했다. 데스크톱 원본은 유지하고 모바일에서 좌우 옷장 없이 미러가 전체 화면을 채우는 변경 범위·대상 파일·QA 기준을 정리했다.
- 로컬 브라우저에서 현재 390×844 화면의 미러가 약 58×192px로 축소되는 원인을 확인했다. 반응형 구현 코드는 수정하지 않았으며 구현·실기기 검증은 후속 작업이다.

## 모바일 미러 반응형 구현 (2026-10-10)

- 작업 브랜치는 `dev`이며 main 병합·원격 푸시·배포는 수행하지 않는다. 기준은 [반응형 지시서](MOBILE_MIRROR_RESPONSIVE_CHANGE_REQUEST.md)다.
- `PhotoWardrobeStage.tsx`에서 폭 768px 미만은 실제 뷰포트 크기로 미러를 배치한다. 기존 children을 유지해 표시 모드 전환으로 상태를 재생성하지 않는다. 데스크톱 사진 배율·미러 좌표·geometry 자료는 유지했다.
- `mirror-responsive.css`를 마지막에 추가해 모바일에서 좌우 사진과 LED 사진 레이어를 숨긴다. 후속 QA 요청으로 단색 배경 대신 원본 중앙 미러 영역(x=714..962, y=28..852)만 CSS 배경으로 재사용해 거울 반사 효과를 유지했다. 새 이미지 파일은 만들지 않았다. 메뉴 순서는 유지하고 작업·홈·모달·비교 영역에 세로 스크롤을 적용했다. 안전 여백, dvh fallback, 16px 입력과 주요 터치 영역을 추가했다. `web/index.html`에 viewport-fit=cover를 추가했다.
- 모바일 비교에서 전체 화면 버튼이 더 보기 버튼을 가리는 문제를 확인해 전체 화면 버튼을 좌측 상단으로 이동했다. DB·API·인증·이미지 캐시·LED 권한·원본 설계 문서는 변경하지 않았다.
- 자동 QA: `node web/test/responsive-browser.mjs`에서 9개 뷰포트(360×800, 390×844, 430×932, 767×844, 667×375, 768×844 및 데스크톱 3종)의 미러 치수·배경 비노출·페이지 수평 스크롤 없음을 확인했다. 실제 시연 계정의 의류 6개·사진·검색·등록 화면·두 스타일 탭·코디 선택을 확인했다. 낮은 가로 화면에서 등록 하단 버튼까지 스크롤로 접근했다. 왕복 resize에서 로그인·초안 유지, 의류/사진 추가 요청 0, 브라우저 오류 0이었다.
- 데스크톱 3종의 홈·옷장·코디 캡처에서 좌우 물리적 옷장 18개 영역 픽셀이 변경 전과 동일했다. 미러 좌표도 기존 계산과 1px 이내로 일치했다. 전체 동적 UI의 픽셀 동일성을 주장하는 결과는 아니다.
- 단위 테스트 33개 통과. 빌드는 통과했고 기존 큰 번들 경고는 남아 있다. 격리 DB·Redis·MinIO를 사용하는 기존 데스크톱 E2E 11개가 통과했다. 최신 빌드의 390×844 모바일 E2E도 11개 전부 통과했다(브라우저 오류 0, 실제 DB·스토리지·renderer 사용, VTON·LED는 Mock). 실제 이미지 업로드·의류 등록·코디카드 생성/공유·착용/관리 기록·쇼핑/권한 검증과 격리 자원 정리가 포함된다.
- LED QA는 2초 TTL보다 긴 모바일 스크롤·재확인 때문에 잘못 실패하지 않도록 실제 LED 명령 HTTP 응답의 ON·anchor_ids를 먼저 검증하고, 별도 상태 API에서 자동 소등을 확인하도록 수정했다. TTL이나 제품 로직을 늘리거나 생략하지 않았다.
- 증적은 미추적 `test-results/responsive-browser.json`, `responsive-mobile-*.png`, `responsive-before-*.png`, `responsive-after-*.png`, `second-handoff-browser-evidence.json`에 저장한다. 실행한 격리 E2E는 테스트 데이터·컨테이너를 종료 시 정리한다. Mock VTON·LED만 사용하며 유료 API를 호출하지 않는다.
- **미검증:** 실제 iOS Safari·Android Chrome의 키보드, 주소창, 노치/제스처 safe-area 및 실제 기기 회전. 진행 중 VTON의 resize는 별도 재현이 필요하다. 현재 결과는 Chromium 뷰포트 QA이며 지시서의 모든 검증 완료로 판정하지 않는다.

재현(PowerShell, 프로젝트 루트):

```powershell
npm run dev --prefix web -- --host 127.0.0.1 --port 5181
# 별도 터미널, 기존 로컬 API/DB/Redis/MinIO 및 renderer 실행 필요
node web/test/responsive-browser.mjs
npm test --prefix web
npm run build --prefix web
$env:INTEGRATION_MOBILE='1'
.\.venv\Scripts\python.exe scripts/verify_second_handoff.py
Remove-Item Env:INTEGRATION_MOBILE
# 기본 데스크톱 E2E
.\.venv\Scripts\python.exe scripts/verify_second_handoff.py
```

### 거울 배경 복원 QA

모바일에서 거울 질감이 사라진 문제를 수정했다. `mirror-responsive.css`의 중앙 미러 배경만 변경하고 원본 리소스를 재사용한다. `responsive-browser.mjs`의 9개 뷰포트 및 사용자 액션 QA를 재실행해 통과했고, 모바일 홈 캡처를 직접 확인했다. 빌드 통과. DB·API·데스크톱 변경 없음. 실기기 미검증 항목은 그대로 남아 있다.
