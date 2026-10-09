# Sprint 7 홈·이벤트·백엔드 인수 보고서

판정: **Sprint 7 백엔드 Mock 인수 완료**. 2026-10-09 06:58 KST에 최종 이미지 전체 회귀와 실행 상태 대조를 완료했다. 기존 구현 계획의 COM-002(홈 집계)와 공통 이벤트·관찰 기능 범위다. 화면 프론트엔드·실제 하드웨어·선택적 n8n은 진행하지 않았다. 실제 Decart 어댑터와 유료 최종 연동 검증은 미완료이며 이 Mock 백엔드 인수와 구분한다.

## 구현

API 1.7.0은 기존 home을 포함한 원본 업무 경로 52개를 모두 제공한다. FSD 28개를 명시적 프로토타입 경계로 추적한다. 홈은 본인의 당일 Context·추천 근거·미완료 케어/보관을 읽기 집계하며 at/timezone, source_status/partial로 날짜·캐시·Mock·부분 실패·집계 제한을 표시한다. 조회가 Context·추천·착용·이벤트를 생성하지 않는다. 소스별 3초 timeout과 병렬 집계로 부분 장애를 격리한다. 변경·보관·권한 철회·사용 불가 코디는 추천 후보에서 제외한다.

실제 Celery/Redis outbox dispatcher를 연결했다. DB commit 뒤 claim·60초 예약을 기록하고 transaction 밖에서 broker에 전송한다. max 5회와 지수 backoff, FAILED 보존, attempts 기반 fencing을 적용한다. broker 수락은 PUBLISHED, 소비 완료는 audit_log의 DOMAIN_EVENT_CONSUMED receipt다. DB 원문과 envelope를 비교하고 event_id의 deterministic PK로 영구 중복 소비를 막는다. 작업 요청은 기존 durable poller를 깨우며 beat는 장애 후 미완료 작업을 회수한다. 다른 이벤트는 receipt만 남기고 외부 알림 전송으로 표시하지 않는다.

내부 `observe` 명령은 outbox 미전송/재시도/소진/미소비, job 상태/attempts/latency, stale 의류, 빈 추천을 SQL 집계한다. 구조화 로그는 request/correlation/job/event ID·attempts·provider mode·outcome·duration을 허용 목록으로 출력하며 payload·사진·서명 URL·원문 provider 오류를 출력하지 않는다. Celery 이벤트 인자 로그도 envelope 내용 대신 고정 안내로 표시한다. metrics HTTP endpoint나 외부 n8n callback은 추가하지 않았다.

## FSD 원문 E2E

| 원문 | 검증 이름·동작 |
|---|---|
| E2E-01 오늘의 코디 | today_outfit_home_context_reason: 홈·Context·추천 근거·본인 범위·조회 불변 |
| E2E-02 추천→가상착용→카드 | recommend_mock_vton_final_card_save_reuse: 추천 후보 ID에서 Mock VTON·최종 선택·실제 Chromium 카드·저장·재사용 |
| E2E-03 수동 코디 제작 | manual_outfit_to_common_vton_initial_values: 수동 선택한 의류가 공통 입어보기 초기 구성에 반영 |
| E2E-04 실제 착용 이력 | session_end_is_not_wear_explicit_history: 종료만으로 착용 없음, 별도 확인 후 history |
| E2E-05 의류 위치 찾기 | location_confidence_observed_and_unknown: 알려진 위치의 신뢰도/시각, 미관측 unknown |
| E2E-06 보관 최적화 | proposal_approval_actual_move_only: 제안·승인·실제 확인 및 위치·observation·중복 방어 |
| E2E-07 케어 일정 | care_guide_schedule_complete_calendar: 가이드·일정·수행·history |
| E2E-08 스타일 보관함 | style_source_reference_then_outfit_editor: 출처별 조회·참고 제목·수동 제작·입어보기 진입 |
| E2E-09 외부 장애 | external_failure_retry_and_honest_mock_sources: 주입한 provider 429/renderer 장애의 bounded 재시도·실패, 미연동 Context의 PARTIAL 출처 |

별도 [tests/e2e](../backend/tests/e2e/test_acceptance.py)의 **9개 명명된 테스트**가 집중 실행에서 모두 통과했다. ASGI API와 실제 PostgreSQL·Redis·MinIO·Chromium/worker 처리 함수를 사용한다. 이 테스트의 processor 직접 실행을 Celery broker 수락의 근거로 취급하지 않으며 실제 HTTP/Celery 전송은 아래 독립 HTTP 실행에서 확인한다. 원문 시나리오 이름을 구현 계획의 축약 목록으로 대체하지 않았다. Mock 이미지나 주입한 실패로 실제 Decart 품질·연결을 주장하지 않는다.

## 최종 증적과 재현

최종 이미지에서 **217 passed, 0 failed, 0 skipped**를 확인했다. 구성은 unit 100개, 계약 8개, 실DB 통합 100개, 원문 E2E 9개다. 호스트 unit/계약 108개와 renderer 테스트 3개도 통과했다. 실제 HTTP/Celery 검증 39개 항목이 통과했고, 이벤트 80개의 broker 수락과 소비 receipt 80개를 확인했다. 실제 중복 전달은 duplicate=true로 종료되어 receipt 수가 증가하지 않았다. 빌드·기동·Ruff·의존성 검사·smoke·npm 보안 감사·최종 대조 명령의 반환 코드는 모두 0이다.

호스트/API/worker/tests의 정확한 소스 파일 집합과 SHA256이 **129개 모두 일치**한다. readiness의 DB·Redis·Storage·Renderer가 모두 정상이다. 주 DB는 기존 head 0003_sprint5_history_care, 테이블 32개/ENUM 10개, 회원 2명/의류 3개를 유지하며 테스트 업무 데이터가 남지 않았다. 검증 전용 DB/API/worker는 제거됐고 private bucket의 객체는 0개다. 전체 회귀에서 deprecation 경고 589개를 기록했으며 실패나 skip을 숨기지 않았다.

52개는 원본 OpenAPI의 HTTP 메서드·경로별 업무 operation 수이고, 28개는 기능 명세서(FSD)의 기능 ID 수다. 두 수치는 서로 다른 단위이며 [추적표](IMPLEMENTATION_TRACEABILITY.md)가 대응 관계와 프로토타입 제한을 기록한다. 이번 인수는 이 백엔드 범위와 원문 E2E-01~09의 Mock 검증에 한정한다.

최종 판정 원자료는 [JUnit](../test-results/sprint7-tests-final.xml), [전체 로그](../test-results/sprint7-tests-final.log), [실제 HTTP 증적](../test-results/sprint7-live-evidence.json), [최종 상태](../test-results/sprint7-final-evidence.json)다. 각 반환 코드·정확한 명령은 sprint7-*-final.json이며 build/검증 이미지와 런타임 ID·파일 SHA256을 함께 대조한다. 최종 이미지의 소스는 bind mount로 대체하지 않고 결과 폴더만 JUnit 출력에 마운트한다.

`python scripts/tasks.py smoke-sprint7`은 읽기 전용 health/계약/권한 smoke다. `python scripts/tasks.py test-e2e-mock`은 FSD 9개를, `python scripts/tasks.py test-e2e-sprint7`은 전용 UUID DB/API/실제 Celery 큐의 Sprint 1~7 HTTP 흐름과 실제 outbox 중복 전달을 검증한다. `python scripts/tasks.py observe`는 내부 DB 집계를 출력한다. 기존 Docker 환경과 postgres-test가 필요하며 [README](../README.md)를 따른다. Windows 포트 제한에서는 test-results/compose.verify.yaml의 기존 ports reset을 사용한다.

명령은 프로젝트 루트 `C:\Users\aicam\Desktop\2차프로젝트`에서 설치된 `.venv/Scripts/python.exe`로 실행한다. PostgreSQL·Redis·MinIO·storage-init·renderer·API·worker와 전용 postgres-test가 준비되어야 한다. E2E 명령은 전용 DB에 migration과 fixture를 적용하고 종료 후 제거하며, 주 DB를 초기화하거나 Seed를 재적재하지 않는다. smoke와 observe는 읽기 전용이다. 인수 조건은 최종 이미지 테스트의 실패/skip 0, HTTP 흐름 통과, 소비·중복 검증, 소스/이미지 일치, 잔여 검증 자원 제거였으며 모두 충족했다.

최종 별도 상태 관찰은 `python test-results/check_sprint7_final.py`로 실행한다. API 자기 보고뿐 아니라 SQL 위치/관측/receipt·실제 S3 객체 목록·컨테이너 상태·코드 해시를 확인한다. 여기서 독립 조회는 별도 외부 인증기관의 감사를 의미하지 않는다. 과거 로그는 해당 시점 증적이고 새 실행은 새 결과로 판정해야 한다.

## 계약·파일·실패 분류

[구현 기준](SPRINT_7_CONTRACT_DECISIONS.md)과 [1.7 manifest](CONTRACT_REVISION_1_7.json)에 정책·충돌을 기록했다. 홈의 기준 시각·시간대가 FSD에 있지만 기존 OpenAPI에 없고, LLD의 DEAD/processed_event는 물리 DDL에 없었다. 기존 home DTO/입력을 보완하고 최대 시도 FAILED와 기존 audit_log receipt로 매핑했다. FSD·LLD·OpenAPI·구현 계획 4개를 개정하고 이전 1.6의 [7개 원본](contracts/1.6/)을 보존했다. HLD·DDL·Seed·기존 migration·Compose·비밀/보안 설정은 유지한다. 새 migration이나 주 DB Seed 재적재는 없다.

신규 핵심은 application/sprint7.py·outbox.py, schemas/sprint7.py, api/v1/sprint7.py, workers/events.py, scripts/observe.py·smoke_sprint7.py·verify_sprint7.py, Sprint 7 unit/integration와 tests/e2e다. main·공통 로그·worker event/beat 등록과 tasks·Makefile, 기존 smoke/API 기대값을 연결했다. 정확한 코드 추가/수정 목록은 최종 evidence의 changed_code_files를 따른다. README·DECISIONS·추적표의 현재 범위와 실행 명령을 갱신했다.

코드/검증 결함으로 optional query 계약 표현 불일치, outbox 테스트가 로그인에서 이벤트를 가정한 오류, locator의 원문 201을 200으로 기대한 오류, HTTP fixture의 재사용 변수/archived 코디 복원 가정을 수정했다. archived 코디의 기존 금지 정책은 유지하고 새 추천을 사용했다. 실제 실패 로그는 sprint7-host-dev/focused-dev/live-dev 계열에 남긴다. SQL/스크립트의 Ruff 길이 오류를 의미 보존 분할로 수정했다. 새 의존성이나 시스템 권한 변경으로 우회하지 않는다.

환경 제약인 내부 renderer 네트워크의 외부 npm 감사는 동일 이미지의 임시 기본 네트워크 컨테이너에서 실행하고 서비스 격리는 유지한다. 기존 MinIO의 보안 위험은 미해결이며 loopback·비루트·private bucket을 유지하고 운영 안전성을 승인하지 않는다. 의존성 deprecation 경고는 별도 기록하며 실패/skip을 성공으로 바꾸지 않는다.

## 남은 경계와 품질 검토

at은 날짜 필터이고 홈 전체의 원자적 과거 snapshot이 아니다. 보관·케어 설정/상태는 현재값이다. 제한된 목록의 TRUNCATED와 소스 실패는 숨기지 않는다. outbox가 PUBLISHED여도 소비 receipt를 따로 확인해야 한다. FAILED attempts>=5의 수락 여부 불명확 사례는 원문/receipt·broker 원인을 확인한 뒤 운영자가 동일 event_id 재전송을 결정한다. 외부 전송 목적의 n8n·알림 전달·실장비·UI는 제외한다.

모든 명명된 백엔드 Mock 기능의 구현·검증과 실제 Decart 연동 완료는 다르다. 실제 Decart 어댑터가 미구현이므로 전체 서비스의 실 provider 인수를 선언하지 않는다. 후속 구현에는 확정된 provider API 계약과 자격 증명, 비용 한도가 필요하다. 담당자는 아직 지정하지 않았다. 어댑터 구현 후 실제 요청·결과·실패·비용을 확인하는 유료 검증은 사용자 지시대로 마지막 연동 단계로 남긴다.

품질 검토에서는 구현 규칙의 테스트를 사용자 만족도·실 provider 품질 근거로 확대하지 않도록 확인했다. 재현 명령·JUnit·SQL/S3 관찰을 대조하고, 현재 README·결정·추적표의 상태와 명령을 점검했다. 정책은 구현 기준, 판정은 보고서, 원자료는 test-results를 따르며 과거 보고서는 보존한다. 별도 문서만 읽은 검토자가 지적한 최종 결과 요약, 범위 숫자의 단위, 실행 전제와 남은 연동 조건을 이 문서에 반영했다.
