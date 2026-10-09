# Smart Wardrobe 통합 구현 결과

검증일: 2026-10-09. 범위: Sprint 7 FastAPI와 팀원 스마트미러 UI의 로컬 개발용 통합.

후속 로컬 데이터 상태: 실제 의류 6벌과 사진 6개를 적재하고 브라우저 표시를 확인했다. 기존 Seed 3건은 retired, 저장된 Seed 코디는 ARCHIVED로 보존한다. 위치 미확인 의류에 시각을 기록하던 결함을 수정했다. 아래 최초 통합·Seed 검증 기록과 구분하며 최신 데이터 증거는 [적재 실행 결과](OWNED_GARMENT_IMPORT_RESULT.md)를 따른다.

## 판정과 검증 범위

핵심 시나리오 10개가 실제 HTTP·PostgreSQL·Redis·MinIO·Celery·Chromium 카드 렌더러를 거쳐 통과했다. 브라우저에서도 개인 계정 로그인, 이미지 업로드·의류 등록·검색, 서버 추천 선택, Mock VTON·코디 확정, 카드 이미지 생성·저장·공유, 구매 중복 방지, LIKED VTON을 실행했다. VTON·쇼핑·LED는 Mock이며 실제 피팅 품질·실물 LED·외부 쇼핑 계정 연동을 검증한 결과가 아니다.

로컬 DB에 `0004_device_integration`을 적용했다. 기존 의류 3건의 모든 기존 컬럼 및 `garment_state` 해시, 착용 이력 0건·코디 3건·카드 0건이 적용 전후 동일했다. 백업은 Git 제외 디렉터리 `test-results/wardrobe-before-integration-20261009T081429Z.dump`에 보관한다. 신규 개인 계정의 비밀번호, HOME/STORE 접속 기기 인증, 실제 위치↔LED 매핑은 관리자가 명시적으로 등록해야 한다. 기존 Seed 의류에 LED 칸이나 인물 사진을 임의로 부여하지 않았다.

**소등 시간은 제품 정책 미확정이다.** 런타임 `LED_OFF_SECONDS`가 없으면 LED 명령은 503으로 거부한다. 격리 E2E에만 명시적으로 2초를 지정했다. 이 값은 로컬 실행 기본값이나 제품 결정이 아니다. 따라서 Mock 통합 시나리오 검증은 통과했지만, 사용자 로컬 QA에 필요한 계정·기기·물리 위치 및 소등 설정까지 완료했다고 판정하지 않는다.

## 적용 계약과 기존 문서 차이

- 참조: HLD 03, FSD 04, OpenAPI 06, DB 07, 구현 추적표, 확정 결정 11, 프론트 FSD 12, 백엔드 변경안 13, 충돌 검토 14, 쇼핑 변경 요청 09 및 DB 적재 설계 10. 이미 작성된 `INTEGRATION_PREPARATION_REPORT.md`의 조사 결과를 재사용했다.
- 최신 사용자의 통합 구현 지시를 근거로 11~14의 확정 정책을 구현했다. 초안의 이전 ‘코드 적용 전 승인’ 문구를 새 제품 정책으로 취급하지 않았다.
- 원본 설계 문서 7개와 팀원 전달본은 수정하지 않았다. 기존 `/api/v1`의 필수 필드·52개 operation 및 owner/household 경계를 유지하고 `/api/v1/integration` 12개 operation을 추가했다. Garment/GarmentUpsert에 선택 device_id/name을 추가한 것은 명시적 계약 확장이다. 원본 OpenAPI/SQL은 확장 내용을 포함하지 않으며, **실행 중인 `/openapi.json`과 Migration 0004가 새 계약의 구현 증거**다. API 기본 버전 표기는 기존 `1.7.0`을 유지한다.
- 원본 Garment의 `additionalProperties: false`와 충돌하지 않도록 기존 데모 인증의 목록·상세·등록·수정 응답에서는 device_id/name을 제외한다. 확장 필드는 새 개인 계정 로그인에만 제공한다. 기존 엄격한 응답 검증자는 기존 인증 경로와 원본 응답을 사용할 수 있고, 개인 계정 통합 클라이언트는 실행 OpenAPI의 확장 스키마를 사용해야 한다. 실제 Legacy API 응답을 원본 허용·필수 키와 대조하는 회귀 검사를 추가했다.
- `user_id`는 기존 `member.id`에 대응한다. 보관 기기 `device.id`와 접속 미러 `access_station.id`는 별개다. 다른 HOME/STORE 미러 로그인은 같은 계정 데이터를 읽지만, STORE에서 집 LED 명령은 403이다.
- 기존 가구마다 하나의 논리적 HOME 옷장을 백필하고 기존 구성원·의류를 연결했다. 실제 하드웨어 식별/슬롯 매핑을 검증했다는 의미가 아니다. 위치 매핑은 자동 백필하지 않는다. 여러 보관 기기 선택 UX는 후속 정책 이슈로 남긴다.
- 별도 착용 예정 저장 계약, 가방·모자의 기존 outfit 슬롯 대응은 미확정이다. plan 원장이나 임의 ACCESSORY 변환을 추가하지 않았다.

## 구현 기능과 주요 파일

| 기능 | 구현 및 근거 |
|---|---|
| 개인 로그인·세션 | `backend/app/api/v1/integration.py`, `core/passwords.py`, `core/security.py`: 솔트 PBKDF2 비밀번호, 서명된 개인 계정/접속 기기 클레임, 계정 활성 검사, Redis 로그아웃 폐기. UI 토큰은 메모리에만 보관 |
| 기기별 전체 의류 | Migration 0004, `sprint1_repository.py`, `application/sprint1.py`: 같은 household 안의 기기 멤버십 조회. owner 유지, 개인 코디·이력은 member 범위. 기존 데모 JWT는 기존 조회 범위 유지 |
| 등록·수정·이미지 | `schemas/sprint1.py`, `web/src/api.js`, `mirror/source/integrations/backendClient.ts`, `MirrorRegistration.tsx`, `IntegrationActions.tsx`: 선택 name/device DTO, 기존 version·동의·업로드 intent/PUT/finalize 재사용. category/color 필수, brand/size 컬럼 없음 |
| 검색·위치·LED | 실제 의류 목록 검색, 등록된 location UUID만 선택. 서버가 신뢰도≥0.9, 24시간 이내 관측, 명시적 매핑, HOME 접속 기기를 검사. 다중 칸·UUID 멱등 명령·만료 후 OFF. `MirrorExperience.tsx`가 서버 상태를 표시 |
| 추천·선택·확정 | 기존 context/recommendation/session-end API 연결. UI 고정 품목은 보존한다. 코디 확정은 최종 선택과 LED 명령만 실행하며 plan/wear를 호출하지 않는다. 변경 불확실/권한 실패를 성공으로 표시하지 않는다 |
| 보유 의류 VTON | 기존 Sprint 3 worker·READY 자산/동의·AVAILABLE 검사 재사용. 비동기 상태 폴링과 실제 Mock PNG 표시. 입력 준비가 안 된 코디는 거부 |
| 코디카드 | 기존 Sprint 4 카드 draft/render/save/share 연결. 실제 Chromium PNG 1080×1350 생성·MinIO 저장·공유 응답 확인. 단순 합성 썸네일을 카드 완료로 취급하지 않음 |
| 케어·보관/회수 | 기존 care-guide, care-schedules 조회, storage optimization 비동기 제안 연결. 가이드·일정·확인된 기록을 구분하고 실제 이동이나 세탁 이력을 만들지 않음 |
| PURCHASED | `adapters/shopping.py`, `api/v1/shopping.py`: 합성 Mock 전체 구매 내역, 일괄 등록, 취소/반품 제외, 필수 누락 검토. source/item/unit 유일키+트랜잭션 잠금으로 다른 요청 키 재실행도 중복 방지 |
| LIKED | 별도 external VTON 작업·`workers/external_vton.py`: 관심 상품 식별자와 동의된 인물 사진만 연결. garment/outfit/card/wear 자동 생성 없음 |
| 팀원 UI 보존 | `web/src/entry.js`, `web/src/mirror/source/`, `web/public/`: 기본 경로 팀원 미러, `/legacy` 기존 화면. CSS·PhotoWardrobeStage·geometry·public 90개 파일 SHA256 비교에서 변경 0개. 내부 연결 모달만 기존 스타일로 추가 |
| 관리·재현 | `scripts/provision_integration.py`, `apply_integration_local.py`, `verify_integration.py`, `verify_backend_tests.py`, `check_mirror_assets.py`. 비밀번호는 getpass 입력, 테스트 계정은 격리 환경에서 무작위 생성 |

작업 생성 당시의 `personal_account` 범위를 VTON/Card/Storage 작업 payload에 보존한다. 기존 작업을 개인 계정 작업으로 임의 승격하지 않으며, 작업 처리 시 현재 동의·자산·기기 접근을 다시 검사한다. Storage의 기기 전체 조회는 개인 계정의 dry-run 제안에만 적용한다. 실제 이동 액션의 소유자 범위는 유지하며, 가족 계정의 dry-run 조회 성공과 non-dry-run 거부를 검증했다.

## API 및 DB 변경

추가 API는 다음 12개다. LED 및 쇼핑 쓰기는 `Idempotency-Key: UUID`를 요구한다.

| 메서드 | `/api/v1/integration` 하위 경로 | 역할 |
|---|---|---|
| POST | `/login` | login/password 및 선택 station_id/station_credential 인증 |
| POST | `/demo-login` | 로컬·테스트의 활성 demo 계정으로 비밀번호 없는 시연 진입 |
| POST | `/logout` | 현재 개인 세션 폐기 |
| GET | `/devices` | 사용자에게 연결된 보관 기기 |
| GET | `/devices/{device_id}/locations` | 기존 위치와 검증자가 등록한 anchor |
| POST | `/led-commands` | device_id + garment_ids의 확인된 칸만 제어 |
| GET | `/devices/{device_id}/led-state` | 활성 Mock 명령과 만료 기반 OFF 조회 |
| GET | `/shopping/purchases` | 합성 전체 구매 내역 |
| GET | `/shopping/liked` | 관심 상품, 보유 의류로 변환하지 않음 |
| POST | `/shopping/purchases/bulk-import` | 등록/제외/검토/실패 항목 결과 및 건수 |
| POST | `/shopping/liked/vton-jobs` | 외부 상품 Mock VTON 큐 등록 |
| GET | `/shopping/liked/vton-jobs/{job_id}` | 본인의 작업 상태 및 READY 결과 |

Migration 0004: nullable `garment.device_id`와 household 일치 FK/인덱스 추가. 신규 8개 테이블: `device`, `device_member`, `account_credential`, `access_station`, `lighting_zone`, `led_command`, `shopping_import`, `external_vton_job`. owner_id/household_id 및 기존 이력 유지. 신규 household/member/garment의 단일 기기 연결 트리거는 다중 기기에서 임의 배정을 하지 않는다. 자동 downgrade로 기존 연결을 잃지 않도록 하향 Migration은 지원하지 않으며, 백업과 전진 수정으로 복구한다.

## 실행한 검증

| 검증 | 결과 | 증거 |
|---|---|---|
| 기존 단위·계약 테스트 | 111 passed, 110 deselected | pytest 실제 실행 |
| 실DB 회귀, 기존 E2E 포함 | 111 passed, 111 deselected | `test-results/backend-integration-regression.log`, 시연 로그인 추가 검사 포함 |
| Migration 기존 데이터 보존/재실행 | 통과 | `backend/tests/integration/test_device_migration.py`, 로컬 migration JSON |
| API 핵심 10개 + 보안 거부 시나리오 | 통과 | `test-results/integration-live-evidence.json`, browser evidence의 checks |
| 실제 브라우저 로그인·등록·검색·추천·VTON·카드·쇼핑·수정·케어·위치·보관 제안·로그아웃 | 7개 묶음 통과 | `test-results/integration-browser-evidence.json`의 ui_checks, 1920×1080 스크린샷 |
| 기존 프론트 `/legacy` 브라우저 회귀 | 18개 시나리오 통과 | `test-results/frontend-browser.log`, `frontend-live-evidence.json` |
| 웹 API 클라이언트 테스트 | 13 passed | `npm test` |
| TypeScript·Vite build | 통과 | `npm run build` |
| Ruff | 통과 | backend/app·alembic·통합 scripts 검사 |
| 실행 OpenAPI Validator | 통과, 56 paths | 실행 `/openapi.json` 검증, 시연 로그인 경로 포함 |
| 시각 소스 보존 | 90개 비교, 변경 0개 | `mirror-visual-source-evidence.json` |
| 로컬 readiness | database/redis/storage/renderer 모두 ok | `/health/ready` |

API 검사와 브라우저 검사는 별개다. 기기 간 조회·가족 전체 조회·STORE LED 차단·소등은 실제 API와 DB 기반 검증이며 모든 항목을 브라우저 테스트라고 주장하지 않는다. plan/wear 부재는 DB의 wear_event 및 plan 이름의 session event 건수로 확인했다. 별도 plan 테이블은 현재 계약에 없다. Mock 성공은 실제 외부 서비스의 성공 증거가 아니다.

테스트 DB 이름은 `wardrobe_test_<UUID>`, 컨테이너는 고유 이름·loopback 임시 포트·독립 worker queue를 사용했다. 테스트 이미지는 합성 단색 PNG이며 실제 사용자 의류/인물 이미지를 사용하지 않았다. 마지막에 임시 DB·컨테이너·테스트 자산을 제거했다. 실제 로컬 DB에서 구매 일괄 등록/의류 추가를 실행하지 않았다.

최종 통합 실행: `2026-10-09T08:54:46Z`. API 핵심 10개와 보안 거부 검사 1개 묶음, 브라우저 7개 묶음 모두 통과. 브라우저가 loopback 외부 호스트에 보낸 요청은 0건이었다. 임시 자원 제거도 완료했다. 기존 Seed 신발의 이미지 누락으로 발생한 ASSET_UNAVAILABLE는 정상 차단이었다. 격리 테스트에서만 해당 신발에 합성 이미지를 실제 API로 업로드해 전체 추천 조합의 VTON을 검증했다. 위치·업로드 URI 검사 및 모달 재조회 결함은 수정 후 실제 브라우저에서 재검증했다. 로그아웃은 서버 폐기와 메모리 의류 목록 제거를 함께 검증했다.

최종 실DB 회귀는 `110 passed, 111 deselected`였고, 최종 배포 이미지의 단위·계약 검사도 `111 passed`였다. 개인 계정 발급 시 기존 카드의 공유 조회 범위가 바뀌는 코드 결함을 수정했다. 공유 이미지를 생성한 성공 작업의 서버 저장 `personal_account` 값을 사용하며, 과거 작업에 값이 없으면 기존 owner/share 범위를 유지한다. PNG·WEBP 실렌더 회귀에서 계정 발급 및 기기 접근 제거 후에도 기존 공유 계약이 유지됨을 검증했다. 개인 계정 가족 구성원이 같은 기기의 타인 소유 의류로 카드 생성·렌더·저장·공유하는 신규 경로도 실제 API·worker·MinIO로 통과했다. 로컬 API·worker는 이 최종 코드 이미지로 갱신했고 readiness의 4개 항목이 모두 정상이다.

## 남은 이슈와 위험

### 후속 시연 로그인 버튼

사용자 요청에 따라 로컬 Seed의 Demo User에 시연 계정을 발급하고, `마이 → 내 계정 → 시연용 로그인` 버튼을 연결했다. 비밀번호·기기 인증 입력 없이 버튼만 클릭해 개발용 Seed 의류 3건을 조회하고, 로그아웃 후 화면 목록이 0건으로 초기화되는 실제 브라우저 검증을 통과했다. DB 의류는 유지된다. 사진이 없는 Seed에 이미지를 임의 생성하지 않았으며 실제 상품 목록 적재는 별개로 미실행이다.

프론트에 비밀번호를 넣지 않는다. `/integration/demo-login`은 기존 `APP_ENV=local/test`, `PUBLIC_DEPLOYMENT=false`, `DEMO_AUTH_ENABLED=true`, `AUTH_MODE=DEMO` 조건을 모두 검사하며, 고정 Seed 사용자에 관리자가 발급한 활성 `demo` 계정이 있어야 한다. 별도 기기 권한이나 동의는 부여하지 않는다. 기존 개인 세션의 조회 범위·만료·로그아웃 폐기를 사용하고 로그인 rate limit을 적용한다. 격리된 로컬 PostgreSQL 테스트 DB의 회귀는 활성 계정 부재/비활성 503, 시연 인증 비활성·JWT 모드·운영 환경·공개 배포 403 및 로그아웃 토큰 401을 확인했다. 로컬 서비스 갱신 직후 readiness 전 브라우저 요청은 프록시 502였으며, readiness 정상 확인 후 같은 버튼 경로를 재실행해 통과했다. 증적은 Git 제외 `test-results/demo-login-wardrobe.png`와 `test-results/backend-integration-regression.log`에 있다. 팀원 원본의 CSS·geometry·고정 자산 등 시각 소스 90개는 변경되지 않았다.

| 우선 | 항목 | 처리 상태 |
|---|---|---|
| 로컬 QA 준비 | 계정 비밀번호, HOME/STORE 인증, 확인된 슬롯 매핑, LED_OFF_SECONDS | 관리 CLI/환경변수 지원. 사용자 비밀번호·물리 위치·소등 정책은 임의 설정하지 않음 |
| P1 미확정 정책 | plan/calendar CRUD, 가방·모자 슬롯, 여러 보관 기기 선택 | 추가 원장·필드·UI 정책을 구현하지 않음. 팀원 UI의 명시적 기록 기능 중 미연결 액션은 오류로 표시하며 자동 기록 금지 |
| P1 하드웨어 | 실제 기기 인증/attestation·LED 제어/소등 | 현재 로컬 관리자 발급 credential와 시간 기반 Mock 상태. 장치 도달 여부·실물 동작 미검증 |
| P1 외부 서비스 | Decart, 실제 쇼핑 API, 실제 날씨/캘린더/ThinQ | Mock 검증. 유료 API 호출 없음. Decart 실계정·비용 검증은 별도 단계 |
| P1 운영 보안 | 기존 MinIO 개발용 바이너리, 계정 lifecycle/비밀번호 변경 시 전 세션 폐기, production identity | 운영 안전성 판정 없음. 서비스는 loopback에 유지. 기존 MinIO 위험은 Sprint 0 보고서 참조 |
| P2 UI 운영성 | 서명 URL 만료 후 재조회, 서버 재시작 후 로그인, 모달의 긴 기능 목록 | 만료/오류를 성공으로 대체하지 않음. 메모리 세션이므로 새로고침 후 재로그인 필요 |
| P2 빌드 | Decart 참조 SDK 포함 일부 번들 500kB 초과 경고 | 빌드 성공. 유료 기능 활성화 또는 디자인 변경 사유로 사용하지 않음 |

## 로컬 실행과 재현

프로젝트 루트 PowerShell. 기존 `.env`는 유지하며 출력하거나 커밋하지 않는다.

```powershell
docker compose --env-file .env -f infra/compose.yaml build api
# 이미 검증된 로컬 데이터를 백업·비교한 뒤 Migration과 API/worker 적용
.venv/Scripts/python.exe scripts/apply_integration_local.py
docker compose --env-file .env -f infra/compose.yaml exec -T api python /workspace/scripts/provision_integration.py list
```

`list`의 실제 member/device UUID를 사용한다. 아래 자리표시는 그대로 실행하지 않는다. 계정·기기 credential은 대화형 입력이며 코드/명령 인자로 남기지 않는다.

```powershell
docker compose --env-file .env -f infra/compose.yaml exec api python /workspace/scripts/provision_integration.py account --member <MEMBER_UUID> --login <LOGIN>
docker compose --env-file .env -f infra/compose.yaml exec api python /workspace/scripts/provision_integration.py station --kind HOME --device <DEVICE_UUID> --name <HOME_MIRROR_NAME>
docker compose --env-file .env -f infra/compose.yaml exec api python /workspace/scripts/provision_integration.py station --kind STORE --name <STORE_MIRROR_NAME>
docker compose --env-file .env -f infra/compose.yaml exec api python /workspace/scripts/provision_integration.py zone --location <VERIFIED_LOCATION_UUID> --device <DEVICE_UUID> --anchor <VERIFIED_TEAM_ANCHOR_ID>
```

추가 구성원을 같은 가구의 기기에 명시적으로 연결하려면 `provision_integration.py link --member <MEMBER_UUID> --device <DEVICE_UUID>`를 사용한다. 다른 household 연결은 거부한다. 기존 로컬 Demo User를 QA 계정으로 발급하는 예는 다음과 같으며, 비밀번호는 실행 시 사용자가 입력한다. 실제 보유 의류 데이터가 아니라 기존 개발용 Seed 계정이다.

```powershell
docker compose --env-file .env -f infra/compose.yaml exec api python /workspace/scripts/provision_integration.py account --member 20000000-0000-4000-8000-000000000001 --login local-qa
```

소등 시간 확정 후에만 `.env`에 `LED_OFF_SECONDS=<선택한 1~3600초>`를 설정하고 API/worker를 재생성한다. `.env`에는 비밀정보가 있으므로 Git 제외 상태를 유지한다. UI에서 마이 → 내 계정으로 로그인하고 HOME 미러 ID·credential을 입력한다. 기기 인증 없이도 로그인·데이터 조회는 되지만 LED는 거부된다. 업로드 동의를 사용자가 선택하고 사진을 등록한다. 실제 위치가 확인되지 않으면 위치를 입력하지 않는다.

```powershell
cd web
npm ci
npm run dev
# http://127.0.0.1:5173, 기존 프론트는 /legacy
```

기존 테스트용 PostgreSQL 서비스가 기동한 상태에서, root 경로로 돌아와 격리 검증을 재현한다. 포트 5174는 harness가 사용한다.

```powershell
cd web
npm run build
npm test
cd ..
.venv/Scripts/python.exe scripts/verify_backend_tests.py
.venv/Scripts/python.exe scripts/verify_integration.py
.venv/Scripts/python.exe scripts/check_mirror_assets.py
```

`test-results/`에는 검증 증거·스크린샷·DB 백업이 있으므로 커밋하지 않는다. `check_mirror_assets.py`에는 원본 팀원 전달 디렉터리가 필요하다. 보고서의 결과는 현재 작업 환경에서 실행한 증거를 기준으로 하며 외부 API·하드웨어 검증을 대신하지 않는다.
