# Sprint 6 보관 최적화 검증 보고서

판정: **Sprint 6 STO-002~004 범위 완료**. 최종 관찰 시각은 2026-10-09 00:17:24 KST다. Sprint 7과 화면 프론트엔드는 진행하지 않았다. 실제 Decart 어댑터는 미구현이고 유료 호출 검증은 모든 Sprint 종료 후로 보류한다. 전체 프로젝트 또는 실제 Decart 연동의 완료 판정은 아니다.

## 구현 결과

API 1.6.0은 기존 46개에 보관 업무 5개를 추가한 51개 operation을 제공한다. 착용·계절 기반 및 공간·환경 기반 분석은 실제 Celery worker에서 수행한다. 판단 시점의 입력·규칙·의류/상태/케어 version을 고정하고 제안·보류 이유를 반환한다. 확정·취소되지 않은 착용 이력만 집계하며 선택/추천/세션 종료를 착용으로 취급하지 않는다.

APPROVE는 위치를 갱신하지 않는다. 승인된 입고 예약을 현재 점유에 더하고, USER가 실제 목적지와 관측 시각을 확인한 item만 위치·confidence·last_seen·version과 MANUAL observation/outbox를 같은 transaction에서 갱신한다. 일부 확인은 AWAITING_CONFIRMATION, 모든 성공은 COMPLETED, 일부 실패로 전체 종료되면 FAILED다. 거부·미완료 취소·중복 key·버전 충돌·만료·늦은 worker 결과를 처리한다. 검증된 센서 ingress가 없으므로 SENSOR_VERIFIED는 503으로 거부한다.

## 범위별 검증

| 범위 | 검증 내용 | 증적 |
|---|---|---|
| STO-002 | 실제 착용 스냅샷·취소 제외, 명시적 계절, 설명 가능한 결정적 점수, cold start, dry-run | storage rules unit, Sprint 6 integration, HTTP evidence |
| STO-003 | 용량·점유 단위, 타 소유자/폐기 의류 점유, 승인 예약, 미확인 공간, 환경 측정 시각·NaN·care 제약, 초과 배치 거부 | storage rules unit, Sprint 6 integration |
| STO-004 | 승인 시 위치 유지, 실제 부분/전체 확인, 부분 실패, 동시 멱등 요청, version 경쟁, 변경된 입력 rollback, 취소/만료 | Sprint 6 integration, HTTP evidence |
| 비동기 | 실제 Celery durable poller, bounded retry 3회, lease timeout, queued/running cancel, 취소/입력 변경 후 commit 차단 | Sprint 6 integration, HTTP evidence |
| 회귀 | Sprint 0~5 단위·계약·실DB, JWT, OpenAPI validator, 카드 실제 Chromium/S3, readiness/smoke, Ruff/pip | 최종 명령 로그와 JUnit |

최종 이미지에서 Python **198개 전부 통과, 실패·error·skip 0**(단위 97, 계약 8, 실DB 통합 93), Windows 단위·계약 105개, 실제 HTTP/worker **35개 검증 묶음**, renderer Node 테스트 3개가 통과했다. HTTP 묶음은 evidence.checks의 이름별 시나리오이며 Python testcase 수와 합산하지 않는다. HTTP 검증 DB의 action 2개/item 3개 중 item 완료 2개·미이동 실패 1개, 이동 MANUAL 관측 2개를 확인했고 착용 수는 기존 1개를 유지했다. API의 자기 보고와 별도로 SQL의 실제 위치/version·관측 수를 대조했다. 여기서 독립 관찰은 별도 조회를 뜻하며 별도 외부 감사기관의 인증을 뜻하지 않는다.

| 최종 확인 | 결과 | 원자료 |
|---|---|---|
| 전체 Python | 198 passed, 실패·skip 0; 소스 bind mount 없이 최종 이미지 실행 | [JUnit](../test-results/sprint6-tests-final.xml), [로그](../test-results/sprint6-tests-final.log) |
| 실제 HTTP/worker | 35개 시나리오, 전용 DB/API/worker/queue 정리 | [증적](../test-results/sprint6-live-evidence.json), [로그](../test-results/sprint6-live-final.log) |
| 이미지·코드 동일성 | host/API/worker/tests 117개 파일의 정확한 집합과 SHA256 일치, runtime image ID 기록 | [최종 상태](../test-results/sprint6-final-evidence.json), [관찰 로그](../test-results/sprint6-audit-final.log) |
| 기동·readiness | PostgreSQL/Redis/MinIO/API/renderer healthy, worker running, storage-init exit 0; 네 의존성 ok | [기동](../test-results/sprint6-up-final.log), [smoke](../test-results/sprint6-smoke-final.log) |
| Ruff·의존성 | Ruff/pip check 통과, Python 3.12.9 및 직접 핀 18개 일치 | [Ruff](../test-results/sprint6-lint-final.log), [pip](../test-results/sprint6-pip-final.log), 최종 상태 |
| renderer | Node 3 passed, npm audit vulnerabilities 0; 서비스는 내부 네트워크 유지 | [테스트](../test-results/sprint6-renderer-tests-final.log), [감사](../test-results/sprint6-npm-audit-final.log) |
| DB·정리 | head 0003, 32 tables/10 ENUM; 주 DB Storage 작업/item/환경 측정·착용/케어 이력 0, private 버킷 객체 0 | [revision](../test-results/sprint6-revision-final.log), 최종 상태의 database_catalog/main_domain_counts/storage_cleanup |

주 DB의 members 2·garments 3·Context 1·outfit 1을 보존했다. 운영 데이터에 시나리오를 실행하지 않았으며 전용 테스트 DB에서만 migration/seed를 적용했다. PostgreSQL과 실제 S3 목록 조회로 정리 결과를 재확인했다. 테스트 로그의 기존 라이브러리 deprecation 경고는 실패나 skip으로 처리하지 않았고 고정 의존성을 임의 변경하지 않았다.

재검증은 README의 Docker 환경에서 `python scripts/tasks.py smoke-sprint6`와 `python scripts/tasks.py test-e2e-sprint6`을 사용한다. 최종 전체 명령·빌드 문맥·반환 코드는 각 [tests](../test-results/sprint6-tests-final.json), [build](../test-results/sprint6-build-final.json), [HTTP](../test-results/sprint6-live-final.json), [관찰](../test-results/sprint6-audit-final.json)에 기록했다. 테스트 결과 디렉터리만 JUnit 출력용으로 마운트했다. 이미지의 실행 소스와 revision/계약/해시를 확인하는 읽기 전용 관찰은 `python test-results/check_sprint6_final.py`다. 기존 증적은 해당 실행 시점의 기록이며 새 검증은 새 로그와 함께 판정해야 한다.

## 계약과 변경 파일

[구현 기준](SPRINT_6_CONTRACT_DECISIONS.md)과 [1.6 manifest](CONTRACT_REVISION_1_6.json)에 보완 근거를 기록했다. 원본 API에는 분석 입력·결과·version·실제 확인 근거가 부족했고 item PROPOSED는 DB PENDING과 달랐다. 구현 계획 §7.1에 따라 기존 5개 경로의 DTO를 보완하고 공통 Job에 storage_result를 추가했다. 이전 1.5의 7개 파일은 [archive](contracts/1.5/)에 바이트 그대로 보존했다. FSD·LLD·OpenAPI·구현 계획 4개를 갱신했고 HLD·DDL·Seed·Compose와 기존 migration은 유지했다. 새 migration이나 주 DB Seed 재적재는 없다.

신규 핵심 파일은 app/domain/storage.py, application/sprint6.py·storage_worker.py, schemas/sprint6.py, api/v1/sprint6.py, workers/storage.py다. 기존 공통 jobs router/DTO·main·Celery 등록을 연결했고, 용량 경쟁 직렬화를 위해 의류 생성/변경/관측의 repository에 household lock을 추가했다. 신규 storage unit/integration 및 smoke_sprint6.py·verify_sprint6.py를 추가하고 tasks.py·Makefile·기존 smoke의 현재 API 기대값을 갱신했다. README·DECISIONS·추적표를 현재 상태로 정리했다. 정확한 코드 파일 목록은 최종 evidence의 changed_code_files와 SHA256을 따른다.

## 실패 분류와 대응

| 분류 | 관찰과 처리 |
|---|---|
| 코드/검증 결함 | 초기 SQL 문자열 Ruff 길이 오류를 의미 보존 분할로 수정했다. 테스트의 blocked_items/blocked 오기, override kwargs 중복, JSON SQL의 잘못된 bind 해석을 수정하고 재실행했다. 환경 NaN을 정상 측정으로 통과시키지 않도록 추가 방어했다. |
| 환경 제약 | 잘못 선택한 시스템 Python에는 redis/botocore가 없어 수집이 실패했다. 기존 프로젝트 Python으로 재실행했으며 전역 환경은 수정하지 않았다. 내부 전용 renderer의 npm audit는 외부 DNS가 차단되어 실패했다. 동일 이미지의 임시 기본 네트워크 컨테이너에서 감사하여 0 vulnerabilities를 확인했고 서비스 네트워크는 유지했다. |
| 설계 충돌 | DTO와 물리 item 상태 및 미정 분석/확인 필드를 명시적 1.6 계약으로 보완했다. 신규 API·DDL·장비 ingress는 추가하지 않았다. |

## 한계와 보안 위험

storage-greedy-v1은 고정 규칙의 프로토타입이며 최적 배치·사용자 만족도·물리 수납 가능성을 입증하지 않는다. capacity_units는 추상 단위이고 공간/환경 설정은 기존 DB/import 경로다. 임의 SQL 갱신은 advisory lock을 우회할 수 있으므로 실행 중 설정/데이터 import는 조정이 필요하다. 소재로 임의 온습도 제약을 생성하지 않고 저장된 명시적 조건만 검사한다. 장비 자동 이동·센서 검증·outbox dispatcher·알림은 이 범위 밖이다.

기존 MinIO 바이너리의 보안 위험은 남아 있으며 운영에 안전한 버전으로 간주하지 않는다. API/MinIO는 loopback, renderer는 내부 네트워크/호스트 포트 없음과 비루트 실행을 유지한다. 권한·시스템 보안 설정 변경은 없다. VTON은 MOCK이고 실제 Decart 구현/유료 검증은 이 완료 판정에 포함하지 않는다.

## 품질 검토

sip의 mandela 점검에서 구현자가 설계한 점수 테스트는 추천 품질의 독립 근거가 될 수 없음을 구분했다. 검증 주장은 계약·실제 transaction/HTTP/worker/storage 동작에 한정한다. 원본 계약·JUnit·SQL 상태·실제 이미지 결과·파일 해시를 대조하며 Mock을 실 provider 성공으로 해석하지 않는다. ssotize는 감사만 수행했으며 현재 README·DECISIONS·추적표와 API/테스트를 다른 검색어로 대조했다. 정책은 구현 기준, 판정은 이 보고서, 원자료는 위 evidence를 따른다. 계약 archive와 과거 보고서를 현재 판정으로 덮어쓰지 않았다. re0로 현재 README·결정·추적표의 오래된 범위를 갱신했다. 외부 제품/가격·운영 안전성의 새 사실 주장이나 이식성 주장은 없으므로 factchk·detool은 적용하지 않았다. fresh shower 검토의 minor gaps였던 증적 경로·실행 방법·집계 단위·독립 관찰의 의미를 보완했다.
