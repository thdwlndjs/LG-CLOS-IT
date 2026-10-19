# 조사표/적재 설계 매니페스트

CSV 파일은 **헤더만 있는 사용자 승인 전 템플릿**이다. 빈 파일이 데이터가 누락된 오류를 뜻하지 않는다. Codex가 제품 후보·아이템 계획·공간·에셋·결정·시연 추적을 기록한다.

`candidate_id`, `proposed_item_id`, `asset_id` 등은 후보 식별자다. 실제 DB의 primary key로 확정되지 않았으며 기존 ORM/API를 대조 후 매핑한다. `verified`/`unverified`, `proposed`/`approved` 구분을 일관되게 사용한다. `product_candidates.csv`에 검증 URL 없으면 승인 완료라고 표시할 수 없다.
