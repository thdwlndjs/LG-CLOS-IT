# DB_MAPPING_AND_SEED_PLAN

검사일: 2026-10-11 (KST)  
검사 저장소/브랜치: LG-CLOS-IT / main / c17e5e6  
실행 범위: P0 저장소 읽기, P1 공식 제품 조사, P2 설계·CSV 작성만  
신뢰 수준: verified=파일/공식 페이지 확인, proposed=미승인 설계, blocked=근거·권한 부족  
미확인 사항: 실행 DB 현황, 배포 상태, 실기기, 유료 VTON, 신규 화면 E2E, 이미지 재사용 허가.  
DB 연결·적재·마이그레이션·제품 코드/운영 에셋 수정·원격 push·배포 없음.

## 논리 모델→실제 스키마

| 논리 개념 | 현행 근거 | 최소 매핑(proposed) |
|---|---|---|
| family/member | DDL:22,26 | household/member 유지. 기존 고객 가구와 별도 demo namespace |
| physical wardrobe/access | 0004_device_integration.py:13,18 | device/device_member 유지; 다른 장소 access_station은 동일 owner 데이터에 접근할 수 있어도 원격 집 LED 금지 |
| space/compartment/shelf/slot | DDL:40 storage_location | parent_location_id/location_type/attributes 계층. A–G는 구획 후보, 좌표·capacity 실제 측정 전 NULL |
| product reference | DDL:56 garment.attributes | 독립 정규화 테이블 없음. 초기는 attributes.product_reference 스냅샷+논리candidate ID+증거URL/검사일/확신. 다수 보유 공유·변경추적 필요 시 새 테이블 승인 후 설계 |
| owned item | DDL:56 garment, migration0004:33 | owner_id/device_id 유지. category/color 필수; brand/size를 신규 필수로 만들지 않음. attributes.is_demo 및 seed namespace/instance ID 제안 |
| current position | DDL:72 garment_state | 현재 location_id 하나. 초기 위치는 합성 시연 위치라고 표시, 실제 관측인 것처럼 last_seen_at/confidence=1 채우지 않음 |
| observation/history | DDL:78,90,137 | 실제 이력은 garment_observation/environment_reading/wear_event. 합성 데이터를 넣으려면 MOCK raw payload·고정시각·is_demo 근거 및 승인 필요; 첫 적재는 이력 없음 권장 |
| asset & derivatives | DDL:48 metadata/kind/asset_key | 저장 key+checksum+source/derivation/asset_version metadata; 임시 Signed URL 영속 저장 금지. 단일 대표 GARMENT 및 추가 종류 OTHER의 적합성 승인 |
| outfit/cards | DDL:104,110,200 | outfit_item이 보유 garment 참조. card template_version 및 별도 layout provenance는 기존 metadata 수용 여부 추가 대조 후 최소 migration |
| movement | DDL:165,175 / sprint6.py:437 | storage_action/item 유지. 승인 예약 충돌 수정 후 완료한 품목만 atomic location update |
| LED | 0004:80,85 | lighting_zone/led_command 보존; Mock 상태/만료 기록으로 증거 |

**현재 스키마를 바꾸지 않았다.** 실제 SQL은 UUID FK와 household composite FK를 사용한다. 논리 후보 ID는 UUID가 아니므로 승인 후 namespace+instance ID로 결정적 UUID 매핑을 생성한다. 같은 모델/색을 가진 별개의 구매를 중복으로 지우지 않으며, 시연 재실행은 namespace+instance만 중복 키로 본다. brand/name/SKU만으로 dedup하지 않는다.

## migration 예상 영향

JSONB 중심 1차 적재는 제품 필수 column 추가 없이 가능하지만 provenance/파생 참조 검증·조회 성능 제약이 약하다. 정규화 product_reference/asset_derivation/seed_batch는 필요성이 승인될 때만 구체 DDL 작성한다. 실제 존재하지 않는 migration 번호나 실행 endpoint를 미리 확정하지 않는다. ORM은 부분 모델이므로 Base.metadata.create_all/autogenerate 금지(models.py:40). 현 DDL에는 0004 device 확장 전체가 없으므로 DDL 한 파일만 실행해 실제 DB 완성이라고 주장하지 않는다.

## 승인 후 적재 순서 및 원자성

1. 별도 로컬 test DB URL/household/device를 명시 확인; 운영·클라우드 URL이면 fail closed. 기존 DB migration head와 table/column catalog를 read-only 확인, 백업/row count/checksum 기록.
2. 승인 manifest 고정: 제품 facts와 is_demo owned instance를 분리. 미검증 PC12/13·권한 없는 이미지·미측정 실제 위치 제외. 엄마/아들·수량·슬롯 맵 사전 승인.
3. 먼저 dry-run: FK 순서/대표 이미지 READY/검증 상태/필수 category,color/권한/공간/중복 slot 검사, 생성·갱신·제외 명세 산출. 상품 원본 근거가 없으면 실패.
4. 객체 업로드는 별도 준비 영역의 신규 key, checksum 확인. DB 트랜잭션은 household→member→device/member→locations→assets→garments→garment_state→승인된 선택 이력→outfits 순서. recommendation/LED/카드는 사용자 동작으로 생성; seed만으로 실제 입기나 이동 기록 자동 생성 금지.
5. 재실행: 같은 batch logical ID의 diff=0. 새 checksum은 새 asset ID, 기존 READY 객체 덮어쓰기 금지. 원본 변경/다른 승인버전이면 충돌로 명시.
6. 검증: 승인 수=삽입 수, owner/device/FK/중복/asset hash·권한, same-device visibility 및 cross-household denial, 조회 API와 렌더 count 매칭. 실패 시 트랜잭션 rollback; 성공 전 완료 판정 금지.

## rollback

seed manifest에 created UUID/key 목록, before/after 값, batch hash 기록. 순서 역방향으로 해당 batch의 신규 행만 삭제; 이후 사용자 event/참조 생긴 행은 삭제 중단·수동 검토. 공유 원본/기존 고객 객체 삭제 금지. 객체 준비 단계 실패는 해당 새 key만 청소; DB rollback 후 orphan 확인. UPDATE를 포함하면 before-image 복원 및 optimistic version 검사. DB snapshot 복구는 격리된 로컬 test DB에만. 운영 DB rollback 실행 계획은 본 승인 범위 밖.

이번 단계: 스키마 파일만 대조, DB catalog·row count·migration 적용·적재·rollback 실행 모두 미검증. scripts/import_owned_garments.py 및 기존 seed.py는 재사용 검토 대상이며 그대로 실행하지 않았다.
