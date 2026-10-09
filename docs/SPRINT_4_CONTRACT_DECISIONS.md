# Sprint 4 구현 기준

Understood as: 기존 CARD-001~003의 카드 구성, React/Playwright 렌더링, 비공개 저장·명시적 공유·코디 재사용을 구현하고 실제 DB/S3/Chromium/HTTP/worker로 검증한다. 화면 프론트엔드와 Sprint 5 이후 기능은 구현하지 않는다. 유료 Decart 실제 호출 검증은 모든 Sprint 종료 후 별도로 수행한다.

- 템플릿은 `minimal-v1`로 고정한다. 이미지 없는 의류는 슬롯 이름 placeholder로 표시하며 실제 의류 이미지로 가장하지 않는다. 존재하는 이미지의 권한·동의·보관 기간 오류는 placeholder로 우회하지 않는다.
- 카드 payload는 생성 시 의류/이미지 ID와 제목·태그를 고정한다. Context는 사용자 명시 요청에만 날짜·날씨를 포함하고 일정·위치·인물 사진은 포함하지 않는다. Context가 없으면 문구를 생략한다.
- 렌더 크기는 1080×1350, PNG 기본/WebP 선택이다. DB의 RENDERING 상태는 최신 job에 따라 QUEUED/RUNNING으로 표시하고 is_saved는 SAVED로 표시한다. 동시 렌더는 409, 실패 후 새 key로 재요청할 수 있다. worker는 최대 3회 총 시도와 지수 backoff, lease 회수, 출력 asset 사전 등록 및 정리를 적용한다.
- 저장 요청 SHAREABLE에만 24시간 bearer 공유 토큰을 발급하고 SHA256만 DB에 저장한다. 재발급은 이전 토큰을 폐기한다. PRIVATE는 공유를 폐기한다. 공유 GET은 토큰·만료·현재 입력 권한/동의·결과 자산을 확인하고 이미지 바이트만 반환한다. 공유 URL은 민감정보이므로 로그에 기록하지 않는다. 카드 이미지 자체에 명시된 날짜/날씨가 포함될 수 있음을 공유 응답에 표시한다.
- 재사용은 연결 Outfit ID를 반환한다. 저장은 wear_event를 생성하지 않는다. 이미지 수정 없는 저장 title은 개인 목록 제목이며 이미지 payload는 변경하지 않는다.
- 재생성에도 카드 payload는 고정된다. 다른 구성/Context는 새 draft를 준비한다. 공유는 카드 전체 이미지에 포함된 제목/태그/의류 이미지와 명시 요청한 날짜/날씨를 함께 공개한다. 필드별 공개 선택은 지원하지 않는다. 카드 취소는 QUEUED/RUNNING만 가능하고 늦은 결과는 연결하지 않는다.
- 기존 DTO에는 DRESS/OUTER/ACCESSORY 참조, 버전·placeholder·saved/share/reuse 응답이 없고 Job은 VTON session을 필수로 요구한다. 원본 1.3 계약을 보존한 후 1.4로 보완한다. 기존 32 테이블/DDL/Seed는 유지한다.

저장 여부 `is_saved`는 렌더 상태와 독립적이다. READY일 때만 SAVED로 표시하고 재렌더링 중에는 QUEUED/RUNNING을 반환한다. 공유 공개 필드는 저장 POST의 JSON `shared_fields`에 표시하며 공유 GET 자체는 이미지 바이트만 반환한다. 이미지 asset은 기존 불변 최종 키 및 SHA256 정책을 따른다. 철회·삭제·만료 입력은 기존 공유 GET도 404로 차단하고 이미 발급한 S3 URL은 최대 60초 유효할 수 있다. 소유자 동의 철회는 자신의 결과 asset도 삭제한다. 다른 소유자 의류의 공유 철회는 출력 객체를 즉시 삭제하지 않지만 신규 접근은 차단한다.

각 SHAREABLE 저장은 새 토큰을 발급한다. 동일 Idempotency-Key 재전송은 이전 응답을 그대로 반환하며 토큰/서명 만료를 갱신하지 않는다. PRIVATE 또는 새 렌더 요청은 토큰을 폐기한다. retry backoff는 2^attempt_count초이며 최대 3회는 최초 실행을 포함한다. lease는 실행 시작부터 렌더 timeout(기본 30초)+30초이고 갱신하지 않는다. lease 만료는 TIMED_OUT/카드 FAILED, 취소는 CANCELLED/카드 FAILED이며 새 key로 재요청 가능하다. 완료 commit에는 RUNNING 상태와 동일 lease 소유자가 필요하다. DDL 변경이나 추가 migration은 없다. 카드 Job의 session_id/outfit_revision/provider_mode는 null, card_id는 실제 UUID다.
