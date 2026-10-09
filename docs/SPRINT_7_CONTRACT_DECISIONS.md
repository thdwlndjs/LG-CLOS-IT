# Sprint 7 구현 기준

Understood as: 기존 COM-002와 Platform 범위인 홈 데이터 공급, durable outbox 전송·중복 소비·관측성을 구현하고 FSD 원문 E2E-01~09를 명시된 Mock 모드로 재현한다. 화면 프론트엔드·실제 하드웨어·선택적 n8n은 구현하지 않는다. Decart 유료 검증은 모든 Sprint 구현 뒤의 별도 최종 연동 검증이며 미구현 실제 어댑터를 완료로 표시하지 않는다.

## 홈과 계약

기존 GET /api/v1/home을 구현한다. member_id는 로그인 주체와 같아야 한다. 원문 FSD의 기준 일시·timezone 입력을 at(명시적 offset, 미래 금지)/timezone(IANA, 기본 사용자 설정)으로 보완한다. API 1.7은 HomeDashboard에 timezone·at·source_status를 추가한다. 조회는 Context/추천/알림을 생성하거나 읽음 처리하지 않으며 read API 밖의 알림 읽음 명령을 발명하지 않는다.

현재 사용자 당일 Context의 기준 시각 이전 최신 값을 사용하고 없으면 7일 이내 캐시를 명시적으로 표시한다. 없는 값은 null/빈 배열·EMPTY/partial이며 Mock 출처는 기존 Context DTO로 유지한다. 오늘 생성된 해당 Context의 최신 OutfitRecommended 이벤트 후보를 현재 코디 version/권한/가용성과 대조해 최대 5개 반환한다. 임의 추천 생성·다른 사용자의 후보·수정/보관/사용 불가 후보를 반환하지 않는다. 케어 알림은 소유자의 활성 의류에 대해 오늘까지의 미완료 일정(연체 우선), 보관 알림은 본인이 요청한 미완료·미만료 제안이다. 각각 최대 20개, 초과는 TRUNCATED/partial이다.

Context 선택 후 추천·케어·보관을 병렬 집계하며 소스별 3초 timeout과 안전한 UNAVAILABLE 상태로 부분 실패를 격리한다. 사용자 인가/사용자 조회 실패는 전체 오류다. 과거 at은 날짜 필터 기준이며 현재 mutable 상태를 과거로 복원한다고 주장하지 않는다. 집계 항목은 별도 읽기 transaction이며 전체 시점의 원자적 snapshot을 보장하지 않는다. updated_at은 집계 완료 시각이다.

## Outbox

기존 domain_event_outbox의 PENDING/PUBLISHED/FAILED ENUM과 audit_log를 사용하며 DDL/migration을 추가하지 않는다. event_id·type·aggregate·household·occurred_at·schema_version·correlation_id·payload envelope를 실제 Celery/Redis 큐에 전송한다. 저장된 version이 없으면 aggregate_version=null이며 만들어 내지 않는다. status=PUBLISHED는 broker 전송 수락이고 소비 성공은 별도 audit receipt다.

dispatcher는 최대 10개를 FOR UPDATE SKIP LOCKED로 claim하고 attempts 증가·60초 next_attempt_at으로 예약한 뒤 commit한다. publish는 transaction 밖에서 최대 5초, 실패는 FAILED와 안전한 오류·2^attempt초 backoff다. 최대 5회 이후 FAILED를 보존하고 자동 재시도를 중단한다. crash 후 claim 만료로 다시 전송할 수 있다. 마지막 시도에서 수락 여부가 불명확한 경우에도 FAILED/DELIVERY_UNCONFIRMED로 보존한다. 운영자가 원인 확인 후 재전송 여부를 결정해야 하며 자동 성공으로 처리하지 않는다.

consumer는 DB 원문과 envelope를 대조하고 event_id에서 생성한 deterministic audit_log PK로 영구 중복을 막는다. receipt는 domain 상태를 재적용하지 않는다. 작업 요청 이벤트는 기존 durable job poller를 깨우고, 중복·consumer crash의 잔여 작업은 2초 beat가 회수한다. 다른 이벤트는 조회 가능한 audit receipt만 남기며 외부 알림이 전달됐다고 주장하지 않는다. 기존 도메인 처리의 멱등성과 상태/version 방어를 유지한다. 전송 장애는 이미 commit한 HTTP 명령을 취소하지 않는다.

## 관측성·검증

요청/작업/전송의 식별자·duration·attempts·outcome·provider_mode와 DB 기반 job 실패/latency, outbox backlog/소비 receipt, stale 의류·추천 후보 없음 집계를 내부 관측 스크립트로 제공한다. 비밀·사진·payload·서명 URL·원문 예외는 로그/메트릭에 출력하지 않는다. 외부 공개 metrics endpoint는 추가하지 않는다. n8n은 기존 false를 유지한다.

원본 E2E-01 오늘의 코디, 02 추천→Mock VTON→카드 저장/재사용, 03 수동 코디 초기 바인딩, 04 별도 착용 확인/history, 05 위치 unknown/신뢰도, 06 승인/실제 확인, 07 케어/history, 08 스타일 출처/코디 진입, 09 외부 실패·재시도·Mock 출처를 실제 UUID DB/API/worker/storage로 검증한다. 주 DB와 Seed는 초기화하지 않는다. API 52개와 FSD 28개를 전체 대조하고 최종 실패·skip이 있으면 완료로 판정하지 않는다.
