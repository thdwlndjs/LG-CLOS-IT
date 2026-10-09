# Sprint 2 구현 기준

Understood as: 기존 설계의 REC-001/002, OUTFIT-001/002, STYLE-001을 구현하고 실제 DB·스토리지 및 HTTP로 검증한다. 구현 계획 §7.1/§12에 따라 필요한 최소 계약 보완을 함께 기록한다. Sprint 3·프론트엔드는 구현하지 않는다.

- Context: Seed에 없는 일정 starts_at은 생성하지 않는다. 유효하지 않은 일정은 응답에서 제외하고 missing_fields로 표시한다. source_status와 missing_fields를 Context DTO에 보완한다. is_holiday는 미확인 시 null이다. MOCK 수집은 고정된 합성 날씨와 빈 합성 일정이며 source_mode=MOCK와 출처를 명시한다. AUTO는 서버 provider 정책을 따르며 미구성 live는 PARTIAL/누락으로 반환한다. 새 snapshot은 immutable이며 사용자의 timezone/UTC 요청 시각을 검증한다. 출처 메타데이터는 기존 weather JSONB의 예약 키 _provenance에 저장한다.
- 추천: AVAILABLE 및 본인/명시적 읽기 공유 의류만 후보로 삼는다. special_care는 관리 위험으로 제외하고 LAUNDRY/CARE/STORED/UNKNOWN/IN_USE/RETIRED는 사용 가능으로 추정하지 않는다. 제한/테마는 문서화된 whitelist만 허용한다. TOP+BOTTOM 또는 DRESS가 기본 구성, SHOES/OUTER/ACCESSORY는 선택 구성이다. 고정 규칙 버전과 안정된 UUID 순서로 조합·점수·다양성 Top-K를 계산한다. 과거 확정 피드백 및 요청 시각 이전 착용만 사용한다. 이력 없음은 규칙 기반 fallback이며 없는 계절/일정 근거를 만들지 않는다.
- 추천 기록/세션 연결: 기존 domain_event_outbox의 recommendation aggregate UUID를 추천 기록으로 사용하고 전체 응답·context_snapshot_id·고정 규칙 버전을 저장한다. 후보는 실제 DRAFT outfit/item으로 저장하며 응답 outfit_id/context_snapshot_id로 후속 VTON 세션에 연결할 수 있다. Sprint 3 OUTFIT_SESSION API는 만들지 않는다. 추천 기록과 후보·멱등 응답은 한 트랜잭션이며 wear_event는 생성하지 않는다.
- 코디: 기존 PATCH 경로로 ARCHIVED를 입력할 수 있도록 OutfitUpsert enum을 보완한다. 기본 접근은 본인 코디만, 참조 의류는 본인/같은 가구 명시적 공유만 허용한다. DRAFT는 불완전 구성을 허용하고 SAVED는 기본 구성을 요구한다. slot/position 조합과 garment_id는 중복 금지, category/slot 일치, DRESS와 TOP/BOTTOM 혼용 금지. missing_garment_ids/try_on_ready를 응답에 추가해 삭제·공유 철회된 구성 누락을 알린다. 수정은 If-Match, ARCHIVED는 읽기만 가능하고 편집·재활성은 지원하지 않는다.
- 스타일: 사용자 제공 http/https 링크는 등록만 하고 다운로드/크롤링하지 않는다. 자격 증명 포함 URL은 거부한다. STYLE 업로드를 현재 명시적 이미지 동의·검증·보관 정책으로 활성화하고 서버 asset.kind=STYLE로 구분한다. 의류로 변환하지 않는다. 등록/조회/출처별 필터/삭제는 본인 범위이며 다른 사용자 asset 참조를 차단한다.

정책 값: 추천 limit=1..20(기본5), 최대 후보 pool=200, 최근 반복 7일 감점, 규칙 버전 sprint2-rules-v1. constraints는 excluded_garment_ids(UUID 배열), season(SPRING/SUMMER/AUTUMN/WINTER/ALL), max_items(2..6)만 지원하고 theme은 CASUAL/WORK/FORMAL/SPORT 또는 null이다. 세부 점수는 domain/recommendations.py의 순수 정책과 독립 fixture 기대값으로 검증한다. OpenAPI 개정은 1.2.0이며 원본 1.1 해시/보고서는 역사 증적으로 보존한다. 새 물리 테이블은 만들지 않는다.

점수는 기본 50, 명시적 계절 적합 비율 ×10, 확인된 기온에 적합한 구성 +10, 명시적 테마 적합 비율 ×10, 과거 ACCEPTED/REJECTED 및 4점 이상 RATED 피드백 항목별 ±2(합계 ±10 제한), 최근 7일 확정 착용 항목별 -5(최대 -20)이다. MODIFIED는 확정 선호로 추정하지 않는다. 테마가 없으면 Snapshot의 현지 날짜와 일치하는 시각이 명시된 일정 중 첫 CASUAL/WORK/FORMAL/SPORT 유형만 사용한다. 일정 본문과 만남 대상은 추정하거나 수집하지 않는다. 다양성 선택은 이미 선택한 구성과 최대 중복 비율 ×10을 순위 점수에서 차감하며, 응답 score는 원 점수이고 이유에 규칙 버전을 남긴다.

읽기 가능한 AVAILABLE 의류를 created_at/id 순서로 최대 200개 조회하고 조합을 UUID 순서로 최대 200개 평가한다. SHOES가 있으면 각 신발별 구성을, OUTER는 기온 15℃ 미만일 때 선택 구성으로, ACCESSORY는 하나까지 선택 구성으로 생성한다. 기본 구성이 없으면 빈 결과를 반환하고 제한을 몰래 완화하지 않는다. pool 제한·후보 부족·불완전 Context·개인화 이력 부재는 fallback_used로 표시한다. 후보별 커밋 직전 가용성과 권한을 다시 검증한다.

과거 이력은 Context captured_at 이전에 실제로 확정된 본인 착용/피드백만 사용한다. 이력 시각 후 수정된 outfit의 현재 항목으로 과거 구성을 재구성하지 않고 해당 이력을 제외한다. 정확한 과거 구성은 Sprint 3/5의 확정 Snapshot에서 다룬다. 이력 자체를 수정하거나 삭제하지 않는다. ARCHIVED 전환은 기존 garment/slot/position 집합을 보존하며 요청 항목 순서 차이는 허용한다. try_on_ready는 기본 구성·현재 접근 권한·AVAILABLE·미보관 상태를 나타내는 구성 유효성이고 VTON provider 성공이나 이미지 준비를 보증하지 않는다.

StyleReference.image는 동의·READY·보관 기한을 확인한 Asset 또는 null이다. 실제 private 객체의 60초 GET 서명을 썸네일용 원본 이미지로 제공하며 별도 파생 썸네일을 생성하지 않는다. 새 목록 GET으로 서명을 갱신한다. 같은 멱등 key의 재전송은 과거 응답을 보존해 URL을 갱신하지 않는다. 스타일 삭제는 참조 행만 삭제하고 재사용 가능한 asset의 물리 삭제는 기존 동의 철회/보관 만료 정책에 따른다.
