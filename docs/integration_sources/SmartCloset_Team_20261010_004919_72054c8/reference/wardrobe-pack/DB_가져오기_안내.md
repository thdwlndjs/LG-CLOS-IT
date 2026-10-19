# 기존 앱 DB로 가져오기

기준: 2026-10-08 백엔드 통합 구축 작업지시문 v4와 통합설계서 5장. 이 자료의 도메인 명칭에 맞춰 데이터를 준비했습니다. 실제 저장소의 DDL·필드 타입·enum·migration을 열람하거나 적용한 것은 아닙니다.

## 포함한 데이터

| 패키지 파일 | 수 | 대응 도메인 | 핵심 연결 |
| --- | ---: | --- | --- |
| assets.json | 52 | assets | id, image_ref, byte_size, sha256, provenance |
| garments.json | 48 | garments | id, asset_id, name, category, attributes_json |
| outfits.json | 3 | outfits | id, snapshot_json |
| outfit_items.json | 9 | outfit_items | outfit_id, slot, garment_id |
| saved_results.json | 3 | 준비 결과용 어댑터 | outfit_id, person_ref, result_asset_id, outfit_signature |

`db/schema.sql`의 `pack_*` 테이블은 이 패키지의 오프라인 검사용 스키마입니다. 앱 운영 테이블을 바꾸는 migration이 아닙니다. 실제 스키마에 맞는 adapter에서 필드를 옮깁니다.

## 가져오기 순서

1. `tools/import_pack.py --validate-only`로 파일 존재, SHA-256, 품목 및 코디 참조를 확인합니다.
2. 서버에서 실제 인증된 대상 프로필을 정합니다. 모든 행의 `owner_id`는 현재 null이며, 가져오기 시 서버가 같은 허용 프로필에 연결합니다. 클라이언트가 보낸 owner_id를 그대로 신뢰하지 않습니다.
3. 실제 ID 타입을 확인합니다. T01 등은 기존 제작 때부터 사용한 패키지의 고정 ID입니다. UUID를 쓰는 앱이면 `(pack_id, package_id) → app_id` 매핑을 저장하고 재실행 시 재사용합니다. 같은 방식으로 asset/outfit/result ID를 매핑합니다.
4. `assets`의 `image_ref`가 가리키는 PNG를 확인된 비공개 이미지 저장소에 올립니다. 업로드가 성공한 객체 경로를 `storage_key`로 저장합니다. image_ref는 압축 안의 상대 경로이며 공개 URL이나 업로드 완료 경로가 아닙니다. 만료되는 서명 URL을 영구 ID로 저장하지 않습니다.
5. 의류 행을 넣으면서 asset_id를 실제 자산 ID에 연결합니다. attributes_json을 보존하고, 확인되지 않은 location_json은 null로 유지합니다. created_at/updated_at은 실제 가져오기 시각을 서버에서 설정합니다.
6. 코디·코디 구성·준비 결과를 연결합니다. snapshot_json 안의 garment_id와 asset_id도 매핑해야 합니다. 같은 `(outfit_id, slot)`은 하나만 넣고 garment_id와 external_item_id는 둘 중 하나만 사용합니다. 이 팩은 전부 내부 의류이므로 external_item_id는 null입니다.
7. 앱에서 JSON 직렬화 방식이나 ID가 바뀌면 outfit_signature를 새 규칙으로 일관되게 재계산합니다. 이 팩의 서명은 패키지 snapshot items 배열을 JSON 키 정렬·공백 제거·UTF-8로 직렬화한 SHA-256입니다. Python의 `ensure_ascii=False, sort_keys=True, separators=(',', ':')`를 사용했습니다. 서명만 믿지 말고 인물·품목·버전·이미지 해시의 실제 일치를 검사합니다.
8. 등록 수·개별 이미지·세 코디를 재조회합니다. 가져오기 재실행으로 중복 의류가 생기지 않는지 검사합니다. 실제 DB의 트랜잭션·권한·RLS·업로드 실패 복구는 앱에서 별도 검증합니다.

## 빈 값과 부가 필드

- `storage_key`, `owner_id`, `created_at`, `updated_at`: 아직 앱에 가져오지 않아 null입니다.
- `location_json`, `location_ref`: 실제 위치를 알지 못하므로 null입니다. 임의의 옷장 칸을 확정 위치로 채우지 않습니다.
- `material_composition`, `size`, `brand`, `care_instructions`: 실제 상품 근거가 없어 null입니다. 시연 검색 태그와 케어 사실을 구분합니다.
- `asset_version`: 패키지 자산 버전입니다. S06만 수정본 v2이며 나머지는 v1입니다.
- `created_by_job_id`: 이 앱에서 실행한 AI 작업이 없으므로 null입니다.
- `image_ref`, 크기·투명도·role 등의 부가 필드: 가져오기·검사용 정보입니다. 대상 assets 테이블에 해당 열이 없으면 import manifest나 metadata에 보관합니다.
- `provenance`: 이 팩의 JSON 객체 형태는 패키지 규약입니다. 실제 DB 열 타입에 맞게 저장합니다.
- CSV의 배열·객체는 JSON 문자열이고 빈 셀은 null입니다. JSON이 타입을 보존하는 우선 원본입니다.

## 준비 착장 연결 규칙

`DEMO_PERSON01`은 생성된 예시 인물이며 실제 사용자 계정이 아닙니다. LOOK01 이미지를 외형 기준으로 LOOK02, LOOK03을 편집 생성했습니다. LOOK01은 독립 생성된 최초 예시라 generation_input_asset_id가 null입니다.

화면 표시 모드는 `saved_result`, 미디어 종류는 `static_image`입니다. 선택한 인물과 전체 코디 구성, 품목 자산 버전이 준비 결과와 다르면 `준비된 결과 없음`을 표시해야 합니다. 생성 이미지의 옷 외형을 시각 대조했으나 봉제선·직물·주름을 픽셀 단위로 복제한 결과는 아닙니다.

등록 사진 REGISTER01도 생성 예시입니다. 실제 사용자의 업로드나 OCR·분석 성공 결과로 기록하지 않습니다. 정상적인 저장 동작 없이 작업 영수증·AI 실행·착용·케어·이동 이벤트를 만들지 않습니다.
