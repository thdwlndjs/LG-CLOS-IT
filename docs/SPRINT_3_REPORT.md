# Sprint 3 검증 보고서

판정: **기존 구현 계획의 Mock/provider port 완료 조건에 따른 Sprint 3 완료**. VTON-001~004를 구현·테스트·검증했고 최종 이미지에서 119 passed, 0 failed, 0 skipped를 확인했다. 실제 API·Celery worker·DB·Redis·MinIO의 TCP HTTP 검증 16개 묶음, readiness·정리 worker·소스/계약 해시 감사도 통과했다. 최종 감사 시각은 2026-10-08 20:08:52 KST이며 sprint3_complete=true, decart_live_verified=false다. Sprint 4와 프론트엔드는 구현하지 않았다.

중간 116/118개 및 경계 검증은 겹치는 실행이므로 합산하지 않는다. 최종 119개가 완료 근거다. Windows 호스트 Unit/계약도 별도71개가 통과했다. 최종 테스트의 dependency deprecation 경고266개는 로그에 보존했으며 실패·skip은 없었다. 운영 보안 승인이나 실제 Decart 성공을 완료로 계산하지 않는다.

## 구현 범위

| FSD | 동작과 완료 조건 |
|---|---|
| VTON-001 | 6개 진입 출처, 본인 코디 독립 복제·단일 의류·빈 초안, Context/인물 바인딩, 이미지 가용성 표시, 권한·동시 멱등성 |
| VTON-002 | PERSON 검증 업로드, 현재 outfit/revision·의류 이미지/동의 검증, durable DB job, 실제 Celery 비동기 Mock PNG, private 서명 결과·오류/timeout/3회 재시도/취소 |
| VTON-003 | expected_revision 충돌, revision마다 독립 outfit/항목 스냅샷, 과거 job 보존 및 늦은 결과·종료 결과의 현재 표시 금지 |
| VTON-004 | 현재 최종 선택·final_items_snapshot, 선택적 SAVED 처리, ACCEPTED/MODIFIED 피드백과 카드 진입 데이터, 종료 멱등성, wear_event 미생성 |

7개 새 업무 operation: POST/GET vton-sessions, PATCH vton-sessions/{id}/outfit, POST vton-sessions/{id}/end, POST vton-jobs, GET jobs/{id}, POST jobs/{id}/cancel. 기존 23개와 합계30개다. 공유 job 경로를 카드/보관 작업 전체 구현으로 해석하지 않는다. PERSON_VTON 업로드는 asset.kind=PERSON으로 매핑하며 기존 이미지 동의·SHA256·MIME·길이·디코딩·30일 보관을 그대로 적용한다.

Mock 결과는 320×240의 **MOCK - NOT A REAL TRY-ON** 안내 PNG다. 인물과 의류를 합성해 실제 VTON이 된 것처럼 표시하지 않는다. API provider_mode와 결과 asset/vton_job metadata is_mock=true로 구분한다. Decart 공식 [Lucy 2.1 VTON](https://docs.platform.decart.ai/api-reference/lucy-21-vton)와 [현재 VTON 모델](https://platform.decart.ai/models/lucy-vton)은 영상/스트림 입력을 설명한다. 이 정보만으로 정적 인물+복수 의류 PNG 계약이나 계정 지원을 확정할 수 없다는 판단으로, DecartAdapter는 capability failure를 반환하고 실제 외부 호출을 하지 않는다. 기존 DECART 구성 차단과 요청503을 유지한다. **실제 Decart 연동·결과 품질을 검증했다고 주장하지 않는다.** 구현 계획의 완료 조건인 Mock 비동기 완료·구버전 결과 미반영·provider 실패 전파를 검증 대상으로 삼는다.

## 계약과 데이터 보존

[구현 기준](SPRINT_3_CONTRACT_DECISIONS.md)을 기준으로 기존 구현 계획 §7.1/§12에 따라 API 1.3.0 DTO의 진입 바인딩·선택 구성·가용성·Mock 출처·현재/구버전 job·최종 카드 입력을 보완했다. 원본 7개 중 FSD·LLD·OpenAPI·구현 계획만 보완하고 HLD·DDL·Seed는 유지했다. 이전 1.2 바이트를 [보존본](contracts/1.2/06_OPENAPI.yaml), 이전/현재 7개 해시를 [manifest](CONTRACT_REVISION_1_3.json)에 기록한다. 1.1 보존본 및 Sprint 0~2 보고서·증적도 유지한다.

기존 outfit_session, outfit_session_event, outfit_feedback, job, vton_job, asset, domain_event_outbox로 구현했으며 새 migration은 없다. 0002_sprint1_contract, 32개 테이블·10개 ENUM과 Seed를 유지한다. 세션 초안은 원본 코디를 덮어쓰지 않고, 연결된 outfit을 Sprint 2 PATCH로 바꿀 수 없게409로 보호한다. 종료는 입어보기 결과를 기다리지 않고 최종 코디 구성만 확정하며 wear_event를 만들지 않는다.

## 비동기·실패 정책

Job/vton_job·입력 이미지/항목 스냅샷·outbox·멱등 응답은 하나의 DB 트랜잭션이다. 2초 주기의 Celery DB poller가 QUEUED 작업을 FOR UPDATE SKIP LOCKED로 가져온다. Redis enqueue와 DB commit을 하나의 트랜잭션으로 간주하지 않으며 공통 outbox dispatcher는 Sprint 7로 남긴다. 비ASCII workspace에서도 동일 코드/문서를 영문 staging에 복사해 빌드한다.

attempt_count·lease_owner·leased_until을 기록하고 중복 claim과 취소 이후 커밋을 막는다. 실패는 고정된 안전한 code/message로 반환한다. 네트워크/저장소·재시도 가능한 provider 실패는 최대3회와 2^attempt초 지연, 정책 오류는 즉시FAILED, 실행 timeout과 worker lease 만료는TIMED_OUT이다. 동시 provider 실행 제한과 timeout은 기존 설정을 사용한다. 결과 객체 키를 PENDING_UPLOAD asset 행에 먼저 커밋해 업로드 후 DB 실패·취소·worker 손실도 기존 정리 작업으로 추적한다. 성공 결과는 입력/사용자 동의를 다시 확인한다.

Job의 원래 결과는 해당 job에 보존하지만 revision 또는 세션 상태가 달라지면 stale=true/is_current=false이며 current_result_job_id로 노출하지 않는다. 같은 revision은 가장 최근 요청만 현재 job이다. 끝난 세션의 결과도 현재 미리보기로 표시하지 않는다. 공유 철회·동의 철회·보관 만료·의류 비가용 상태에서는 신규 결과 이미지 URL을 숨긴다. 원래 서명 URL은 기존 60초 bearer 수명을 따르며 물리 삭제 성공 시404다.

## 변경 파일

- 새 코드: app/schemas/sprint3.py, domain/vton.py, infrastructure/adapters/vton.py, application/sprint3.py, application/vton_worker.py, api/v1/sprint3.py, workers/vton.py. main.py 라우터·버전, core/config.py의 테스트 격리용 worker_queue, workers/celery_app.py imports·poller·큐를 보완했다.
- 기존 보완: application/assets.py의 PERSON_VTON→PERSON, application/sprint2.py의 세션 스냅샷 수정 차단. 의존성 핀·lock·Dockerfile·Compose는 변경하지 않는다.
- 검증/명령: tests/unit/test_vton_provider.py, integration/test_sprint3_api.py; 현재 1.3 및 역사 계약 해시·operation 수를 반영한 계약 테스트, 기존 smoke/verify 스크립트. scripts/verify_sprint3.py, smoke_sprint3.py, tasks.py, Makefile.
- 문서: 이 보고서·구현 기준·개정 manifest·1.2 보존본·DECISIONS·README·추적표와 필요한 원본 계약4개. test-results에 실행 보조·로그·JSON·JUnit을 보존한다.

## 증적과 재현

| 검증 | 최종 증적 |
|---|---|
| 고정 의존성 이미지 build | api/worker/storage-init/tests exit0: [build](../test-results/sprint3-build-final.log) |
| Unit/JWT/OpenAPI Validator·wire/실DB·Redis·MinIO | 최종 이미지 전체119 passed/0 failed/0 skipped: [JUnit](../test-results/sprint3-tests-final.xml), [log](../test-results/sprint3-tests-final.log) |
| Windows 호스트 Unit/계약 | 새 workspace basetemp로71 passed: [log](../test-results/sprint3-host-tests-final.log) |
| 실제 TCP HTTP + 전용 Celery worker | 16개 검증 묶음과 임시 API/worker/DB/큐·이미지 정리 통과: [JSON](../test-results/sprint3-live-evidence.json), [log](../test-results/sprint3-live-final.log) |
| Ruff/pip check | All checks passed / No broken requirements: [Ruff](../test-results/sprint3-lint-final.log), [pip](../test-results/sprint3-pip-final.log) |
| Compose/readiness/Sprint 1~3 smoke | api/postgres/redis/minio healthy, worker running, storage-init exit0 및 readiness 모두ok: [기동](../test-results/sprint3-up-final.log), [플랫폼](../test-results/sprint3-platform-smoke-final.log), [Sprint 1](../test-results/sprint3-login-smoke-final.log), [Sprint 2](../test-results/sprint3-sprint2-smoke-final.log), [Sprint 3](../test-results/sprint3-smoke-final.log) |
| 실제 만료 객체 정리 | 실제 Celery consumer가 만료 staging/final을 삭제: [worker](../test-results/sprint3-worker-final.log) |
| 정확한 소스/이미지 파일 집합·SHA256, 계약 해시, 주 DB 보존, 버전 핀, 서비스·loopback 및 임시 자원 제거 | API/worker/tests 이미지와 backend/scripts의 코드·SQL·설치 설정88개 파일이 정확히 일치, 현1.3/보존1.2·1.1 계약7개 해시 검증, Python3.12.9/직접핀18개 일치: [최종 감사](../test-results/sprint3-final-evidence.json), [감사 log](../test-results/sprint3-audit-final.log) |

테스트는 전용 postgres-test의 UUID DB를 생성·제거한다. 비동기 실패·취소·늦은 결과는 실제 DB/MinIO에서 제어된 provider fixture로 검증하고, HTTP에서는 별도 실제 API/Celery worker·전용 UUID 큐로 정상 비동기 완료를 확인한다. 대기 취소를 결정적으로 검사할 때 자기 테스트 worker를 pause/unpause한다. 이것은 실제 실행 중 취소 테스트와 별개로 기록한다. 업로드 객체는 테스트 종료의 동의 철회와 안전한 UUID DB 정리로 삭제한다. 실제 변환 품질·외부 Decart 장애를 재현한 테스트는 아니다.

Python 3.12.9·기존 해시 lock·Linux Docker engine·private .env가 필요하다. 먼저 README의 bootstrap으로 .env를 준비하고 공유하지 않는다. 저장소 루트에서 실행한다. 비ASCII BuildKit 제약은 Sprint 0 보고서의 영문 staging 절차를 따른다.

```powershell
docker compose --env-file .env -f infra/compose.yaml --profile test build api worker storage-init tests
docker compose --env-file .env -f infra/compose.yaml up -d --no-build postgres redis minio storage-init api worker
docker compose --env-file .env -f infra/compose.yaml -f test-results/compose.verify.yaml --profile test up -d postgres-test
docker compose --env-file .env -f infra/compose.yaml -f test-results/compose.verify.yaml --profile test run --rm --no-deps tests python -m pytest tests/unit tests/contract tests/integration -q --tb=short
python scripts/tasks.py test-e2e-sprint3
python scripts/tasks.py smoke
python scripts/tasks.py smoke-sprint1
python scripts/tasks.py smoke-sprint2
python scripts/tasks.py smoke-sprint3
python scripts/tasks.py lint
docker compose --env-file .env -f infra/compose.yaml exec -T api python -m pip check
docker compose --env-file .env -f infra/compose.yaml exec -T api python /workspace/scripts/check_storage_cleanup.py
```

주 DB를 재초기화·재seed하지 않는다. 주 DB smoke는 로그인 audit만 추가하며 도메인 fixture는 별도 DB에서 검증한다. 시스템 권한·보안 설정을 변경하지 않는다. 실패·skip을 성공으로 계산하지 않는다.

주 DB의 members=2, garments=3, Context=1, outfit=1, style=0, VTON session=0, job=0, feedback=0, wear_event=0을 유지했다. 최종 감사의 이미지 일치 범위는 코드·SQL·설치 설정 및 원본 계약7개이며, 완료 후 갱신한 이 보고서의 문구까지 이미지에 동일하다는 주장은 하지 않는다.

## 검토·실패 분류

코드 결함은 지원되지 않은 단일 의류 category가 내부 DTO 오류로 흐르던 부분을422로 고친 것, 최신 요청 시각을 transaction 시작의 now() 대신 세션 lock 안 실제 삽입의 clock_timestamp()로 고정한 것, 편집을 되돌린 경우의 피드백을 revision 횟수 대신 최초/최종 항목 집합으로 비교한 것이다. 각각 진입·종료·동시 요청 경계를 검증했다. Provider 실패·timeout·worker 손실·DB commit 실패는 주입한 검증 fixture이며 정상 서비스의 장애 발생을 뜻하지 않는다.

설계 공백은 인물 진입 바인딩·가용성·현재/구버전 결과 DTO와 물리 VTON 결과 매핑을 기존 테이블로 해결한 것이다. 실제 Decart 정적 이미지 계약·계정 지원은 미확정으로 남기고 Mock으로 우회 성공시키지 않는다. 환경 제약은 기존 비ASCII BuildKit과 테스트 host 포트 제한이며 영문 staging/ports reset을 유지했다. 호스트 pytest는 기존 Temp 권한을 변경하지 않고 workspace의 새 UUID basetemp를 사용했다.

새 문맥의 계약 검토 결과를 반영해 정확한 API 참조, 최신 요청/실패 시 이전 결과 미복원, 피드백 비교, lease/backoff·최초 포함3회, 가용성·자산 보관·멱등 수명을 [구현 기준](SPRINT_3_CONTRACT_DECISIONS.md)에 명시했다. 검증은 고정 정책·실DB 행/상태·실제 객체·실제 큐 소비에 근거하며 사용자 선호 품질·실제 VTON 품질을 평가하는 실험으로 해석하지 않는다.

## 남은 위험과 범위

기존 MinIO는 알려진 보안 위험이 남은 로컬 개발 전용이며 운영 안전성을 승인하지 않는다. API·MinIO는 loopback, 버킷은 private를 유지한다. PERSON 입력과 결과는 개인정보 동의·보관·서명 정책을 적용하지만 운영 개인정보 제품 정책 전체를 완료한 것은 아니다. 객체 정리는 서비스 장애 동안 지연되고 복구 후 재시도한다. Decart live·운영 보안 승인·카드 이미지 렌더링·착용 확인·공통 이벤트 dispatcher·프론트엔드는 이번 완료 범위에 포함하지 않는다.
