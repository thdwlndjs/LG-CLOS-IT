# Sprint 2 검증 보고서

판정: **Sprint 2 완료**. 기존 구현 계획의 REC-001/002, OUTFIT-001/002, STYLE-001을 구현·테스트·검증했다. 2026-10-08 19:25:54 KST 최종 감사에서 98 passed, 0 failed, 0 skipped 및 sprint2_complete=true를 확인했다. 계약 비교의 title 필드 결함 수정 후 최종 이미지 전체 테스트와 실제 TCP HTTP 11개 검증 묶음, readiness·worker 정리·소스/계약 해시 감사가 모두 다시 통과했다. 현재 업무 operation은 23개이며 이번 Sprint 2에서 10개를 추가했다. Sprint 3와 프론트엔드는 구현하지 않았다.

개발 단계 93개와 경계 검증 22개는 겹치는 중간 실행이며 합산하지 않는다. 최종 98개 테스트를 완료 근거로 사용한다. 의존성 deprecation 경고 57개는 로그에 보존했으며 실패·skip은 없었다. 기존 MinIO의 운영 보안 승인은 완료 판정에 포함하지 않는다.

## 범위와 계약

| FSD | 구현·완료 기준 |
|---|---|
| REC-001 | immutable Context 수집·조회, timezone/UTC 검증, source_status/missing_fields, 명시적인 MOCK/PARTIAL 출처, 누락된 Seed 일정 시각 추정 금지 |
| REC-002 | AVAILABLE 및 접근 권한·care 필터, 최대 200개 조합, 계절/기온/일정/확정 이력 점수, 다양성 Top-K, 결정적 fixture, 후보 DRAFT 저장·추천 outbox·멱등 응답 원자성 |
| OUTFIT-001 | 본인 코디 목록·상세·저장·보관, 참조 의류 누락 표시, wear_event 미생성 |
| OUTFIT-002 | 슬롯·필수 구성·권한 검증, 초안/저장 구분, If-Match 충돌, 보관 후 편집 차단, 후속 입어보기용 outfit/context ID |
| STYLE-001 | 본인 자료 등록·출처별 목록·삭제, STYLE 검증 업로드, 동의·보관 정책 및 private 이미지 URL, 외부 URL 자동 수집 금지 |

[구현 기준](SPRINT_2_CONTRACT_DECISIONS.md)에 점수·필터·제한·보관·이미지 정책을 명시했다. 기존 구현 계획 §7.1/§12의 계약 보완 규칙에 따라 OpenAPI 1.2.0으로 Context 출처/누락 정보, 코디 보관 입력·누락/구성 유효성, 스타일 이미지 출력을 보완했다. 원본 7개 중 FSD·LLD·OpenAPI·구현 계획만 필요한 부분을 보완했으며 HLD·DDL·Seed는 이전과 동일하다. 이전 1.1 계약의 정확한 바이트는 [보존본](contracts/1.1/06_OPENAPI.yaml), 7개 이전/현재 해시는 [개정 manifest](CONTRACT_REVISION_1_2.json)에 기록했다. Sprint 0/1 보고서와 과거 증적은 유지한다.

추천 세션 연결은 persisted 후보 outfit_id 및 context_snapshot_id 제공과 recommendation aggregate 기록까지다. 기존 outfit_session/feedback/wear_event는 과거 확정 이력 읽기에만 사용한다. 새 VTON 세션 API와 Wear 확인은 후속 Sprint 범위다. 물리 스키마·migration은 0002_sprint1_contract, 32개 테이블·10개 ENUM을 유지한다. 외부 LIVE provider가 구성되지 않은 AUTO는 PARTIAL로 누락을 반환하고, 합성 값은 MOCK 출처로 표시한다.

원본 계약 7개는 03_ARCHITECTURE_HLD_v1.1.md, 04_FSD.md, 05_BACKEND_LLD.md, 06_OPENAPI.yaml, 07_DATABASE_SCHEMA.sql, 07_DATABASE_SEED.sql, 08_IMPLEMENTATION_PLAN.md다. 코디 보관은 PATCH status=ARCHIVED이며 기존 garment/slot/position을 유지하고 보관 이후 수정·재활성은 409로 거부한다. 스타일 삭제는 자료 참조를 제거하고 이미지 물리 삭제는 동의·보관 정책을 따른다.

## 변경 파일

- application/domain/adapter/API/DTO: backend/app/application/sprint2.py, domain/recommendations.py, infrastructure/adapters/context.py, api/v1/sprint2.py, schemas/sprint2.py. main.py에 별도 라우터와 API 1.2.0을 연결했다. assets.py는 STYLE 목적과 kind 저장만 확장한다.
- 검증: backend/tests/unit/test_recommendations.py, integration/test_sprint2_api.py; 기존 test_design_contracts.py/test_sprint1_wire.py는 현재 계약·1.1 보존본과 204 무본문 비교를 반영한다. scripts/smoke_sprint2.py와 verify_sprint2.py를 추가하고 tasks.py/Makefile에 실행 명령을 연결한다. verify_sprint1.py의 노출 업무 operation 기대값은 현재 23개로 맞춘다.
- 문서: 이 보고서, 구현 기준, 개정 manifest, 1.1 보존본, DECISIONS/IMPLEMENTATION_TRACEABILITY/README와 필요한 원본 계약 4개. 검증 보조 스크립트·JSON·로그·JUnit은 test-results에 남긴다. 의존성 핀·lock·Compose·Dockerfile은 변경하지 않는다.

## 최종 증적

| 검증 | 증적 |
|---|---|
| 이미지 build | api/worker/storage-init/tests 모두 exit 0: [log](../test-results/sprint2-build-final.log) |
| JWT·Unit·OpenAPI Validator/wire·실DB/Redis/MinIO 통합 | 이미지 내 backend/tests/unit·contract·integration 전체 98 passed/0 failed/0 skipped: [JUnit](../test-results/sprint2-tests-final.xml), [log](../test-results/sprint2-tests-final.log) |
| Windows 호스트 Unit·계약 | 새 workspace basetemp에서 69 passed: [log](../test-results/sprint2-host-tests-final.log) |
| 실제 TCP HTTP 회귀 및 Sprint 2 | 11개 검증 묶음 통과 및 임시 자원 제거: [JSON](../test-results/sprint2-live-evidence.json), [log](../test-results/sprint2-live-final.log) |
| Ruff·pip check | All checks passed, No broken requirements: [Ruff](../test-results/sprint2-lint-final.log), [pip](../test-results/sprint2-pip-final.log) |
| Compose·readiness·smoke | 4개 서비스 healthy, worker running, storage-init exit 0, readiness의 database/redis/storage 모두 ok: [기동](../test-results/sprint2-up-final.log), [플랫폼](../test-results/sprint2-platform-smoke-final.log), [Sprint 1](../test-results/sprint2-login-smoke-final.log), [Sprint 2](../test-results/sprint2-smoke-final.log) |
| 실제 Celery 객체 정리 | 만료 staging/final 객체 실제 삭제와 자기 fixture 제거: [log](../test-results/sprint2-worker-final.log) |
| 소스/이미지 파일 목록·SHA256, 계약 7개 해시, DB·서비스·loopback·버전 핀·테스트 자원 정리 | backend/scripts 코드·SQL·설치 설정 77개 파일의 정확한 집합·SHA256 일치, 현재/이전 계약 7개 해시 검증, Python 3.12.9·직접 핀 18개 일치: [최종 감사](../test-results/sprint2-final-evidence.json), [감사 log](../test-results/sprint2-audit-final.log) |

Unit의 70/61/80 등 기대 점수는 fixture의 입력과 정책 산술로 별도 지정하며 런타임 추천 결과를 기대값 생성에 사용하지 않는다. OpenAPI wire 비교와 계약 보존 해시를 함께 검사하고 실제 DB 행·outbox·롤백·격리·서명 객체 바이트와 삭제를 관측한다. 이는 규칙 구현 정확성 검증이며 실제 사용자 선호 품질이나 운영 보안을 입증하는 실험은 아니다.

70점은 기본50+계절10+기온10, 61점은 70에서 과거 확정 착용 3항목×5를 감점하고 과거 ACCEPTED 3항목×2를 더한 값, 80점은 70에 실제 당일 WORK 일정과 세 의류의 WORK 태그 적합10을 더한 값이다. 미래에 확정된 이력과 이후 수정된 코디 구성은 제외하는 경계를 실제 DB fixture로 검증했다. 공유 철회 후 의류 누락과 추천 outbox 실패 시 후보·멱등 응답의 원자적 롤백도 통과했다.

주 DB의 기존 members=2, garments=3, contexts=1, outfits=1, styles=0, outfit_session=0, wear_event=0을 보존했다. runtime hash 검증은 최종 API 이미지의 코드·SQL·설치 설정 및 계약 원본을 대상으로 한다. 완료 판정 후 갱신한 이 보고서의 문구가 이미지에도 동일하다는 주장은 하지 않는다.

## 재현

Python 3.12.9, 기존 해시 lock 의존성, Docker Desktop Linux engine와 private .env가 필요하다. 저장소 루트에서 실행한다. BuildKit이 한글 workspace 경로를 거부하면 Sprint 0 보고서의 영문 staging 절차로 동일 backend/docs/scripts/infra를 복사해 빌드한다.

```powershell
docker compose --env-file .env -f infra/compose.yaml --profile test build api worker storage-init tests
docker compose --env-file .env -f infra/compose.yaml up -d --no-build postgres redis minio storage-init api worker
docker compose --env-file .env -f infra/compose.yaml -f test-results/compose.verify.yaml --profile test up -d postgres-test
docker compose --env-file .env -f infra/compose.yaml -f test-results/compose.verify.yaml --profile test run --rm --no-deps tests python -m pytest tests/unit tests/contract tests/integration -q --tb=short
python scripts/tasks.py test-e2e-sprint2
python scripts/tasks.py smoke
python scripts/tasks.py smoke-sprint1
python scripts/tasks.py smoke-sprint2
python scripts/tasks.py lint
docker compose --env-file .env -f infra/compose.yaml exec -T api python -m pip check
docker compose --env-file .env -f infra/compose.yaml exec -T api python /workspace/scripts/check_storage_cleanup.py
```

통합 검증은 전용 postgres-test의 UUID DB와 자기 임시 API를 생성·제거한다. 주 DB는 재초기화·재seed하지 않으며 smoke 로그인 audit만 추가한다. STYLE 객체는 동의 철회로 실제 삭제를 검증한다. 55432를 열지 않는 ports reset override를 사용한다. 시스템 권한이나 보안 설정을 바꾸지 않는다.

## 실패 분류와 남은 위험

코드 결함: archive 비교가 요청 항목 순서에 의존하던 부분과 후보 조합의 메모리 제한을 수정했다. 썸네일 조회를 위해 갱신 가능한 private 이미지 서명을 제공한다. OpenAPI 정규화가 schema의 설명용 title과 properties의 실제 title을 함께 제거하던 결함을 발견해 비교 로직·Outfit/OutfitUpsert/StyleReference 원본 필드를 수정하고 회귀 테스트를 추가했다. 최종 이미지를 다시 빌드해 전체 98개와 HTTP·감사를 재실행했다. 설계 간 공백: Context provenance, ARCHIVED 입력과 추천 기록 물리 매핑을 최소 계약 보완으로 명시했다.

환경 제약: 비ASCII BuildKit 경로와 테스트 DB host 포트 제한은 기존 영문 staging·ports reset 절차를 따른다. Windows pytest의 기존 Temp 폴더가 WinError 5로 거부돼 [실패 로그](../test-results/sprint2-contract-fix.log)를 보존하고 workspace 내 새 UUID 경로를 --basetemp로 지정해 69개를 재검증했다. ACL·시스템 권한은 변경하지 않았다. 실패를 skip이나 Mock DB로 완료 처리하지 않는다.

기존 MinIO 바이너리는 알려진 보안 위험이 남은 로컬 개발용이며 운영용 안전 버전으로 승인하지 않는다. API·MinIO는 loopback만 공개하고 버킷은 private다. 서명 URL은 bearer 권한이므로 로그에 남기지 않으며 공유/동의 변경 시 기존 URL은 최대 60초 잔존할 수 있다. 객체 삭제 실패는 503과 worker 재시도로 처리한다. 실제 LIVE weather/calendar·Decart, 과거 확정 구성 Snapshot 확장, outbox dispatcher, 프론트엔드는 후속 범위다. 전체 FSD E2E-01~09 완료나 운영 출시를 판정하지 않는다.
