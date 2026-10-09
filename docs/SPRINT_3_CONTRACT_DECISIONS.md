# Sprint 3 구현 기준

Understood as: 기존 구현 계획의 VTON-001~004를 백엔드 API·비동기 worker·provider port로 구현하고 실제 DB/Redis/MinIO 및 TCP HTTP로 검증한다. Sprint 4와 프론트엔드는 구현하지 않는다. Mock과 실제 provider를 구분하며 미지원 Decart 계약을 성공으로 대체하지 않는다.

기존 §7.1/§12에 따라 API 1.3.0으로 필요한 DTO 정보를 보완한다. 원본 1.2 계약 7개를 docs/contracts/1.2에 보존한다. 기존 32개 물리 테이블·0002 migration·Seed는 유지한다.

- 세션은 본인에게 귀속하고 같은 가구 명시적 공유 의류만 참조한다. 진입 outfit을 독립 DRAFT로 복제하고 원본을 수정하지 않는다. 단일 garment 또는 빈 초안으로도 진입 가능하다. source_screen과 source_outfit_id, Context, 선택 인물 자산을 보존한다. PERSON_VTON 업로드는 기존 동의·검증·private 보관 정책을 따르고 asset.kind=PERSON으로 매핑한다.
- 편집은 expected_revision과 session row lock으로 보호한다. revision마다 Outfit/항목을 새로 보존해 과거 job 입력을 고정한다. 구버전·종료 세션 job 결과는 현재 결과로 연결하지 않는다. 같은 revision의 여러 실행은 가장 최근 요청만 current이며 과거 job은 별도 조회 가능하다. 접근/동의 철회·보관 만료 후 이미지 서명은 반환하지 않는다.
- VTON 실행은 ACTIVE 세션의 현재 outfit/revision, 본인 READY PERSON 및 모든 선택 의류의 READY GARMENT 이미지와 사용 동의를 검증한다. 기본 구성은 TOP+BOTTOM 또는 DRESS이며 AVAILABLE을 다시 확인한다. 이미지 없는 의류를 임의 생성하지 않는다. Mock은 합성 안내 이미지이며 인물·의류를 실제 변환한 결과가 아니다. provider_mode와 asset metadata의 is_mock으로 구분한다.
- DB job/vton_job과 입력 asset·item snapshot, outbox 및 멱등 응답은 같은 트랜잭션으로 저장한다. Celery beat의 DB poller가 QUEUED job을 회수하므로 commit과 Redis enqueue를 분산 트랜잭션으로 가정하지 않는다. 공통 outbox dispatcher는 Sprint 7로 남긴다. lease/attempt_count로 중복 실행과 worker 손실을 처리하고, 재시도 가능한 실패는 최대3회/지수 backoff, 정책 오류는 즉시 FAILED, 시간 초과는 TIMED_OUT이다. 취소는 QUEUED/RUNNING만 지원하며 뒤늦은 worker는 결과를 연결하지 않는다.
- 결과 key는 실행 전에 기존 asset 행에 PENDING_UPLOAD로 커밋한다. 실제 업로드·DB commit 간 실패·취소·구버전 실행의 객체는 기존 asset cleanup으로 추적해 정리한다. 성공 결과도 동의·30일 보관 정책을 적용한다. 실패 메시지에 provider 예외 원문·키·URL을 노출하지 않는다.
- 종료는 expected_revision, 선택 outfit(현재와 일치), save_outfit을 검증한다. 선택한 항목을 final_items_snapshot으로 고정하고 ACCEPTED/MODIFIED 피드백·종료 이벤트를 기록한다. save_outfit=false이면 최종 outfit은 DRAFT, true이면 SAVED다. 이미지를 기다리지 않고 종료 가능하며 card_entry_payload에 최종 outfit/Context만 제공한다. wear_event를 생성하지 않는다. 동일 key 재전송은 같은 응답, 다른 key의 다른 종료는409다.
- Decart port는 미지원 계약을 capability failure로 반환한다. 배포 설정 DECART는 기존 구성 오류를 유지하고, MOCK 정책 서버에 DECART 요청은503으로 거부한다. 실제 계정·키·정적 이미지 입출력 검증 없이 임의 live API를 구현하지 않는다. 공식 [Lucy 2.1 VTON 문서](https://docs.platform.decart.ai/api-reference/lucy-21-vton)는 영상 편집 입력을 설명하고, [현재 모델 안내](https://platform.decart.ai/models/lucy-vton)는 영상 스트림을 입력으로 제시한다. 이것만으로 현재 정적 인물+복수 의류 PNG 계약과 계정 지원을 확정할 수 없다.

세션/Job 출력에 provider_mode, vton_available, unavailable_reasons, items, current_result_job_id, revision/is_current/stale 및 card_entry_payload를 추가한다. 구성 유효성과 provider 성공은 별개다. Job의 기존 후속 kind enum은 보존하며 이번 구현은 VTON만 노출한다. API 7개를 추가하고 업무 operation은30개다.

정확한 요청·응답·오류와 경로는 [OpenAPI](06_OPENAPI.yaml)의 VtonSessionCreate/VtonSession/VtonModifyRequest/VtonEndRequest/VtonJobRequest/AcceptedJob/Job 및 /api/v1/vton-sessions, /vton-sessions/{id}, /vton-sessions/{id}/outfit, /vton-sessions/{id}/end, /vton-jobs, /jobs/{id}, /jobs/{id}/cancel을 따른다. 작업 규칙 §7.1/§12는 [구현 계획](08_IMPLEMENTATION_PLAN.md), FSD ID는 [FSD](04_FSD.md)의 VTON-001~004, 완료 증적은 [보고서](SPRINT_3_REPORT.md)에 연결한다.

종료는 현재 session.outfit_id만 선택하며 종료 요청 안에서 항목을 수정하지 않는다. 최종 garment/slot/position 집합을 세션 진입 시 독립 초안과 비교해 같으면 ACCEPTED, 다르면 MODIFIED다. 편집 후 원래 구성으로 되돌린 경우도 ACCEPTED다. 최신 job은 세션 row lock 안에서 실제 삽입 시각 clock_timestamp()을 저장한 job.created_at DESC/id DESC 순서다. 최신 요청이 실패·취소돼도 이전 성공을 자동 복원하지 않는다. Job.is_current는 ACTIVE 세션의 현재 revision·최신 요청 여부이며, current_result_job_id는 그 job이 SUCCEEDED이고 입력/결과 이미지 접근이 유효할 때만 반환한다.

최대3회는 최초 실행을 포함한다. 재시도 중 status=QUEUED이며 next_attempt_at은 2^attempt_count초 후다. lease는 실행 시작에서 decart_timeout_seconds(기본90초)+30초이며 갱신하지 않는다. 실제 실행은90초 timeout으로 먼저 제한하고 worker 손실의 만료 lease는 다음 poll에서TIMED_OUT으로 처리한다. poll 간격2초, 전체 동시 실행 제한은 decart_max_concurrency(기본2)다. 내부 취소는 상태를 즉시CANCELLED로 만들고 뒤늦은 결과 연결을 거부한다. 이미 시작된 provider 호출은 반환/timeout까지 진행할 수 있으며 미검증 외부 provider의 즉시 중단을 보증하지 않는다.

AVAILABLE은 DB garment_state의 의류 상태다. 기본 TOP+BOTTOM 또는 DRESS에 OUTER/SHOES/ACCESSORY를 총6개 이하로 추가할 수 있다. vton_available은 ACTIVE·기본 구성·현재 의류 접근/AVAILABLE·본인 PERSON 및 각 의류의 동의된 READY 이미지 충족을 뜻한다. unavailable_reasons는 SESSION_NOT_ACTIVE, OUTFIT_NOT_READY, PERSON_IMAGE_REQUIRED 또는 입력 자산 검증의 안전한 오류 code다. 이미지 동의 철회는 기존 정책대로 객체 삭제와 신규 서명 차단을 수행하고 진행 중 worker도 성공 커밋 전에 재검증한다. 공유 철회는 입력 접근을 차단하며 원 소유자의 재사용 이미지 자체를 삭제하지 않는다. 결과 보관30일은 READY 성공 시각부터이며 cleanup beat는60초 주기다. 업로드 후 실패·취소 객체는 DELETED로 표시해 정리하고, worker 손실의 PENDING_UPLOAD는15분 만료로 추적한다. 정상적인 구버전 성공 결과는 과거 job 조회용으로30일 보존한다.

멱등 key는 member_id/operation/key별24시간이다. 같은 key의 다른 본문 또는 만료 key는409이며, 같은 본문 재전송은 저장된 응답을 반환한다. 이미지 URL은60초이므로 과거 멱등 응답이 새 서명을 만들지 않는다. 새 GET으로 서명을 갱신한다. POST 세션/Job/종료/취소는 key를 요구하고, 편집은 expected_revision 충돌로 중복 변경을 막는다.
