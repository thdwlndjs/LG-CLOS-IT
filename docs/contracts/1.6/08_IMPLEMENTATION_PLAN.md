# Smart Wardrobe Prototype — Codex 구현 명세 v1.0

- 문서 ID: `08_IMPLEMENTATION_PLAN`
- 기준: `03_ARCHITECTURE_HLD_v1.1.md`, `04_FSD.md`, `05_BACKEND_LLD.md`, `06_OPENAPI.yaml`, `07_DATABASE_SCHEMA.sql`, `07_DATABASE_SEED.sql`
- 범위: **Backend-first**, 프론트엔드 UI는 후속 작업. 단, 카드 이미지 렌더링용 React는 백엔드 부속 워커로 포함.
- 구현 목표: IA의 모든 화면이 향후 **기존 API 계약만으로** 데이터를 조회·명령할 수 있는 백엔드와, 실제 데모 데이터로 작동하는 E2E 파이프라인.
- 우선순위: **기존 명세를 우선**; 본 문서는 구현 순서·운영 경계·검증 조건을 보충한다. 충돌은 조용히 임의 변경하지 말고 `docs/DECISIONS.md`에 기록한다.

## 1. 구현 원칙 및 문서 우선순위

1. 기능 범위·수용조건: `04_FSD.md`의 28개 기능 ID.
2. 공개 HTTP 계약: `06_OPENAPI.yaml` (경로·method·스키마·오류·인증·멱등성 헤더). FastAPI 자동 생성 OpenAPI가 이 파일과 불일치하면 구현을 수정하거나 명시적인 계약 변경 기록을 남긴다.
3. 물리 데이터 계약: `07_DATABASE_SCHEMA.sql` 및 `07_DATABASE_SEED.sql`. 스키마의 테이블·ENUM·제약을 무단 변경하지 않는다.
4. 내부 책임·상태·트랜잭션: `05_BACKEND_LLD.md`; 제품 흐름·외부 경계: `03_ARCHITECTURE_HLD_v1.1.md`.
5. API와 DB는 1:1 대응이 아니다. Repository/Application Layer에서 API DTO와 영속 엔티티를 변환한다.
6. 의류 검색·케어 조회는 **일반 서비스**; 최적화와 추천은 결정 로직; 카드 이미지는 **결정 + 렌더러** 분리. 불필요한 LLM/멀티에이전트 프레임워크 도입 금지.
7. 사용자 인증, 가구별 데이터 접근, 외부 API 키 격리, 비동기 작업의 재시도/중복 실행 방지를 모든 단계에서 적용.

## 2. 구현 기술 선택 (초기 고정값)

| 영역 | 선택 | 이유·대체 가능 범위 |
|---|---|---|
| Runtime | Python 3.12, FastAPI, Pydantic v2 | 명세·DTO 일치 |
| ORM | SQLAlchemy 2.x async, `asyncpg` | PostgreSQL async 접근 |
| DB | PostgreSQL 16 (DDL 요구: 15+) | UUID, JSONB, ENUM, FK |
| Migration | Alembic | 버전 추적; 기존 SQL 초기 버전으로 편입 |
| Job Queue | Redis + Celery | 장기 VTON/카드/최적화 작업; 초기 1 worker 가능 |
| HTTP client | `httpx` | Decart/외부 서비스 타임아웃·재시도 제어 |
| Object Storage | S3-compatible API; 로컬은 MinIO | 파일을 DB에 저장하지 않음 |
| Card Renderer | Node.js LTS + React/CSS + Playwright Chromium | 카드 HTML을 1080×1350 PNG/WebP로 렌더링 |
| Test | pytest, pytest-asyncio, httpx, testcontainers 또는 Compose 테스트 DB | 단위/계약/통합/E2E |
| Orchestration | n8n 선택적 별도 서비스 | 외부 스케줄·알림; 핵심 트랜잭션에 미관여 |
| Agent framework | 우선 순수 Python policies/use cases | LangGraph는 실제 다단계 상태 필요 시 별도 결정 후 도입 |

위 항목은 **이번 구현 계획의 제안 기본값**이다. 실제 버전은 lockfile로 고정하고 보안 업데이트를 허용한다. Celery + async ORM 혼용 시 worker 진입점의 이벤트 루프 수명·DB 세션을 분리한다.

## 3. 저장소/디렉터리

```text
smart-wardrobe/
├── docs/
│   ├── 03_ARCHITECTURE_HLD_v1.1.md
│   ├── 04_FSD.md
│   ├── 05_BACKEND_LLD.md
│   ├── 06_OPENAPI.yaml
│   ├── 07_DATABASE_SCHEMA.sql
│   ├── 07_DATABASE_SEED.sql
│   ├── 08_IMPLEMENTATION_PLAN.md
│   └── DECISIONS.md
├── backend/
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/versions/
│   ├── app/
│   │   ├── main.py
│   │   ├── core/{config,security,errors,logging,clock}.py
│   │   ├── api/v1/{sessions,home,garments,observations,context,recommendations,outfits,styles,vton,cards,history,care,storage,settings,jobs,assets}.py
│   │   ├── schemas/                   # OpenAPI 호환 Pydantic DTO
│   │   ├── application/
│   │   │   ├── common/{uow,authorization,idempotency}.py
│   │   │   └── {garments,context,recommendations,outfits,styles,vton,cards,history,care,storage,settings}/
│   │   ├── domain/{garment,outfit,recommendation,storage,care}/
│   │   ├── infrastructure/
│   │   │   ├── db/{models,repositories,session}.py
│   │   │   ├── adapters/{decart,mock_vton,thinq_mock,weather,calendar,sensors,object_storage,card_renderer}.py
│   │   │   └── queue/{producer,consumer,outbox_dispatcher}.py
│   │   └── workers/{celery_app,vton_worker,card_worker,storage_worker,context_worker}.py
│   └── tests/{unit,integration,contract,e2e}/
├── renderer/
│   ├── package.json
│   ├── src/{templates,components,schemas}/
│   └── scripts/render-card.mjs
├── infra/{compose.yaml,env.example}/
├── scripts/{bootstrap,seed,smoke}.sh
├── Makefile
└── README.md
```

디렉터리의 `{...}`는 설명용 표기이며 실제 파일은 개별 생성한다. 프론트엔드 `web/`은 지금 만들지 않아도 된다. `renderer/`는 백엔드 의존 서비스로 구축한다.

## 4. 실행 구성과 환경 변수

로컬 Compose 서비스: `postgres`, `redis`, `minio`, `api`, `worker`, `renderer`(필요하면 별도 프로세스). `n8n`은 선택 profile. API `localhost:8000`, `/docs`, `/openapi.json`, `/health/live`, `/health/ready` 제공. 마지막 두 health endpoint는 **운영용 추가 경로**로 OpenAPI 본 계약 외임을 문서화한다.

`infra/env.example` (비밀값 절대 커밋 금지):

```dotenv
APP_ENV=local
APP_TIMEZONE=UTC
LOG_LEVEL=INFO
DATABASE_URL=postgresql+asyncpg://wardrobe:CHANGE_ME@postgres:5432/wardrobe
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/1
STORAGE_ENDPOINT=http://minio:9000
STORAGE_BUCKET=wardrobe-assets
STORAGE_ACCESS_KEY=CHANGE_ME
STORAGE_SECRET_KEY=CHANGE_ME
STORAGE_PUBLIC_BASE_URL=http://localhost:9000
AUTH_MODE=DEMO
DEMO_AUTH_ENABLED=true
JWT_SECRET=CHANGE_ME_MIN_32_CHARS
VTON_PROVIDER=MOCK
DECART_API_KEY=
DECART_BASE_URL=
DECART_MODEL_ID=
DECART_TIMEOUT_SECONDS=90
DECART_MAX_CONCURRENCY=2
WEATHER_PROVIDER=MOCK
CALENDAR_PROVIDER=MOCK
THINQ_CLO_MODE=MOCK
CARD_RENDERER_URL=http://renderer:3000
CARD_RENDER_TIMEOUT_SECONDS=30
N8N_ENABLED=false
N8N_WEBHOOK_SECRET=
CORS_ALLOWED_ORIGINS=http://localhost:5173
```

실제 `.env`는 `.gitignore` 처리. `DEMO_AUTH_ENABLED`는 로컬에서만 허용하고, 운영/공개 배포 시 부팅 자체를 차단한다. `DECART_BASE_URL`/`MODEL_ID`는 **공식 제공 규격을 확인한 후** 채우며 임의 endpoint·필드를 만들어 호출하지 않는다. 사용자·의류 이미지의 공개 URL 노출을 피하고 서명 URL 또는 백엔드 중계 방식을 사용한다.

## 5. Mock ↔ Decart 교체 가능한 Port

```python
class VtonProvider(Protocol):
    async def submit(self, request: VtonRequest) -> ProviderSubmission: ...
    async def get_result(self, provider_job_id: str) -> ProviderResult: ...
```

- `VtonRequest`: `member_id`, `session_id`, `outfit_id`, `outfit_revision`, 사람 이미지 asset 참조, 의류 이미지 asset 참조, `correlation_id`.
- `ProviderSubmission`: 즉시 결과 또는 provider job 참조를 담는 **내부 표준 DTO**. 실제 Decart가 동기 응답이면 polling 생략.
- `ProviderResult`: `status`, `result_asset`, `provider_mode`, 안전한 오류 코드, 처리 시각.
- `MockVtonProvider`: 고정 fixture 또는 명확히 **MOCK** 표기된 합성 결과를 반환. 실사 VTON 품질을 주장하지 않음.
- `DecartVtonProvider`: 공식 문서에서 확인된 인증·지원 모델·이미지 형식·요청·응답·비동기 여부에 맞춘 adapter만 구현. 문서/계정 정보 없으면 `DECART` 모드 선택 시 **명시적 구성 오류**로 실패; 자동으로 mock 성공을 가장하지 않음.
- provider 선택은 **서버 설정 + 권한 정책**으로 결정하고, 응답에 `provider_mode`를 포함. Provider별 rate limit, timeout, retry(429/5xx 등), 비용/호출 횟수 제한.
- `outfit_revision`이 다른 과거 작업의 완료 결과는 현재 세션에 반영하지 않는다. 취소 요청은 내부 job 상태를 먼저 처리하고 provider 취소는 지원 시에만 실행.
- 사람 사진·결과물 보존 기간과 삭제 정책을 구현 전에 설정으로 정한다.

## 6. 데이터베이스 및 마이그레이션 절차

1. 빈 PostgreSQL DB 준비 → migration owner 계정으로 연결.
2. 과거 원본 30개 테이블은 동결 SQL로 **Alembic baseline revision**에 반영하고 현재 `07_DATABASE_SCHEMA.sql`의 32개 테이블 계약은 0002 전진 migration까지 적용한다. 현재 계약 DDL과 역사 migration을 중복 실행하지 않는다.
3. `alembic upgrade head`를 신규 DB에서 실행하고, 재실행 시 추가 변경이 없는지 확인.
4. 개발/데모에서만 `07_DATABASE_SEED.sql` 실행. `ON CONFLICT` 기반 중복 실행이 안전해야 한다.
5. migration은 순방향 `upgrade`를 기본으로 하고, 데이터 삭제가 필요한 downgrade는 명시적 비가역 정책/백업을 따른다.
6. API DTO ↔ ORM 매핑은 repository/use case에서 관리. UUID·ENUM·UTC timestamptz·JSONB·nullable location semantics 보존.
7. 신규 migration 작성 시 API 계약 변경 여부, 데이터 backfill, 인덱스 생성 영향, 롤백 전략을 `DECISIONS.md`에 기록.

**사전 확인할 설계 간 차이:** LLD의 논리 엔티티(`RECOMMENDATION_RUN`, `INTEGRATION_SETTINGS`, 별도 `VTON_RESULT` 등)는 물리 DDL에 독립 테이블이 없을 수 있다. 먼저 실제 DDL에 존재하는 `job`, `vton_job`, `member_settings`, `outfit_session_event` 등으로 구현 가능한지 매핑하고, 불가능한 경우에만 migration과 계약 변경을 제안한다. SQL 파일을 임의로 덮어쓰지 않는다.

## 7. 단계별 구현 백로그 및 완료 기준

각 단계는 **테스트 통과 + 문서/API 일치 + 재현 가능한 데모**를 완료 조건으로 한다. 단계 간 일부 병렬 개발 가능하나 의존 데이터가 먼저 준비되어야 한다.

| Sprint | 구현 범위 (FSD ID) | 주요 작업 | 완료 조건 |
|---|---|---|---|
| 0 | Platform | Compose, 설정, 로깅, 인증, ORM, Alembic, Seed, 테스트 DB | clean clone → boot → migration → seed → health 성공 |
| 1 | COM-001, SET-001, GAR-001~004, STO-001 | 데모 세션, 가구 권한, 의류 CRUD, 관측/위치, structured locator | 타 가구 접근 차단, 의류 검색/위치 미확인 응답 검증 |
| 2 | REC-001~002, OUTFIT-001~002, STYLE-001 | Context snapshot, rule/scoring 추천, outfit CRUD, 스타일 보관함 | 후보 필터·Top-K·세션 연결, 결정적 fixture 추천 결과 |
| 3 | VTON-001~004 | VTON 세션, revision, job/worker, Mock/Decart port | Mock 비동기 완료, 구버전 결과 미반영, provider 실패 전파 |
| 4 | CARD-001~003 | 카드 draft, React 템플릿, Playwright worker, 이미지 asset, 저장/공유 | 1080×1350 이미지 생성, job polling, 실패 재시도 |
| 5 | HIST-001~002, CARE-001~003 | 착용 확인, history, care profile/schedule/event | 세션 종료만으로 착용 생성 안 됨, 관리 완료 기록 |
| 6 | STO-002~004 | 착용/계절 scoring, 공간 제약, 이동 제안·승인·실행 확인 | 승인만으로 위치 변경 금지, 확인 후 변경, 충돌 처리 |
| 7 | COM-002 + Platform | 홈 집계, outbox dispatcher, n8n optional, 에러/관측성 | 모든 IA 화면 데이터 공급, E2E 9개 시나리오 통과 |

Sprint는 일정 단위가 아니라 구현 순서 단위다. **28개 기능을 모두 추적**하며 화면 컴포넌트는 후속 프론트 단계에서 구현한다.

### 7.1 Codex 작업 단위 규칙

각 Sprint는 아래 순서로 작업한다.

1. 대상 FSD ID와 OpenAPI operationId/경로, 관련 DDL 테이블을 추출해 `IMPLEMENTATION_TRACEABILITY.md`에 매핑.
2. 실패하는 테스트(계약/도메인)를 먼저 작성하거나 동일 커밋에서 테스트와 구현을 함께 제공.
3. `schemas → domain/application → repositories/adapters → API router → worker` 순서로 수직 기능 완성.
4. API/DB 변경이 필요하면 원본 명세와 `DECISIONS.md`를 함께 업데이트하고 근거 기록.
5. 최소 통합 테스트 실행 후 Conventional Commits(`feat:`, `fix:`, `test:`, `docs:` 등)로 구분.

## 8. 비동기 작업·이벤트·트랜잭션 구현 규칙

- 명령 처리: 권한 검증 → 입력 검증 → `Idempotency-Key`/version 검사 → DB 트랜잭션 내 상태+`domain_event_outbox` 기록 → commit → 응답.
- Outbox dispatcher: 미발행 레코드를 배치로 읽어 큐 전송, 성공 시 published. 장애 시 중복 전송 가능성을 전제로 소비자는 멱등 처리.
- Worker: `job` 상태를 `QUEUED → RUNNING → SUCCEEDED/READY | FAILED/TIMED_OUT/CANCELLED`로 변경. 각 job 타입별 유효 상태 전이만 허용.
- 실패: 네트워크/429/5xx는 bounded exponential backoff; validation/권한/정책 오류는 재시도하지 않음. retry 횟수, last error, correlation_id 기록.
- Outfit: 수정 시 `revision` 증가, VTON 응답은 동일 revision에만 연결. 세션 `ENDED`는 **착용 확인 아님**.
- Wear: 명시적 착용 확인 시에만 `wear_event` 생성; 재전송은 confirmation ID/unique 제약으로 중복 방지.
- Storage: `PROPOSED → APPROVED → IN_PROGRESS → AWAITING_CONFIRMATION → COMPLETED`; `APPROVED`만으로 `garment_state.location_id` 변경 금지. 실제 이동 확인/관측 후 반영.
- Event는 외부 n8n으로 보내도 n8n에서 DB를 직접 수정하지 않음. 외부 callback은 인증·서명 검증·재전송 방지.
- DB commit과 Redis publish를 하나의 분산 트랜잭션으로 가정하지 않는다.

## 9. REST API 구현 및 계약 테스트

- `06_OPENAPI.yaml`의 **모든 operation**을 구현 대상으로 삼는다. FSD 기능 수(28)와 API operation 수는 다르다.
- FastAPI의 `operation_id`, HTTP status, path/query/header, body, response schema, `security`를 명세와 대조.
- 모든 mutation에서 요구되는 `Idempotency-Key`, `version`/동시성 제어 조건, 인증 요구를 누락하지 않음.
- 인증 실패 401, 권한 거부 403 또는 정보 은닉용 404, 입력 오류 422, 충돌 409, 리소스 없음 404, rate limit 429, provider/작업 실패 5xx/도메인 오류는 **명세에 정의된 범위**로 매핑.
- 파일 업로드는 `upload-intents → storage upload → assets/{id}/finalize`; MIME, 용량, owner/household scope 검증.
- Job API는 작업 생성 시 `job_id`, 이후 `GET /api/v1/jobs/{job_id}`로 상태·결과 조회; 취소는 지원되는 상태에서만.
- API contract 테스트는 소스 YAML과 FastAPI `/openapi.json`을 정규화 비교(문서화 메타데이터 차이 허용, wire contract 차이 불허).
- OpenAPI 전체 구조는 전용 validator로 검사하고 `$ref`를 모두 resolve한다.

## 10. 테스트 매트릭스

| 유형 | 대상 | 최소 수용 조건 |
|---|---|---|
| Unit | 추천 점수/필터, 보관 제약, 상태 머신, 카드 데이터 매핑 | 고정 fixture로 결정적 결과, 경계값·실패값 검사 |
| API contract | 모든 path/method 및 DTO | OpenAPI 호환, 오류 코드·필수 헤더 일치 |
| DB integration | Alembic, FK, ENUM, unique, repository | 새 DB migration + seed 성공, 무결성 위반 탐지 |
| Security | 가구별 권한, asset 접근, demo auth | 타 가구 읽기/쓰기 거부, 공개 모드에서 demo auth 차단 |
| Queue | Outbox, worker, idempotency | 중복 전달에도 중복 상태 변경 없음, 재시도/timeout |
| VTON | Mock / live adapter | Mock E2E 통과, live 미설정 시 명확한 오류, stale revision 무시 |
| Card | React/Playwright | 지정 크기, 이미지 존재·정상 MIME, 실패 시 job 오류 |
| E2E | FSD 9개 수용 시나리오 | Mock 모드에서 전부 통과, 테스트 증적 보관 |

**필수 대표 E2E:** (1) 로그인→의류 조회, (2) 등록→위치 조회, (3) Context→추천, (4) 코디 수정→VTON Mock→세션 종료, (5) 카드 생성→저장, (6) 명시적 착용 확인→history, (7) 케어 조회→완료, (8) 보관 제안→승인→실제 이동 확인, (9) 중복 요청·오류·권한 경계. FSD 원문의 9개 시나리오를 정식 테스트 이름/조건의 원본으로 사용한다.

## 11. 로컬 실행 명령 계약

아래는 **Codex가 구현해야 할 Makefile 타깃**이며 현재 실행 가능한 코드가 있다는 뜻은 아니다.

```bash
cp infra/env.example .env
make up              # postgres, redis, minio, api, worker, renderer
make migrate         # alembic upgrade head
make seed            # non-prod only
make test-unit
make test-integration
make test-contract
make test-e2e-mock
make lint
make down
```

`README.md`에는 로컬 기동, 샘플 demo 로그인, Swagger 주소, 이미지 업로드, VTON mock, 카드 생성, 테스트 및 장애 복구 절차를 기록한다. 실행 환경에서 Docker 미지원 시 DB/Redis/MinIO 의존성을 mock으로 가장하지 말고 별도 수동 실행 절차를 제공한다.

## 12. Codex 실행 프롬프트 (저장소 루트에서 사용)

> `docs/03_ARCHITECTURE_HLD_v1.1.md`, `docs/04_FSD.md`, `docs/05_BACKEND_LLD.md`, `docs/06_OPENAPI.yaml`, `docs/07_DATABASE_SCHEMA.sql`, `docs/07_DATABASE_SEED.sql`, `docs/08_IMPLEMENTATION_PLAN.md`를 읽어라. Backend-first 방식으로 Smart Wardrobe 프로토타입을 구현하라. 08 문서의 Sprint 0부터 순서대로 진행하고 각 Sprint에서 관련 FSD ID, API operation, DB 테이블을 추적하라. 임의 endpoint/DB 필드를 만들지 말고, 명세 충돌은 `docs/DECISIONS.md`에 기록한 후 필요한 문서를 함께 수정하라. 외부 Decart/ThinQ CLO 연동이 확인되지 않은 부분은 adapter interface와 명시적인 mock으로 구현하라. VTON의 mock 결과를 live로 표시하지 말라. React 웹 프론트엔드는 구현하지 말고 카드 렌더러만 구현하라. 각 Sprint 완료 시 테스트 결과, 변경 파일, 미해결 사항을 보고하라. 테스트 실행 불가 시 실행했다고 주장하지 말라.

## 13. 최종 백엔드 인수 조건 (Definition of Done)

- [ ] 로컬 clean clone에서 `.env` 설정 후 Compose 기동 가능
- [ ] `alembic upgrade head` + seed 성공; DB 현재 32개 테이블 및 제약 생성 (0001 baseline 30개 + 0002 확장 2개)
- [ ] 28개 FSD 기능의 백엔드 기능 범위가 구현되거나 명시적 Mock/제외로 추적됨
- [ ] `06_OPENAPI.yaml`의 모든 operation이 실제 router 및 계약 테스트와 대응
- [ ] `/docs`에서 인증 포함 API를 호출 가능
- [ ] Mock VTON 및 카드 이미지 생성의 비동기 job/polling 성공
- [ ] Decart live는 실제 확인된 규격으로만 연결; 미설정 시 명확히 실패
- [ ] 추천 → VTON → Outfit 저장 → Card → 착용 확인 흐름 정상 동작
- [ ] 보관 추천 → 승인 → 실제 이동 확인 → Digital Twin 갱신 정상 동작
- [ ] 가구별 데이터 격리, 파일 접근, 멱등성, 중복 이벤트, stale revision 테스트 통과
- [ ] FSD E2E 9개 시나리오 Mock 모드 통과
- [ ] `README.md`, `DECISIONS.md`, 환경변수 예제, 실행·테스트 명령 문서화

## 14. 후속 프론트엔드 인계

프론트 구현 시 제공: IA 이미지/와이어프레임, `06_OPENAPI.yaml`, 데모 계정·Seed, `/docs`, Mock 모드 E2E 시나리오, VTON/Card job polling 계약. 홈·옷장·코디·캘린더·케어·마이 화면을 기존 API에 연결한다. 프론트 요구로 API 변경이 필요하면 OpenAPI를 먼저 갱신하고 백엔드와 함께 변경한다. 프론트 LLD는 현 단계 필수 산출물이 아니다.

---

**미확정 외부 의존성:** Decart 실제 API 인증·요청·응답/모델 지원, ThinQ CLO 실제 구조화 호출, RFID·Vision 하드웨어, 실제 착용 판정. 본 구현은 해당 의존성을 adapter/mock 경계로 격리한다.

## Sprint 1 계약 개정 (2026-10-08)

사용자 승인에 따라 네 충돌의 정책을 확정했다. [결정 계약](SPRINT_1_CONTRACT_DECISIONS.md)이 Sprint 1의 역할·상태·공유·동의·보관·관측·삭제 정책의 기준이며, 개정 OpenAPI 1.1.0 및 DDL과 함께 적용한다. DEMO는 역할이 아닌 인증 모드다. 0001 SQL은 동결하고 0002 전진 migration으로 현재 32개 테이블을 구성한다. 케어 가이드 본문과 실제 센서 ingress는 기존 후속 Sprint/Mock 경계를 유지한다. 의류 이미지만 30일 보관하고 PERSON/VTON 자산 정책은 해당 Sprint에서 별도 확정한다.

## Sprint 2 계약 보완 (2026-10-08)

REC-001/002, OUTFIT-001/002, STYLE-001의 구체 정책은 [Sprint 2 구현 기준](SPRINT_2_CONTRACT_DECISIONS.md)을 따른다. Context는 missing_fields/source_status와 nullable is_holiday를 제공해 불완전 Seed 일정을 추정하지 않는다. OutfitUpsert는 ARCHIVED를 허용하고 Outfit은 missing_garment_ids/try_on_ready를 제공한다. 추천 기록은 기존 domain_event_outbox recommendation aggregate로 저장하며 실제 후보 outfit_id/context_snapshot_id로 후속 세션에 연결한다. STYLE 업로드는 현재 동의·검증·보관 정책에 따라 활성화한다. API 1.2.0, 추가 물리 테이블 없이 현재 32개 테이블을 유지한다.

## Sprint 3 계약 보완 (2026-10-08)

VTON-001~004의 구현 정책은 [Sprint 3 구현 기준](SPRINT_3_CONTRACT_DECISIONS.md)을 따른다. 세션의 진입 코디/의류·인물 바인딩, 독립 revision 스냅샷, 가용성 및 Mock 출처를 API 1.3.0으로 보완한다. Job은 구버전/현재 결과와 provider 오류·재시도를 명시한다. DB job poller로 commit 후 worker 회수를 보장하며 공통 outbox dispatcher는 Sprint 7 범위다. 최종 선택은 final_items_snapshot과 피드백을 저장하고 wear_event를 생성하지 않는다. 기존 32개 테이블과 Seed를 유지한다. Decart live는 검증되지 않은 정적 이미지 계약을 임의 구현하지 않는다.

## Sprint 4 계약 보완 (2026-10-08)

CARD-001~003의 구현·공유·placeholder·worker 정책은 [Sprint 4 구현 기준](SPRINT_4_CONTRACT_DECISIONS.md)을 따른다. API 1.4.0은 전체 슬롯 이미지 참조, 고정 템플릿 버전, 카드 저장·공유·재사용 응답과 VTON/Card 공통 Job DTO를 보완한다. 기존 32개 테이블과 Seed는 유지한다. Decart 유료 실제 호출 검증은 사용자 요청에 따라 모든 Sprint 종료 후 수행한다.

## Sprint 5 계약 보완 (2026-10-08)

HIST-001~002, CARE-001~003은 [Sprint 5 구현 기준](SPRINT_5_CONTRACT_DECISIONS.md)을 따른다. API 1.5.0은 명시적 착용 확인·취소, 구성 스냅샷과 날짜별 이력, 사용자 케어 프로필, 일정 변경·취소, 미수행·완료·완료 취소 및 시간대별 반복 일정을 포함한다. DB 상태 이름을 SCHEDULED/COMPLETED/CANCELLED/OVERDUE로 통일하고 OVERDUE는 조회 시 계산한다. 0003 순방향 마이그레이션은 기존 32개 테이블에 필요한 필드와 부분 유일 인덱스만 추가한다. 과거 구성은 추정하여 채우지 않으며 Seed와 이전 마이그레이션은 유지한다.

## Sprint 6 계약 보완 (2026-10-08)

STO-002~004는 [Sprint 6 구현 기준](SPRINT_6_CONTRACT_DECISIONS.md)을 따른다. API 1.6은 기존 보관 경로와 DB의 item 상태를 일치시키고 분석 기간·계절·dry run·판단 근거·Job의 보관 결과·version·실제 확인 근거 및 CANCEL을 보완한다. 기존 reasoning JSONB에 판단 입력과 item 스냅샷을 보존한다. 승인만으로 위치를 갱신하지 않으며 부분 확인·최신 제약·예약 점유와 기존 의류 변경의 동시성을 검증한다. HLD/DDL/Seed 및 기존 migration은 변경하지 않는다.
