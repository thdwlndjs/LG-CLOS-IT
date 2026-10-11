# CHG-00 — 실제 제품 기반 데이터 계약

> **PoC A1 적용(2026-10-11):** [최신 기준 계약](../POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.

## 1. 제품 조사/DB 적재 필수 원칙 (`RULE-01`)

- **확정 등록 전 실재 제품 검증**: 브랜드·공식명·모델/품번(있으면)·제품 출처 URL·확인일·상품 이미지 출처 URL·출처 유형·검증 수준을 저장.
- 브랜드 공식/제조사 페이지 우선. 실제 판매되던 단종 제품도 객관적 근거가 있으면 후보 가능.
- `unknown`은 `unknown`: 소재·혼용률·실측·색상·세탁 방법 미확인 시 추정값을 사실 필드에 기입하지 않음.
- 관찰된 스펙(`verified_fact`)과 파생 판단(`inference`, `rule_version`, `basis`, `confidence`) 별도 추적.
- `ProductReference`(시장 실재 모델)와 `OwnedItem`(가족이 보유한 아이템)을 구분. 같은 제품 복수 구매, 가족 대여, 실제 위치 이동 처리 가능.
- 이미지 사용 권한·링크 안정성·저장/전시/시연 배포 가능성을 확인. 권한 미확인 에셋을 프로덕션 정적 파일로 박아두지 않음.
- 모든 원본/파생 이미지에 출처·해시·버전·변환 이력. 만료되는 signed URL을 영속 DB에 저장하지 않음.

## 2. 데이터 엔터티 (개념 모델; 실제 스키마명 아님)

| 범위 | 엔터티/핵심 키 | 정합성 |
|---|---|---|
| 가구·사용자 | household, member, device, role/access | 하나의 공유 옷장, 구성원별 소유권, 가족 간 대여 규칙 |
| 제품 | product_reference, product_evidence | 검증 출처·버전·검증 상태 |
| 의류·소품 | owned_item, category, owner_member_id, product_id, state | 보유 아이템 ID 불변, 제품 참조·소유자 FK |
| 에셋 | image_asset, source_asset, derivative_asset, version | 원본-파생 관계; URI/라이선스/해시, 영속 asset_key |
| 공간 | storage_space, wardrobe_compartment, slot, light_zone | 내부/외부 부모 자식 관계, 슬롯 중복·수납 용량 제약 |
| 위치 | current_location, movement, movement_batch | 아이템별 현재 물리적 위치 1개, 실제 이동 완료 시에만 변경 |
| 환경·맥락 | sensor_reading, weather_forecast, event_context | mock 여부·관측시각·출처·센서 신선도 |
| 코디 | outfit, outfit_item, selection, planned_wear, wear_event | 선택/착용 계획/실제 착용 분리 |
| 추천 | recommendation, evidence_snapshot, rule_version, status | 존재하는 아이템, 근거 재현 가능 |
| VTON·카드 | tryon_job, card_job, rendered_asset | 상태·모드·입력 스냅샷·템플릿/이미지 버전 |
| 실행 로그 | light_command, HA_command, external_completion | Mock vs 실기기·요청/결과/실패 분리 |

**필드와 테이블은 논리값**. Codex는 현행 ERD/ORM/마이그레이션을 조사해서 **최소 변경** 대안을 제출해야 함.

## 3. 시드 설계 지침

- 4인 가구/51개 안은 제안; 확정되지 않았다. 제안서 `references/history/`의 51개 제품명은 **실재 확인 전 가설 레이블**.
- 예시로 여성·남성/상하의·내의·겉옷·액세서리, 소재·색상·카드 T1–T4 호환성, 계절 전환 대상을 골고루 배치하되 숫자 채우기 금지.
- 초기 `household`, `member`, `device`, `space`, `slot`, `product_reference`, `owned_item`, `asset` → 이력·코디·추천·로그 순서로 FK 정합성을 유지.
- 실재 구매 정보는 제품 사실, ‘가족이 이 제품을 보유하고 있다’는 설정은 **데모용 합성 소유 레코드**로 `is_demo` 구별. 실제 고객 계정 소유 데이터인 것처럼 주장하지 않는다.
- 실제 현재 위치는 1개, 중복 슬롯 금지. 외부 보관 위치·현관 소품 위치도 일관되게 등록.
- 추천에는 예상 기온·소재·소유자·레이어링·착용 기록·위치·저장 여유 공간 등 실제 존재하는 데이터 참조.
- 날짜: 시연 시점을 고정 또는 사용자 설정 가능하게 하고, 과거 착용 기록과 미래 예보 시각을 혼합하지 않음.
- 시드 재실행은 idempotent. 로컬 데모 DB 한정. 운영 데이터/기존 사용자 데이터 보존 및 롤백 계획 제출.

## 4. 승인/검증 체크

- `templates/product_candidates.csv`: 후보 제품별 상품 URL, 데이터 검증, 이미지 링크, 사용 권한 상태, 사용 목적, 검토 상태.
- `templates/item_plan.csv`: 아이템 후보별 가구 소유자·제품 참조·가시 위치·소재 검증/추론·계절 사용·시연 목적.
- `templates/storage_slots.csv`: 실물 구획·선반·슬롯·좌표·조명 매핑 계획. 이미지 좌표는 측정 전 빈 칸.
- `templates/asset_manifest.csv`: 상품 사진/행거/접힘/카드 버전 및 출처.
- 제안과 승인 전에는 실제 DB에 데이터 쓰기 금지. 인증·제약 위반/원격 DB 연결 주의.
- 승인이 끝나면 적재 스크립트·검증 스크립트·롤백/백업/검증 로그를 구현하고 사용자가 확인 가능한 수치로 보고.
