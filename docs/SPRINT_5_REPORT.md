# Sprint 5 검증 보고서

## 판정과 범위

**Sprint 5 완료.** 최종 확인: 2026-10-08T23:36:46.265072+09:00 (Asia/Seoul). 기존 구현 계획의 HIST-001~002, CARE-001~003 인수 조건을 구현하고 실제 PostgreSQL/API 및 Sprint 1~4 회귀로 검증했다. API 1.5.0은 업무 operation 46개이며 이 중 Sprint 5는 10개다. 세션 종료·카드 저장·예약은 실제 착용이나 케어 수행으로 처리하지 않는다.

이 판정은 Sprint 5 백엔드 범위와 private local 환경에 한정한다. 전체 프로젝트 완료 판정은 아니다. Sprint 6~7·화면 프론트엔드는 구현하지 않았다. 실 Decart 어댑터 구현은 여전히 남아 있다. 유료 실제 호출 검증은 모든 Sprint 종료 후 수행하라는 사용자 요청에 따라 보류했다. Sprint 3 Mock 성공을 실 Decart 연동 완료로 해석하지 않는다.

## 구현과 인수 증적

| 기능 | 구현과 관찰한 결과 | 증적 |
|---|---|---|
| HIST-001 | WEAR/CARE/OUTFIT_SELECTION, 상태 구분, 본인 범위, 현지 날짜 양 끝 포함, 최대 366일, count/page 일관성·정렬 | 실DB integration, HTTP selection/history/filter |
| HIST-002 | 명시적 USER만 착용 생성, 전체 구성·Context 고정, 취소 보존, 기대 version·멱등성·동시 세션 중복 방지, 추천 스냅샷 집계·취소 제외 | frozen wear/owner/concurrent/session/recommendation integration 및 HTTP wear flow |
| CARE-001 | 라벨 우선, 사용자 프로필 수정, 라벨 금지·손세탁 제약, 상충/미확인 REVIEW_REQUIRED, 공유 읽기와 소유자 관리 분리 | profile/label conflict integration, HTTP guide/profile |
| CARE-002 | 생성·조회·변경·취소, 활성 슬롯 중복 방지, overdue는 읽기 계산, timezone 저장 | duplicate/edit/cancel/overdue integration 및 HTTP schedule |
| CARE-003 | NOT_DONE 이력과 SUCCESS 완료 구분, 다음 회차, 완료·연쇄 취소, 이미 완료된 다음 회차의 취소 거부, 원자적 rollback, 의류 상태·위치 불변 | recurrence/reversal/conflict/state integration 및 HTTP complete/cancel |

NOT_DONE 이후에는 최신 version으로 SUCCESS를 기록할 수 있다. 한 회차의 일반 취소는 그 회차에만 적용한다. 완료 취소는 원본 SUCCESS event를 soft cancel하고 연결된 다음 미완료 회차도 취소한다. 이미 완료된 다음 회차가 있으면 전체 요청을 거부한다. 정정은 취소 후 새로운 확인/일정을 생성한다. 관리 완료를 세탁 장비의 검증된 관측으로 가장하거나 garment_state를 자동 변경하지 않는다.

기본 조회는 오늘 포함 최근 31일이다. 반복은 저장한 timezone의 달력 일 간격 1..365이며 원래 due의 현지 시각을 기준으로 completed_at 이후 첫 회차까지 건너뛴다. New York 2026-03-08의 없는 02:30은 03:30으로 정규화하고 11-01의 두 01:30 중 첫 offset을 선택하는 독립 기대값 테스트를 통과했다. count/page는 한 요청에서 REPEATABLE READ로 일치하며 서로 다른 offset 페이지를 영구 동결하지 않는다. 극단적인 달력 범위·반복 overflow도 422로 거부한다.

## 최종 검증

| 검증 | 실제 결과 | 증적 |
|---|---|---|
| 단위·계약·실DB 전체 회귀 | **163 passed, 0 failed, 0 skipped**: unit 79, contract 8, integration 76 | [JUnit](../test-results/sprint5-tests-final.xml), [log](../test-results/sprint5-tests-final.log) |
| Windows 단위·계약 | 87 passed | [log](../test-results/sprint5-host-tests-final.log) |
| 실제 HTTP/API/Celery/Redis/MinIO/Chromium | **27개 검증 묶음 통과**, 테스트 DB·컨테이너·큐·객체 정리, 독립 S3 목록 조회에서 잔여 객체 0 | [HTTP 증적](../test-results/sprint5-live-evidence.json), [log](../test-results/sprint5-live-final.log), [S3 정리 증적](../test-results/sprint5-storage-cleanup-evidence.json) |
| Migration | 주 DB head 0003; 테스트 DB에서 재실행·기존 이력 보존·현재 DDL과 migration의 실제 컬럼/index 카탈로그 일치 | [migration log](../test-results/sprint5-migrate-final.log), migration integration |
| Runtime | PostgreSQL/Redis/MinIO/API/renderer healthy, storage-init exit 0, worker running | [최종 독립 관찰](../test-results/sprint5-final-evidence.json) |
| Readiness·플랫폼·Sprint 3/4/5 smoke | DB/Redis/storage/renderer 모두 ok, Swagger/OpenAPI 및 권한 검사 통과 | [platform](../test-results/sprint5-platform-smoke-final.log), [Sprint 5](../test-results/sprint5-smoke-final.log), Sprint 3/4 smoke logs |
| Ruff·의존성 | Ruff 통과, pip check 통과, Python 3.12.9·직접 핀 18개 일치 | [Ruff](../test-results/sprint5-lint-final.log), [pip](../test-results/sprint5-pip-final.log), final evidence |
| renderer 회귀·감사 | Node 테스트 3 passed, npm audit 현재 0 | [renderer](../test-results/sprint5-renderer-tests-final.log), [audit](../test-results/sprint5-npm-audit-final.log) |
| 실행한 코드 동일성 | host/API/worker/tests의 코드·설정 파일 **107개** 정확한 집합 및 SHA256 일치, renderer 집합·SHA 일치 | final evidence의 file hashes 및 image IDs |

최종 테스트는 새 이미지의 코드를 사용했고 backend/docs/scripts 소스 bind mount로 검증을 대신하지 않았다. 결과 폴더만 JUnit 출력을 위해 마운트했다. 초기 집중 migration 테스트의 파일 mount는 개발 확인이며 최종 판정 근거는 완성 이미지 전체 실행이다. 테스트에 DB/Redis/MinIO Mock 대체가 없고 VTON만 명시적 MOCK다. 카드 PNG/WebP는 실제 Chromium 결과다. 유료 외부 호출은 없었다.

주 DB는 32 tables/10 ENUM, members=2/garments=3이며 기존 Context=1/outfit=1을 유지했다. wear/care_profile/care_schedule/care_event/cards/sessions/jobs/feedback는 0이다. 주 DB Seed를 다시 적재하거나 초기화하지 않았다. 별도 검증 DB에서 세션 종료 직후 wear=0을 관찰한 뒤 명시적 확인과 취소로 wear=1/cancelled_wear=1, 케어 수행으로 care_event=2/cancelled_schedule=2를 관찰했다. 모두 검증 후 정리했다.

## 계약·마이그레이션 변경

설계 충돌은 DTO 상태 이름과 실제 DB ENUM 차이, 착용 snapshot/취소/version 부족, 케어 profile/일정 수정 및 반복·미수행·완료 취소 표현 부족이었다. 구현 계획의 계약 개정 규칙에 따라 필요한 1.5 필드와 4개 추가 경로, 0003 순방향 migration을 보완했다. [구현 기준](SPRINT_5_CONTRACT_DECISIONS.md), [개정 manifest](CONTRACT_REVISION_1_5.json), [보존한 1.4 원본](contracts/1.4/)에 근거와 7개 파일의 정확한 SHA256 연결을 기록한다.

7개 계약 중 수정한 것은 FSD·LLD·OpenAPI·DDL·구현 계획의 5개이며 나머지 HLD·Seed 2개는 그대로다. 과거 0001/0002 migration과 frozen baseline도 변경하지 않았다. 기존 테이블/ENUM 이름·값과 기존 S3 인터페이스·버킷·Compose 설정을 유지했다. 예전 보고서와 계약 archive도 변경하지 않았다. care_event의 단일 schedule 유일 제약은 활성 SUCCESS 부분 유일 인덱스로 바꿔 NOT_DONE과 취소 이력을 삭제 없이 보존한다. 활성 일정의 동일 garment/type/time에는 부분 유일 인덱스를 추가했다.

기존 wear snapshot을 현재 Outfit으로 추정하여 backfill하지 않는다. 기존 기록은 null/LEGACY_UNAVAILABLE로 표시하고 추천의 기존 시간 방어 규칙을 유지한다. 기존 활성 일정에 중복 데이터가 있으면 migration은 실패하며 자동 병합하지 않는다. 이력 손실을 막기 위해 downgrade는 거부하고 검토한 순방향 migration으로만 복구한다. 빈 DB DDL과 업그레이드 DB의 실제 catalog 비교를 통과했다.

## 실패 분류와 수정

| 구분 | 발견 항목 | 처리와 최종 상태 |
|---|---|---|
| 코드 결함 | 달력 최소·최대 값과 반복 계산의 overflow가 서버 오류로 이어질 수 있음 | 422 처리와 경계 테스트 추가, 최종 통과 |
| 코드 결함 | 라벨이 존재해도 대조하지 못한 사용자 온도/허용 값이 라벨보다 우선하는 구조화 응답에 남을 수 있음 | 라벨 제약만 적용, 프로필 원본 보존·미확인 경고·손세탁 제약 및 실DB 회귀, 최종 통과 |
| 테스트/검증 코드 결함 | 초기 outbox 테이블 이름, 공유 fixture 가정, HTTP PATCH의 금지된 garment_id, 긴 SQL lint | 실제 domain_event_outbox·명시 공유 fixture·올바른 PATCH DTO와 문장 분할로 수정, 최종 통과 |
| 설계 충돌 | 위 상태·이력·수정·반복 계약 부족 | 1.5/0003 최소 보완과 이전 원본 보존, 최종 계약/카탈로그 검사 통과 |
| 환경 제약 | 기존 비ASCII BuildKit 경로와 고정 패키지의 deprecation warning | 동일 코드 영문 임시 build context 사용; warning은 실패/skip으로 숨기지 않으며 의존성 핀은 유지 |

기존 Starlette/httpx, Alembic 설정, botocore UTC API의 deprecation warning은 남아 있다. 현재 테스트 실패는 없지만 후속 의존성 검토 대상이다. 새 환경 접근 거부나 시스템 보안 설정 변경은 없었다. 초기 실패 로그와 수정 후 증적은 test-results에 보존한다.

## 변경 파일

S4의 독립 source hash 목록과 현재 파일을 비교한 코드·테스트·검증 경로는 다음과 같다.

- `backend/alembic/versions/0003_sprint5_history_care.py` (added)
- `backend/app/api/v1/sprint5.py` (added)
- `backend/app/application/sprint1.py` (modified)
- `backend/app/application/sprint2.py` (modified)
- `backend/app/application/sprint5.py` (added)
- `backend/app/domain/care.py` (added)
- `backend/app/infrastructure/resources.py` (modified)
- `backend/app/main.py` (modified)
- `backend/app/schemas/sprint5.py` (added)
- `backend/tests/contract/test_design_contracts.py` (modified)
- `backend/tests/contract/test_sprint1_wire.py` (modified)
- `backend/tests/integration/test_postgres_platform.py` (modified)
- `backend/tests/integration/test_sprint1_completion.py` (modified)
- `backend/tests/integration/test_sprint5_api.py` (added)
- `backend/tests/integration/test_sprint5_migration.py` (added)
- `backend/tests/unit/test_care.py` (added)
- `scripts/smoke_sprint2.py` (modified)
- `scripts/smoke_sprint3.py` (modified)
- `scripts/smoke_sprint4.py` (modified)
- `scripts/smoke_sprint5.py` (added)
- `scripts/tasks.py` (modified)
- `scripts/verify_sprint1.py` (modified)
- `scripts/verify_sprint2.py` (modified)
- `scripts/verify_sprint3.py` (modified)
- `scripts/verify_sprint4.py` (modified)
- `scripts/verify_sprint5.py` (added)

문서·작업 진입점: `README.md`, `Makefile`, `docs/DECISIONS.md`, `docs/IMPLEMENTATION_TRACEABILITY.md`, `docs/SPRINT_5_CONTRACT_DECISIONS.md`, 이 보고서, `docs/CONTRACT_REVISION_1_5.json`, `docs/contracts/1.4/` 및 위 5개 현 계약 파일. `test-results/`에는 build/시험/실HTTP/최종 관찰과 계약 보완 helper 증적을 추가했다. Dockerfile·Compose·MinIO 이미지·화면 프론트엔드는 변경하지 않았다.

## 재현

Docker Linux engine과 기존 .env를 준비하고 전용 postgres-test를 실행한다. Windows에서는 같은 Python 3.12 실행 파일로 아래 작업을 수행한다. 비ASCII BuildKit 제한이 있으면 source 집합을 동일하게 보존한 영문 경로에서 빌드한다.

```powershell
python scripts/tasks.py up
python scripts/tasks.py migrate
docker compose --env-file .env -f infra/compose.yaml -f test-results/compose.verify.yaml --profile test up -d postgres-test
python scripts/tasks.py test-unit
python scripts/tasks.py test-contract
python scripts/tasks.py test-integration
python scripts/tasks.py lint
python scripts/tasks.py smoke-sprint5
python scripts/tasks.py test-e2e-sprint5
```

이미 Seed가 있는 주 DB에는 seed/초기화가 필요하지 않다. 테스트 DB 준비는 `docker compose --env-file .env -f infra/compose.yaml -f test-results/compose.verify.yaml --profile test up -d postgres-test`로 수행하며 포트는 publish하지 않는다. 최종 전체 회귀의 정확한 명령은 [command evidence](../test-results/sprint5-tests-final.json)에 있다. 별도 HTTP 검증은 UUID DB와 전용 worker 큐를 만들고 자신이 만든 자원만 정리한다. 비밀값·DSN·서명 URL은 보고서에 기록하지 않는다.

## 검토와 남은 위험

`sip`에 따라 `shower`가 구현 기준과 이 보고서를 각각 별도 문맥에서 끝까지 읽었다. 구현 기준의 참조 계약, 멱등성 범위, snapshot 시점, 페이지 간 동결 한계, 반복 기준과 취소 범위의 빈 설명을 보완했다. 보고서에서는 전체 프로젝트와 Sprint 5 판정의 구분, DB 준비 명령의 순서, 수정한 5개와 보존한 2개 계약의 관계를 명확히 했다. `mandela` 감사에서는 코드·DTO에서 생성한 계약만 서로 맞추는 순환 검증 위험을 확인해, 원 FSD의 금지 조건·독립 DST 시각 예시·실제 DB 카탈로그·이미지 hash·실제 HTTP/S3 결과를 별도로 사용했다. 다만 이 검증은 모든 외부 사업자 호환성이나 운영 보안 인증을 보장하지 않는다.

`ssotize`는 read-only로 현재 버전/기능 상태를 README·DECISIONS·추적표·실제 OpenAPI와 두 번째 검색으로 대조했다. 과거 보고서의 1.4/36개는 당시 증적이며 현재 상태의 충돌로 해석하지 않았다. 별도 통합·삭제 작업은 하지 않았다. `re0`로 현재 안내를 Sprint 5 기준으로 갱신하고 과거 근거는 유지했다. portability 주장은 없으므로 detool은 적용하지 않았다.

라벨 우선·금지 항목의 외부 근거는 [GINETEX care instructions](https://www.ginetex.net/GB/labelling/care-symbols.asp), 시간대/fold 의미는 [Python zoneinfo 공식 문서](https://docs.python.org/3/library/zoneinfo.html)로 확인했다. DST gap 이동·반복 회차 선택은 이 프로젝트의 명시적 정책이며 표준이 자동으로 정한 규칙이라고 주장하지 않는다. 케어 가이드는 라벨/사용자 입력과 일반 확인 안내이며 전체 케어 기호·모든 소재를 확정 진단하는 엔진이 아니다.

알려진 취약점이 남은 기존 MinIO는 [Sprint 0 보고서](SPRINT_0_REPORT.md)의 로컬 개발 전용 조건을 유지한다. MinIO/API는 loopback, renderer는 host port 없는 internal network이며 공개하지 않았다. npm audit 0이 전체 Python/OS/MinIO 보안을 의미하지 않는다. 데모 인증의 공개/운영 배포는 승인하지 않았다. 실 Decart 구현과 유료 검증, 실제 센서 ingress, 운영 보안 승인은 미완료 상태로 남긴다. Sprint 5 완료 조건을 우회해 표시한 항목은 없다.
