# Sprint 5 구현 기준

Understood as: 기존 HIST-001~002와 CARE-001~003을 구현하고 실제 DB/API 및 Sprint 1~4 회귀로 검증한다. 명시적 착용 확인과 케어 수행만 이력을 만들고 세션 종료·카드 저장·예약은 실제 수행으로 간주하지 않는다. Sprint 6~7/화면 프론트엔드는 진행하지 않고 유료 Decart 호출 검증은 모든 Sprint 이후로 유지한다.

- 착용은 본인 Outfit, 선택한 본인 ENDED 세션의 최종 Outfit 및 본인 Context만 참조한다. 사용자 USER만 허용하며 검증된 센서 ingress가 없는 SENSOR_VERIFIED는 503으로 거부한다. 미래 시각은 거부한다. 동일 멱등 key는 재전송하고 다른 key의 동일 세션 확인은 409다. 착용 당시 전체 garment/slot/position을 JSON snapshot으로 고정한다. 취소는 기록을 삭제하지 않고 cancelled_at/version을 저장하며 취소된 세션의 재확인은 새 세션 또는 session 없이 새 명령으로 수행한다.
- history는 WEAR/CARE/OUTFIT_SELECTION을 구분한다. 세션 종료는 SELECTED, 실제 착용은 CONFIRMED/CANCELLED, 케어는 COMPLETED/CANCELLED/NOT_DONE이다. 사용자 시간대 기준 양 끝 날짜 포함, 최대 366일, 기본 오늘 포함 최근 31일이다. timestamp에는 offset이 필요하다. Context는 캡처 시각이 착용 시각보다 미래이면 거부한다.
- 케어 가이드는 입력 라벨 문구를 우선 반환하며 사용자 profile은 USER_PROFILE로 표시한다. 라벨/프로필 제약 충돌 또는 미확인 소재는 REVIEW_REQUIRED로 명시한다. 세탁/건조 방법을 소재 이름만으로 확정하지 않는다. 외부 AI나 세탁 장비 호출은 없다. profile 변경은 소유자·기대 version·멱등 key로 보호한다.
- 케어 일정 관리/완료는 현재 의류 소유자만 가능하고 읽기 공유는 일정 관리 권한이 아니다. type은 WASH/DRY/CLEAN/INSPECT/OTHER다. 동일 의류/type/시각의 활성 일정은 중복을 막는다. 기본 상태는 DB SCHEDULED/COMPLETED/CANCELLED/OVERDUE를 그대로 노출한다. OVERDUE는 조회 시 현재 시간에서 계산하고 저장하지 않는다.
- recurrence는 사용자 시간대의 calendar day interval 1..365일만 지원한다. due의 현지 시각을 유지하고 완료 이후 첫 미래 회차를 생성한다. 존재하지 않는 DST 현지 시각은 다음 유효 시간으로 이동하고 겹치는 시각은 첫 offset을 선택한다. 완료는 SUCCESS/NOT_DONE이며 NOT_DONE은 이력만 남기고 완료/다음 회차를 만들지 않는다. 실제 garment_state 세탁 상태·위치는 자동 변경하지 않는다.
- 완료 취소는 SUCCESS event를 cancelled_at로 보존하고 일정 CANCELLED로 표시한다. 생성된 다음 회차가 미완료이면 함께 취소하고 이미 완료됐다면 409로 거부한다. 다른 key의 중복 완료는 409, 동일 key는 기존 결과다. 수정/취소는 expected_version, 일정/의류 row lock으로 직렬화하며 상태·event·다음 회차·outbox는 원자적으로 저장한다.
- 기존 DTO/DDL의 상태 불일치와 snapshot/취소/반복/수정 표현 부족을 1.5 계약 및 0003 전진 migration으로 최소 보완한다. 1.4의 7개 원본 파일을 보존하며 Seed와 0001/0002 migration은 변경하지 않는다. 기존 wear snapshot은 추정해서 채우지 않고 null/LEGACY_UNAVAILABLE로 표시한다. 테이블/ENUM 수는 32/10을 유지한다.

## 실행 계약의 상세 기준

요청·응답·오류·10개 Sprint 5 operation은 [OpenAPI 1.5](06_OPENAPI.yaml), 물리 필드는 [DDL](07_DATABASE_SCHEMA.sql), 인수 조건은 [FSD](04_FSD.md), 공통 인증·멱등·outbox는 [LLD](05_BACKEND_LLD.md)를 따른다. 직전 7개 파일과 SHA256 연결은 [1.5 manifest](CONTRACT_REVISION_1_5.json) 및 `contracts/1.4/`에 보존한다. 테이블과 ENUM의 기존 이름·값을 유지하며 신규 필드와 부분 유일 인덱스만 추가한다.

멱등성은 member/operation/key 범위로 기존 공통 저장소를 사용한다. 같은 key의 다른 body는 409이며 같은 body는 최초 응답을 반환한다. 현재 상태 조회는 별도 GET을 사용한다. 세션 없는 동일 member/outfit/worn_at 활성 기록도 Outfit 잠금 하에서 다른 key의 중복을 거부한다. 취소된 기록을 정정하려면 취소 후 새 명령을 보낸다. 스냅샷은 확인 당시 전체 구성의 `garment_id`, `slot`, `position`을 기존 Outfit 정렬대로 고정한다. 빈 구성은 거부하며 세션 최종 스냅샷과 현재 Outfit이 다르면 INPUT_CHANGED로 거부한다. LEGACY_UNAVAILABLE은 snapshot=null에서 계산하는 응답 값이다.

history는 worn_at/performed_at/ended_at을 기준으로 내림차순 occurred_at,id로 정렬한다. 일정 목록은 scheduled_at,id 오름차순이다. 한 요청의 count/page는 REPEATABLE READ로 일치시키지만 offset 페이지 사이의 신규 데이터까지 동결하지 않는다. timezone은 조회 요청 값이며 UTC가 기본이다. 반복 일정에는 별도 timezone을 저장한다. 예를 들어 New York의 2026-03-07 02:30 일일 반복은 03-08의 없는 02:30을 03:30으로 정규화하고, 10-31 01:30에서 11-01로 진행할 때 첫 01:30 offset을 선택한다. 반복 기준은 원래 due의 현지 시각이며 사용자가 기록한 completed_at보다 엄격하게 미래인 첫 회차까지 건너뛴다.

NOT_DONE은 version을 증가시키되 일정은 SCHEDULED로 유지한다. 이후 최신 version으로 SUCCESS를 기록할 수 있다. 같은 key의 NOT_DONE은 재사용하고 다른 key는 별도 사용자 미수행 기록이다. 일반 일정 취소는 그 한 회차를 취소한다. 완료 취소는 원래 일정과 연결된 바로 다음 미완료 회차를 취소하며 두 version을 증가시킨다. 다음 회차가 수정됐다면 수정된 회차도 취소하고, 이미 취소됐다면 취소 상태를 유지한다. 다음 회차가 완료됐다면 전체 명령을 409로 거부한다. 다른 날짜로 재예약하거나 완료를 정정하려면 취소 후 새 일정을 만든다.

care_label은 기존 JSONB scalar string/null이며 과거 객체형은 라벨 미확인으로 다룬다. profile은 사용자 instructions와 구조화 constraints를 저장한다. 명시적 세탁·건조 금지 라벨만 boolean 금지로 해석하며 profile의 반대 허용 값은 금지로 덮어쓰고 REVIEW_REQUIRED를 표시한다. 라벨이 없을 때도 REVIEW_REQUIRED다. 소재만으로 온도나 기계 사용을 확정하지 않는다. outbox에는 OutfitWearConfirmed/Cancelled, CareProfileUpdated, CareScheduled, CareScheduleUpdated/Cancelled, CareCompleted/NotDone/CompletionCancelled를 기존 schema_version=1 형식으로 원자적으로 기록한다. 전용 외부 소비자·알림 전송 구현은 이 Sprint에 포함하지 않는다.

손세탁 라벨도 machine_wash_allowed=false로 반영한다. 라벨이 존재하면 사용자 온도·허용 설정을 라벨보다 우선하는 적용값으로 노출하지 않는다. 직접 해석한 금지 제약만 반환하며 라벨과 대조하지 못한 profile 값은 REVIEW_REQUIRED로 표시한다. 프로필 원본은 보존하고 라벨 없는 경우에는 USER_PROFILE 출처로 반환한다. 이 규칙은 전체 국제 케어 기호나 자연어를 해석하는 세탁 전문가 엔진을 의미하지 않는다.
