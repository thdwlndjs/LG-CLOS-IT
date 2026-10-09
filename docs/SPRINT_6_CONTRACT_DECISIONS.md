# Sprint 6 구현 기준

Understood as: 기존 STO-002~004의 설명 가능한 보관 최적화·제안·승인·실제 이동 확인을 구현하고 실제 DB/API/worker 및 Sprint 1~5 회귀로 검증한다. 제안·승인은 물리 이동이 아니며 위치 갱신은 명시적 USER 확인만 수행한다. Sprint 7·화면 프론트엔드는 진행하지 않고 유료 Decart 검증은 모든 Sprint 종료 후로 유지한다.

## 범위와 계약

[FSD](04_FSD.md), [LLD](05_BACKEND_LLD.md), [OpenAPI](06_OPENAPI.yaml), [구현 계획](08_IMPLEMENTATION_PLAN.md)의 기존 5개 보관 operation과 공통 jobs 조회/취소를 사용한다. API 1.6은 물리 item 상태 PENDING/IN_PROGRESS/AWAITING_CONFIRMATION/COMPLETED/FAILED/SKIPPED를 그대로 노출하고 분석 기간·계절·대상·version·근거·비동기 결과를 보완한다. 이전 1.5의 원본 7개를 archive/manifest로 보존한다. 기존 storage_action.reasoning JSONB 배열의 첫 구조화 객체에 immutable 판단 입력과 item 스냅샷을 저장한다. DDL·Seed·기존 migration·HLD·Compose는 변경하지 않는다. 과거 스냅샷 없는 작업은 표시만 가능하고 실행은 거부한다.

## 판단 입력과 제한

household/member는 로그인 주체와 같아야 한다. 가구원 역할과 관계없이 자기 의류만 이동 제안·승인·확인하며 읽기 공유는 관리 권한이 아니다. 기본 대상은 자기 의류 최대 100개, 위치 최대 100개, 용량 집계 의류 최대 10,000개다. 한계 초과는 명시적 거부이며 임의 부분 조회로 실행 가능한 것으로 표시하지 않는다. 계절은 요청 값 SPRING/SUMMER/AUTUMN/WINTER/ALL이며 기본 ALL은 계절 미지정이다. 분석 기간 1..365일, 기본 90일. 확인 시점 이전의 취소되지 않은 착용만 사용하며 frozen composition을 우선하고 legacy 구성은 시간 방어 조건을 만족할 때만 집계한다.

규칙 버전 storage-greedy-v1은 고정·결정적인 greedy allocation이다. WEAR_PATTERN은 해당 계절 또는 최근 2회 이상 착용한 의류를 꺼내기 쉬운 공간, 비계절·낮은 빈도 의류를 archive 공간에 우선한다. 이력이 없으면 부족 근거를 명시하고 계절도 미지정이면 이동을 추정하지 않는다. SPACE_ENVIRONMENT는 사용자 저장 제약에 위배되는 현재 공간에서 제약 충족 공간으로 이동 후보를 찾는다. 최적 해나 정확도를 보장하지 않으며 swap/미확인 이동으로 생길 가용 공간을 미리 사용하지 않는다. 후보는 점수/UUID로 정렬한다.

capacity_units는 이 프로토타입의 추상 점유 단위다. garment.attributes.storage_units는 1..10,000 정수이며 생략 시 한 의류=1단위다. 부피/무게라고 주장하지 않는다. 위치 capacity=null은 미확인, 0은 빈 용량이다. 점유는 다른 소유자·은퇴 의류의 현재 위치도 포함하고 승인되어 아직 확인되지 않은 이동의 입고 예약도 포함한다. location.attributes.enabled는 boolean(default true), accessibility는 ACCESSIBLE/ARCHIVE이며 생략 시 WARDROBE/BOX에 각각 매핑하고 기타 공간은 미확인이다. 현재 위치 없는 의류, UNKNOWN/IN_USE/LAUNDRY/CARE/RETIRED 상태, confidence<0.8, 7일 초과·미래 last_seen은 이동에서 제외한다.

의류 attributes.storage_constraints 또는 care_profile.care_constraints.storage에 allowed_location_types, max_humidity_pct, min_temperature_c, max_temperature_c를 명시할 수 있다. 값이 잘못되면 해당 의류를 보류한다. 소재만으로 제약 온도나 습도를 발명하지 않는다. environment_reading은 현재 시각 이전 최신 값만 사용하며 24시간 초과는 미측정으로 다룬다. SPACE_ENVIRONMENT 또는 환경 제약이 있는 의류는 필요한 최신 측정값 없는 대상 공간을 제외한다. source/측정 시각/Mock 여부를 기록하되 실제 장비 ingress가 연결됐다고 주장하지 않는다.

## 비동기·제안·dry run

STORAGE_OPTIMIZE DB job을 접수하고 실제 Celery의 durable poller가 처리한다. wire kind는 기존 STORAGE_OPTIMIZATION이다. max_attempts=3, 재시도는 2^attempt초이며 validation/권한 오류는 재시도하지 않는다. lease 만료는 TIMED_OUT, 취소는 CANCELLED이고 terminal/lease 재검증 후에만 결과와 제안을 원자적으로 저장한다. 외부 LLM/장비 호출은 없다. 분석 성공은 이동 성공이 아니다. 결과는 FEASIBLE/PARTIAL/NO_CHANGE/NO_FEASIBLE_PLAN과 제안·보류 사유를 구분한다. feasible=true는 제공한 부분 제안의 제약 충족을 의미하며 모든 의류의 최적 배치를 의미하지 않는다. dry_run은 결과만 저장하고 action/위치/예약은 생성하지 않는다. 일반 분석의 제안은 24시간 유효하며 동일 key는 최초 결과, 다른 key는 새로운 분석이다.

## 승인·부분 확인·충돌

멱등 범위는 기존 member/operation/key이며 다른 body의 같은 key는 409다. action expected_version이 일치해야 한다. APPROVE는 PROPOSED를 APPROVED로 바꾸고 item을 AWAITING_CONFIRMATION으로 준비하며 현재 위치는 유지한다. REJECT는 PROPOSED에만 허용한다. CANCEL은 미완료 작업의 남은 item을 SKIPPED로 만들며 이미 확인된 실제 이동을 되돌리지 않는다. IN_PROGRESS는 물리 장비 연동을 위한 예약 상태이고 현재 구현은 장비가 이동 중이라고 표시하지 않는다.

확인은 중복 없는 item subset으로 부분 완료를 지원한다. confirmed=true에는 USER 방법, 실제 observed_location_id=제안 목적지, observed_at offset/미래 금지 및 승인 시각 이후 근거가 필요하다. verified sensor ingress는 없으므로 SENSOR_VERIFIED는 503이다. confirmed=false는 FAILED/failure_reason을 기록하고 위치를 유지한다. 입력·권한·현재 version/source 불일치는 전체 명령을 409로 rollback한다. 용량·환경 hard constraint도 최신 상태에서 재검증하며 위반 시 전체 확인을 거부한다. 완료 item의 재확인은 다른 key에서 409다. 남은 item이 있으면 AWAITING_CONFIRMATION, 모두 성공이면 COMPLETED, 일부 실패로 모두 종료되면 FAILED다. 실제 확인은 garment_state의 location/confidence=1/last_seen과 version 및 garment.version을 갱신하고 MANUAL observation과 outbox를 같은 transaction에 기록한다. 의류 status와 착용 이력은 변경하지 않는다.

household advisory lock을 점유량 변경을 일으키는 기존 의류 생성·변경·관측과 보관 명령에서 공유하여 용량 집계·예약·확인의 경쟁을 직렬화한다. 의류/상태 version과 profile 제약 스냅샷을 확인하므로 승인·계획 이후 바뀐 데이터를 오래된 계획으로 덮어쓰지 않는다. 만료는 조회 시 EXPIRED로 계산하고 예약에서 제외한다. 이미 만료된 작업의 이동은 일반 수동 관측이나 새 제안으로 정정해야 한다. 위치/환경 설정 변경 API·자동 알림·outbox dispatcher·실제 하드웨어/실 Decart는 이 Sprint 범위가 아니다.
