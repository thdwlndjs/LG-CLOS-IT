# Sprint 1 계약 결정 (2026-10-08)

Understood as: 사용자가 네 충돌의 정책 결정과 원본 계약 변경을 승인했다. Sprint 1의 미구현 기능을 실제 저장소와 DB에서 검증하고 완료하며, Sprint 2 및 프론트엔드는 진행하지 않는다.

1. **역할과 상태**: API는 DB의 OWNER/MEMBER/CHILD 및 AVAILABLE/IN_USE/LAUNDRY/CARE/STORED/UNKNOWN/RETIRED를 사용한다. DEMO는 인증 모드이며 역할이 아니다. CHILD도 자신의 의류를 관리할 수 있지만 공유 의류는 읽기만 가능하다. 관측은 착용 확인이나 wear_event를 생성하지 않는다. WORN은 제거한다.
2. **의류와 위치**: DELETE는 If-Match 기반 soft delete이며 retired_at 및 RETIRED를 기록한다. 등록·수정 location_id는 사용자의 명시적 수동 위치 등록이며 confidence=1, 서버 시각을 기록한다. care_label, location_label, stale(24시간), 공유 대상과 케어 가이드 가용성을 상세에 노출한다. 케어 가이드 자체는 기존 Sprint 5 범위이고 Sprint 1에서는 available=false/url=null로 명확히 표시한다. locator는 FOUND/STALE/UNKNOWN 및 fallback 안내를 반환한다.
3. **동의·보관·공유**: 이미지 동의 기본값 false, 변경 이력은 별도 consent_history. GARMENT 이미지에 한해 PNG/JPEG/WebP, 10MiB 이하, 최대 4096×4096, SHA256 필수 및 실제 디코딩 검증. PUT은 5분 동안 staging 키에만 허용하며 finalize가 검증된 바이트를 별도 최종 키에 저장한다. 읽기 URL 60초, 미완료 업로드 15분, 완성 이미지 30일 보관. 동의 철회는 읽기/신규 업로드를 즉시 차단하고 삭제를 수행한다. 정리 작업은 60초마다 재시도하며 삭제 실패를 숨기지 않는다. 공유는 소유자가 지정한 같은 가구 구성원에게만 읽기 허용, 쓰기/삭제/관측은 소유자만 허용한다. 공유 철회 후 기존 서명 URL은 최장 60초 유효할 수 있다. PERSON_VTON/STYLE/OTHER 업로드는 후속 Sprint 전까지 503이다.
4. **관측 식별**: observation_id와 tag_value를 추가한다. observation_id 생략 시 기존 source/time 기반 UUID를 유지하여 호환한다. garment_id 또는 tag_value 중 하나를 지정하며 태그는 소유자가 의류에 등록한 유일한 값이어야 한다. 알 수 없는 태그는 404이고 상태를 변경하지 않는다. 명시 ID 중복은 같은 내용만 재사용하며 다른 내용은 409. RFID/VISION의 실제 ingress는 503을 유지하고 MOCK/MANUAL만 검증한다.

API 버전 1.1.0으로 계약을 개정한다. 과거 0001 SQL은 원본 바이트와 SHA256로 동결하며 0002 전진 migration이 consent_history, garment_share와 asset 만료 필드를 추가한다. 기존 데이터·Seed는 삭제하거나 자동 동의시키지 않는다. 공개 서비스/운영 안전성은 완료 범위에 포함하지 않는다.

세부 경계: 15분은 upload-intent 생성부터, 30일은 finalize 완료부터 계산한다. 만료 이미지는 정리 완료 전에도 신규 API 응답에서 제외한다. 철회가 즉시 차단하는 것은 API의 신규 이미지 접근/서명 발급 및 업로드이며, 객체 삭제 실패 시 이미 발급된 GET 서명은 최대 60초의 잔여 수명 동안 유효할 수 있다. 삭제 실패는 503, DB 동의=false/asset=DELETED를 유지하고 단일 Celery worker의 beat가 60초마다 재시도한다.

태그 유일성은 기존 DB의 전역 UNIQUE를 유지한다. garment_id/tag_value는 정확히 하나를 입력한다. 중복 내용은 정규화된 요청 전체(UTC observed_at 및 태그로 확인한 garment_id 포함)로 비교한다. 역할이나 관측만으로 실제 착용을 생성하지 않는다.

stale은 last_seen_at이 없거나 현재 서버 UTC보다 24시간을 초과해 과거일 때 표시한다. locator는 위치 null이면 UNKNOWN, 위치가 있고 오래되면 STALE, 그 외 FOUND다. UNKNOWN/STALE의 fallback은 새 위치/관측 등록 안내다. 같은 가구 공유 수신자도 상세의 공유 대상 UUID 목록을 볼 수 있다.

soft delete는 목록·상세·관측·공유 읽기에서 제외하고 복구 API를 제공하지 않는다. 과거 태그 매핑은 보존되며 삭제한 의류의 태그 재사용은 지원하지 않는다. If-Match는 garment.version의 양의 정수 또는 따옴표로 감싼 정수다. 누락/잘못된 형식 422, 현재 버전과 다르면 409, 삭제 후 재요청은 404다. 두 allowlisted UUID에 대해서만 private local/test, demo_mode=true, AUTH_MODE=DEMO와 DEMO_AUTH_ENABLED=true일 때 세션을 발급한다. 기본 JWT TTL은 3600초이며 해당 세션 멱등 key도 같은 수명이다. 만료 key는 삭제하지 않고 409로 거부하므로 새 UUID key를 사용한다.

이 문서는 정책 결정이며 완료 증명이 아니다. 각 FSD의 실제 통과 증적, 실행 시각 및 완료 판정은 SPRINT_1_REPORT.md와 최종 증적 JSON을 따른다.
