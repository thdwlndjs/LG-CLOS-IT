# Smart Wardrobe 로컬 프로토타입

기존 설계의 Sprint 0 플랫폼과 계약 1.7의 Sprint 1~7 업무 API 52개를 제공한다. 카드 렌더링·비공개 저장·공유·코디 재사용과 명시적 착용 이력·케어 프로필·관리 일정·수행 기록을 구현했다. 실제 Decart 유료 호출 검증은 사용자의 요청에 따라 모든 Sprint 종료 후 수행한다. IA 여섯 메뉴의 프론트엔드를 구현했고 사용자 직접 QA를 대기한다. 선택 외부 연동과 유료 API 검증은 직접 QA 이후 진행한다.

현재 구현/검증은 [Sprint 7 보고서](docs/SPRINT_7_REPORT.md), 과거 증적은 각 Sprint 0~6 보고서, 계약 결정은 [DECISIONS](docs/DECISIONS.md), 기능별 상태는 [추적표](docs/IMPLEMENTATION_TRACEABILITY.md)를 따른다.

private local 환경에서 Sprint 0 필수 플랫폼 검증을 완료했다. 고정 의존성의 단위·계약·실DB 테스트 51개, 공식 MinIO 바이너리의 hash·서명 검증, 비루트 기동, 실제 S3 CRUD, readiness와 smoke가 통과했다. **기존 MinIO 서버에는 알려진 취약점이 남으므로 이 이미지는 로컬 개발 전용이며 운영 배포에 안전한 버전으로 간주하지 않는다.** 환경별 빌드 제한과 증적은 [Sprint 0 보고서](docs/SPRINT_0_REPORT.md)를 따른다.

## Docker로 시작

Python 3.12와 Linux containers를 실행하는 Docker Compose가 필요하다. 저장소 루트에서 실행한다. bootstrap은 임의의 로컬 비밀값을 `.env`에 생성하며 기존 파일을 덮어쓰지 않는다. `.env`를 공유하거나 커밋하지 않는다.

```powershell
python scripts/tasks.py bootstrap
python scripts/tasks.py up
python scripts/tasks.py migrate
python scripts/tasks.py seed
python scripts/tasks.py smoke
```

Windows에서 Python이 PATH에 없다면 설치된 Python 3.12의 절대 경로로 실행한다. 이 작업 환경에서는 다음 명령으로 bootstrap을 실행했다.

```powershell
& 'C:/Users/aicam/AppData/Local/Programs/Python/Python312/python.exe' scripts/tasks.py bootstrap
```

make가 있으면 `make bootstrap up migrate seed smoke`도 같은 동작이다. [env.example](infra/env.example)을 수동으로 복사할 때는 모든 `CHANGE_ME` 값을 변경하고 PostgreSQL 비밀번호와 DATABASE_URL 비밀번호를 일치시킨다. `.env` 예제의 hostname은 Compose 내부 주소다.

API: <http://localhost:8000/docs>, <http://localhost:8000/openapi.json>. Swagger에는 구현된 Sprint 1~7 업무 operation 52개를 노출한다. `/health/live`는 프로세스 상태, `/health/ready`는 현재 DB migration revision·Redis·bucket·Chromium renderer 기동을 검사한다. migrate 전 readiness는 503이며, API의 Compose healthcheck는 bootstrap 순환을 피하기 위해 liveness를 사용한다. health 경로는 업무 OpenAPI 계약 외 운영 경로다.

Seed는 데모 가구 1개·가구원 2명·의류 3벌·위치 2개·Context·저장 코디를 생성하며 실제 착용 이력은 생성하지 않는다. smoke는 live/ready/OpenAPI/Swagger의 HTTP 성공과 ready 상태를 확인한다.

MinIO console: <http://localhost:9001>. 자격 증명은 로컬 `.env`에서 확인한다. bucket에는 공개 읽기 정책을 부여하지 않는다. 외부 서비스 포트는 호스트 loopback에만 바인딩한다. Compose는 공식 GitHub의 기존 MinIO 바이너리를 SHA-256과 Minisign으로 검증해 자체 이미지로 빌드한다. runtime UID/GID는 10001이며, hash·서명 검증 실패 시 빌드도 실패한다. 9000/9001을 외부 주소로 publish하지 않는다.

실제 업로드·다운로드·삭제와 익명 읽기 거부 검증은 `docker compose --env-file .env -f infra/compose.yaml exec -T api python /workspace/scripts/check_storage.py`로 실행한다. 기존 bucket의 고유 임시 key만 사용하고 정리한다.

## 테스트

```powershell
python scripts/tasks.py test-unit
python scripts/tasks.py test-contract
python scripts/tasks.py test-integration
python scripts/tasks.py lint
```

통합 테스트는 별도 `postgres-test` 인스턴스에서 임의 이름의 테스트 DB를 생성한다. 빈 DB migration, migration 재실행, seed 두 번 실행, 현재 32개 테이블/10개 ENUM (과거 baseline은 30개), 무결성 제약, tenant FK, 트랜잭션 rollback을 검사한 후 자신이 만든 DB만 삭제한다. API가 사용하는 주 DB는 수정하지 않는다. 테스트 DB 인스턴스는 휘발성 저장소를 사용한다.

`python scripts/tasks.py smoke-sprint1`은 실제 HTTP readiness·데모 로그인·의류 목록·설정·구조화 위치 조회를 검사한다. 의류와 설정은 변경하지 않으며 로그인 세션의 멱등 응답·audit만 저장한다. `python scripts/tasks.py test-e2e-mock`은 원문 FSD E2E-01~09를 전용 DB에서 검증한다. Sprint 1 전체 HTTP 등록·수정·관측·이미지·공유·삭제 검증은 `python scripts/tasks.py test-e2e-sprint1`로 별도 테스트 DB/API에서 실행한다. 먼저 `postgres-test`를 띄우고 Docker CLI가 있는 호스트에 해시 lock의 의존성을 설치해야 한다. Windows의 55432 포트 제한 환경은 보고서의 ports reset override를 사용한다. 증적과 정확한 재현 명령은 [Sprint 1 보고서](docs/SPRINT_1_REPORT.md)에 있다.

## Docker 없이 실행

저장소 루트에서 bootstrap으로 `.env`를 먼저 생성한다. 실제 PostgreSQL 16, Redis, S3 호환 저장소를 따로 실행하고, 생성된 `.env`의 DATABASE_URL·REDIS_URL·CELERY_BROKER_URL·CELERY_RESULT_BACKEND·STORAGE_ENDPOINT를 해당 주소와 자격 증명으로 수정한다. PostgreSQL에는 별도 빈 wardrobe DB를 준비한다. DB/Redis/스토리지를 Mock으로 대체하는 기동 모드는 제공하지 않는다.

Sprint 4부터는 별도 renderer와 `CARD_RENDERER_URL`도 필요하다. 아래 명령은 Python API/worker만 실행하는 절차이며 renderer가 없으면 readiness는 503이고 카드 렌더링은 실패한다. 현재 전체 서비스 검증은 Compose 경로로 수행했다. 수동 renderer 환경의 브라우저 설치·네트워크 격리는 별도로 구성해야 한다.

```powershell
python scripts/tasks.py bootstrap
# 여기서 .env를 수동 실행 서비스의 주소/자격 증명으로 수정한 후 계속한다.
python -m venv .venv
& .venv/Scripts/python.exe -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
& .venv/Scripts/python.exe scripts/init_storage.py
Push-Location backend
& ../.venv/Scripts/python.exe -m alembic upgrade head
Pop-Location
& .venv/Scripts/python.exe scripts/seed.py
& .venv/Scripts/python.exe -m uvicorn app.main:create_app --factory --app-dir backend --port 8000 --no-access-log
```

별도 터미널에서 worker를 실행한다.

```powershell
Push-Location backend
& ../.venv/Scripts/python.exe -m celery -A app.workers.celery_app:celery_app worker --pool=solo --concurrency=1 --loglevel=INFO --beat --schedule=/tmp/wardrobe-celerybeat
Pop-Location
```

설치 후 로컬 테스트는 `backend`에서 `python -m pytest tests/unit tests/contract -q`로 실행한다. 실제 DB 통합 테스트에는 **별도 인스턴스**의 `TEST_DATABASE_URL=postgresql+asyncpg://.../wardrobe_test`가 필요하다. 미설정 시 skip으로 보고한다.

requirements.txt/requirements-dev.txt는 직접 의존성 핀이며, requirements.lock은 해시 포함 전이 의존성 lock이다. Dockerfile은 lock을 `--require-hashes`로 설치한다. Python 3.12.9의 Windows·Linux 환경에서 직접 핀 일치와 Linux 이미지 빌드를 검증했다. 상세 결과는 [D-007](docs/DECISIONS.md)과 [Sprint 0 보고서](docs/SPRINT_0_REPORT.md)에 있다.

## 인증·외부 서비스

`DEMO_AUTH_ENABLED=true` 또는 `AUTH_MODE=DEMO`는 private local/test에서만 허용한다. staging/production 또는 `PUBLIC_DEPLOYMENT=true`와 함께 사용하면 부팅을 거부한다. JWT는 HS256/만료/issuer/audience를 검증하며, 인증 dependency는 DB의 member·household·role을 다시 확인한다. 공개 서비스의 완전한 인증 제품 정책은 별도 작업이다.

`POST /api/v1/sessions`에 `Idempotency-Key` UUID 헤더와 아래 JSON을 보낸다. Seed의 두 프로필 ID만 명시적으로 허용하며 역할은 OWNER/MEMBER/CHILD로 반환한다.  DB에 임의로 추가한 프로필을 데모 로그인으로 열지 않는다. 응답 access_token을 Swagger의 Authorize에 입력하면 자기 소유 및 명시적으로 공유받은 의류와 자기 설정을 조회할 수 있다. 토큰을 로그·문서·명령 기록에 붙여 넣지 않는다.

```json
{"household_id":"10000000-0000-4000-8000-000000000001","member_id":"20000000-0000-4000-8000-000000000001","demo_mode":true}
```

등록은 `POST /api/v1/garments`에 새로운 `Idempotency-Key`와 `owner_id`, `category`, `color`를 보낸다. 수정은 `PATCH /api/v1/garments/{garment_id}`에 조회된 `version`을 `If-Match` 헤더로 보낸다. 반복 등록은 같은 key·body면 동일 응답, 다른 body면 409이며 stale version도 409다. location_id를 생략하면 초기 위치와 confidence는 null이다. 명시적 location_id는 수동 확인으로 confidence=1을 기록한다. 삭제는 DELETE와 If-Match로 soft delete한다. shared_with_member_ids는 같은 가구 읽기 공유이며 수정/삭제 권한은 소유자에게만 있다.

이미지 등록은 GET /api/v1/settings 응답의 image_upload_consent를 true로 바꾸어 PUT한 뒤 POST /api/v1/assets/upload-intents로 GARMENT 이미지의 이름·MIME·size_bytes를 전달한다. 응답 upload_url에 required_headers를 그대로 사용해 PUT하고 assets/{asset_id}/finalize에 checksum_sha256을 보낸다. 반환 asset_id를 의류 image_asset_id로 연결한다. PNG/JPEG/WebP 최대 10MiB/4096×4096, SHA256 및 실제 디코딩을 검사한다. GET 서명은 60초, PUT은 5분, 이미지 보관은 30일이다. 동의 철회는 즉시 읽기를 차단하고 삭제하며 실패는 503으로 알리고 재시도한다. consent-history는 본인 이력을 제공한다. 상세 정책은 [승인 계약](docs/SPRINT_1_CONTRACT_DECISIONS.md)에 있다.

Decart endpoint/model/이미지 규격은 확정하지 않았다. `VTON_PROVIDER=DECART`는 명시적 구성 오류를 발생시킨다. VTON은 Sprint 3 Mock 비동기를 제공하며 실 Decart 어댑터 구현·검증은 남아 있다. 유료 실제 호출 검증은 모든 Sprint 종료 후 수행한다. 카드 흐름은 Sprint 4 절을 따른다. 사용자 설정에서 서버 정책과 다른 provider를 선택하면 403, 미연동 LIVE weather/calendar는 503으로 거부한다.

## 종료·복구

`python scripts/tasks.py down`은 서비스를 종료하고 로컬 주 DB/스토리지 volume을 보존한다. 자동 volume 삭제·baseline downgrade는 제공하지 않는다.

- readiness DB 실패: PostgreSQL 연결 설정 확인 후 migrate 실행.
- storage 실패: MinIO 기동/자격 증명을 확인하고 storage-init 재실행.
- Docker named pipe 연결 실패: Docker Desktop의 Linux engine이 실행 중인지 확인.
- BuildKit의 비ASCII session header 오류: backend 빌드를 영문 경로의 동일 프로젝트 복사본에서 실행한다. MinIO build는 현재 한글 workspace에서도 검증했다. 정확한 환경별 절차는 Sprint 0 보고서를 따른다.
- 패키지 설치 WinError 10013: 실행 환경의 네트워크 제한 때문에 의존성 설치와 build를 완료할 수 없다. 테스트 skip을 성공으로 해석하지 않는다.
- SQL baseline hash 불일치: 원본을 임의로 수정하지 말고 변경 근거와 새 migration을 검토한다.

Compose worker는 단일 로컬 worker의 beat를 통해 60초마다 만료·철회 객체 정리를 실행한다. Docker 없이 Windows에서 실행할 때는 worker와 별도 `celery -A app.workers.celery_app:celery_app beat --schedule=wardrobe-celerybeat` 프로세스를 사용한다. 알려진 취약점이 남은 로컬 MinIO는 운영용 안전 버전으로 간주하지 않으며 외부 인터넷에 공개하지 않는다.

## Sprint 2

기존 Context·추천·코디·스타일 API를 구현했다. Sprint 2 당시 API는 1.2.0, 업무 operation은 23개였다. [구현 기준](docs/SPRINT_2_CONTRACT_DECISIONS.md)에 점수·필터·일정·이력·보관·STYLE 이미지 정책을, [보고서](docs/SPRINT_2_REPORT.md)에 당시 검증과 완료 판정을 기록한다. 이전 계약 1.1은 docs/contracts/1.1에 보존한다.

`python scripts/tasks.py smoke-sprint2`는 loopback에서 Seed Context와 코디·스타일 읽기를 검사한다. `python scripts/tasks.py test-e2e-sprint2`는 별도 UUID DB/API에서 Sprint 1 회귀와 Context·추천·코디 보관·STYLE 실제 업로드/조회/삭제를 검증한다. 전용 postgres-test를 먼저 띄워야 한다. `STYLE` 이미지도 GARMENT와 같은 동의·SHA256·디코딩·private 보관 정책을 적용하며 STYLE_REFERENCE.image로 60초 읽기 서명을 반환한다. URL 등록은 링크 저장만 하고 크롤링하지 않는다.

Context의 AUTO는 미연동 LIVE 값을 PARTIAL/missing_fields로 표시한다. 사용자 설정에서 LIVE 연결이 완료됐다고 표시하지는 않는다. 추천은 AVAILABLE 및 본인/명시적 공유 의류만 사용하며 후보와 Context UUID를 후속 VTON에 전달할 수 있다. Sprint 2 당시에는 VTON 세션과 착용 확인을 구현하지 않았다. 현재 VTON 범위는 다음 Sprint 3 절을 따른다.

## Sprint 3

[구현 기준](docs/SPRINT_3_CONTRACT_DECISIONS.md)에 진입·revision·이미지·worker·종료 정책을 기록한다. `python scripts/tasks.py smoke-sprint3`는 readiness·계약·권한 경계를 확인하며 `python scripts/tasks.py test-e2e-sprint3`는 별도 UUID DB/API/실제 Celery worker와 전용 큐에서 Sprint 1~3를 검증한다. 기존 전용 postgres-test와 Docker CLI가 필요하다.

인물은 PERSON_VTON 목적으로 검증 업로드한 PERSON asset으로 등록한다. 세션은 본인 코디를 독립 초안으로 복제하고 expected_revision 편집으로 새 스냅샷을 만든다. 현재 outfit/revision과 동의된 인물·의류 이미지를 vton-jobs에 전달하면202와 job_id를 반환한다. jobs/{id}를 polling하며 Mock 결과는 실제 변환이 아닌 안내 PNG이고 provider_mode=MOCK다. 종료의 final_items_snapshot은 착용 확인이 아니며 wear_event를 생성하지 않는다.

Celery beat가2초마다 DB의 durable QUEUED job을 회수한다. worker_queue는 별도 검증 worker 격리에 사용하는 큐 이름이며 기본 celery를 유지한다. 동시 실행은 lease와 row lock으로 보호하고, timeout·재시도·취소를 Job에 표시한다. Sprint 3 당시 계약은 1.3이며 이전 1.2는 docs/contracts/1.2에 보존한다.

## Sprint 4

[구현 기준](docs/SPRINT_4_CONTRACT_DECISIONS.md)에 카드·공유·취소·재시도 정책을 기록한다. `python scripts/tasks.py smoke-sprint4`는 현재 readiness와 API 계약을 읽기 검증하고 `python scripts/tasks.py test-e2e-sprint4`는 전용 UUID DB/API/Celery 큐에서 Sprint 1~4 HTTP 검증을 수행한다. 전용 postgres-test가 실행 중이어야 한다.

`renderer`는 화면 프론트엔드가 아닌 내부 이미지 생성 서비스다. React 19.3.0과 Playwright 1.64.0을 lockfile로 고정하고 공식 이미지 digest를 고정한다. renderer에는 호스트 포트가 없고 내부 네트워크만 연결한다. 검증된 의류 이미지 바이트 또는 명시적 placeholder만 렌더링하며 외부 URL을 방문하지 않는다. API readiness는 실제 Chromium 기동도 확인한다.

카드 저장과 재사용은 착용 확인이 아니다. SHAREABLE 요청만 24시간 공유 링크를 발급하고 PRIVATE/재생성은 기존 링크를 폐기한다. 공유 이미지는 카드에 포함된 정보를 공개하므로 `shared_fields`를 확인한다. 동일 멱등 요청은 만료 서명/토큰을 갱신하지 않는다. Sprint 4 당시 API 1.4와 이전 1.3 계약의 근거는 [manifest](docs/CONTRACT_REVISION_1_4.json)를 따른다.

## Sprint 5

[구현 기준](docs/SPRINT_5_CONTRACT_DECISIONS.md)에 착용 확인·취소·스냅샷·시간대 이력·케어 프로필·반복 일정·미수행·완료·완료 취소 정책을 기록한다. `python scripts/tasks.py smoke-sprint5`는 현재 readiness와 계약을 읽기 검증한다. `python scripts/tasks.py test-e2e-sprint5`는 전용 UUID DB/API/Celery 큐에서 Sprint 1~5의 실제 HTTP 흐름을 검증하며 실행 중인 postgres-test가 필요하다.

실제 착용 확인은 POST wear-confirmations의 USER 요청만 생성한다. 센서 검증 ingress는 없으므로 SENSOR_VERIFIED는 503으로 거부한다. 세션 종료는 OUTFIT_SELECTION이며 착용이 아니다. 구성과 Context를 고정하고 취소 이력을 보존한다. 추천은 취소되지 않은 착용 스냅샷을 집계한다. history는 from/to의 현지 날짜 양 끝을 포함하며 timezone 기본값은 UTC다.

care-guide와 수정 가능한 care-profile은 라벨을 우선하며 불명확한 정보에 REVIEW_REQUIRED를 표시한다. 예약은 SCHEDULED, 지난 예약은 조회 시 OVERDUE, 명시적 수행은 COMPLETED다. NOT_DONE은 수행 이력만 저장하고 다음 일정을 만들지 않는다. recurrence_days/timezone은 현지 달력 날짜로 다음 회차를 계산한다. 의류 상태·위치는 자동 변경하지 않는다. 변경·수행·취소에는 기대 version과 멱등 key가 필요하다.

기존 DB에는 `python scripts/tasks.py migrate`로 0003_sprint5_history_care를 적용한다. 과거 구성은 null로 보존한다. 기존 활성 일정의 동일 의류/관리 종류/시각 중복이 있으면 유일 인덱스 생성이 실패하므로 임의 병합하지 말고 데이터를 검토한다. 이력 보존을 위해 downgrade를 제공하지 않으며 기존 DB/volume을 초기화하지 않는다. 계약 1.5와 보존한 1.4의 7개 파일은 [manifest](docs/CONTRACT_REVISION_1_5.json)를 따른다. 실 Decart 어댑터 구현은 별도로 남아 있다. 후속 화면 구현과 직접 QA는 [프론트 보고서](docs/FRONTEND_REPORT.md)를 따른다.


## Sprint 6

[구현 기준](docs/SPRINT_6_CONTRACT_DECISIONS.md)은 착용·계절·공간·환경 제약의 결정적 보관 제안과 승인·실제 확인을 정의한다. `python scripts/tasks.py smoke-sprint6`은 읽기 검증, `python scripts/tasks.py test-e2e-sprint6`은 전용 UUID DB/API/실제 Celery에서 Sprint 1~6을 검증한다. 전용 postgres-test가 필요하다.

storage-optimization-jobs는 202를 반환하며 jobs 조회의 storage_result에 제안·보류 사유를 제공한다. dry_run은 action을 생성하지 않는다. APPROVE는 위치를 바꾸지 않으며 USER의 목적지·관측 시각 확인 후에만 실제 위치를 갱신한다. 부분 성공·실패와 미완료 취소를 지원한다. 승인된 입고 예약도 용량에 포함하며 버전·현재 공간·환경 조건이 바뀌면 409로 전체 명령을 거부한다. 위치·환경 설정 입력은 기존 DB/import 경로이며 별도 설정 API나 실제 장비 ingress는 없다.

기존 DB revision 0003을 유지하며 새 migration과 Seed 재적재는 필요하지 않다. 계약 1.6과 이전 1.5의 보존 증적은 [manifest](docs/CONTRACT_REVISION_1_6.json)를 따른다. 실제 Decart 어댑터 구현은 미완료이고 유료 검증은 모든 Sprint 완료 후로 보류한다.


## Sprint 7

[구현 기준](docs/SPRINT_7_CONTRACT_DECISIONS.md)은 홈과 outbox·관측성의 경계를 정의한다. `python scripts/tasks.py smoke-sprint7`은 읽기 전용 기동·전체 API 계약 검증, `python scripts/tasks.py test-e2e-sprint7`은 전용 UUID DB/API/실제 Celery 큐에서 Sprint 1~7 HTTP 흐름을 검증한다. `python scripts/tasks.py test-e2e-mock`은 tests/e2e의 원문 FSD 9개 시나리오를 실행한다. API 52개와 FSD 28개의 상태는 추적표를 따른다. 테스트에는 실행 중인 postgres-test와 기존 서비스가 필요하다.

GET home은 member_id/at/timezone으로 현재 사용자의 당일 Context·추천·미완료 케어·보관을 집계한다. 조회는 추천·착용·알림을 생성하지 않는다. 캐시/Mock/부분 실패/잘린 목록을 source_status와 partial로 표시한다. 각 소스는 별도 읽기 transaction이므로 전역 snapshot은 아니다. at은 날짜 필터이며 과거 mutable 상태를 복원하지 않는다.

실제 Celery가 outbox를 전송·소비한다. broker 수락은 PUBLISHED, 소비 완료는 audit_log의 DOMAIN_EVENT_CONSUMED receipt다. event_id 고유 PK로 중복을 막고 작업 요청은 기존 durable poller를 깨운다. max 5회 이후 FAILED는 자동 재시도하지 않는다. `python scripts/tasks.py observe`로 미전송·재시도·exhausted·미소비 backlog, job 상태/attempts/latency, stale 의류를 읽기 조회한다. 수락 여부가 불명확한 FAILED는 DB 원문·receipt와 broker 장애 원인을 확인한 뒤 운영자가 재전송을 결정한다. 유효한 event_id를 유지해야 중복 소비가 방지된다. 시스템이 임의로 상태를 성공으로 바꾸거나 데이터를 삭제하지 않는다.

Sprint 7 백엔드 범위에서는 n8n·화면 UI·실제 센서를 제외했다. 후속 화면 구현은 아래 프론트 절을 따른다. 기존 head 0003, DDL/Seed/Compose와 비밀 설정을 유지한다. 전체 Mock 백엔드 인수는 실제 Decart 연동 완료를 뜻하지 않는다. 실제 Decart 어댑터는 미구현이며 유료 최종 검증도 수행하지 않았다. 이전 1.6 원본 보존과 1.7 보완 근거는 [manifest](docs/CONTRACT_REVISION_1_7.json)를 따른다.

## 프론트엔드와 직접 QA

화면 설계는 [FRONTEND_DESIGN](docs/FRONTEND_DESIGN.md), 구현·검증은 [FRONTEND_REPORT](docs/FRONTEND_REPORT.md), 직접 QA와 재현·종료 절차는 [FRONTEND_QA](docs/FRONTEND_QA.md)를 따른다. http://127.0.0.1:5173 에서 로컬 데모 프로필로 시작한다. `npm --prefix web ci`, `npm --prefix web run build`, `powershell -NoProfile -File scripts/start_frontend.ps1`로 빌드 미리보기를 띄운다. 기존 backend 서비스가 필요하다.

`npm --prefix web test`는 클라이언트/달력 단위 검증, `.venv/Scripts/python.exe scripts/verify_frontend.py`는 전용 DB/API/Celery와 실제 Chromium 검증이다. 직접 QA의 변경은 로컬 개발 DB에 실제 반영된다. 화면 Mock 기능과 실제 외부 서비스 연결은 구분하며 사용자 QA 승인 후 선택 연동과 마지막 유료 API 검증을 진행한다.
