# CR-009 — 쇼핑몰 연동 기능 확장 명세 및 구현 변경요청서

- 문서 버전: v0.1 (검토안)
- 작성일: 2026-10-09
- 대상: Smart Wardrobe Prototype, Sprint 0~7 이후 변경
- 상태: **설계 검토 / 구현 미착수 / DB·MinIO 변경 미승인**
- 우선 참조: `03_ARCHITECTURE_HLD_v1.1.md`, `04_FSD.md`, `05_BACKEND_LLD.md`, `06_OPENAPI.yaml`, `07_DATABASE_SCHEMA.sql`, `08_IMPLEMENTATION_PLAN.md`, `OWNED_GARMENT_IMPORT_REVIEW.md`
- 원칙: 현재 저장소의 최신 구현·마이그레이션을 기준으로 실제 차이를 검증한다. 본 문서는 변경 제안이며, 이미 구현되었다고 주장하지 않는다.

## 1. 변경 배경 및 목표

기존 의류 등록·Digital Twin·VTON 백엔드는 유지한다. IA의 **쇼핑몰** 영역에 외부 쇼핑 플랫폼의 구매·관심 데이터를 연결하는 사용자 경험을 추가한다. 사용자에게 상품 URL을 수동 입력시키는 기능을 핵심 플로우로 정의하지 않는다. 장기 목표는 LG전자와 쇼핑 플랫폼 간 적법한 제휴·사용자 동의 기반 데이터 연동이다. 현재 프로토타입은 동일한 내부 계약을 사용하는 **Mock Shopping Provider**로 시연한다.

### 확정 사용자 플로우

**SF-01 구매 내역 → 내 옷장 가져오기**
1. 사용자가 쇼핑몰 화면에서 연결된 쇼핑몰의 구매 내역을 조회한다.
2. 구매한 상품과 선택 옵션(색상·사이즈 등)을 표시한다.
3. 사용자가 가져올 항목, 수량·실제 보유 여부·소유자 등을 확인하고 가져오기를 실행한다.
4. 백엔드가 중복 여부와 필수 속성을 검증하고 `garment`에 실물 의류 단위로 등록한다.
5. 등록된 의류는 기존 Digital Twin에 나타난다. 실제 위치·RFID·착용·세탁 상태는 확인 근거가 없으면 추정하지 않는다.

**SF-02 관심 상품 → VTON 입어보기**
1. 사용자가 쇼핑몰 화면에서 장바구니·좋아요·최근 본 상품 중 탭을 선택한다.
2. 연동된 상품 목록에서 상품을 선택한다.
3. 사용자가 VTON을 실행해 미리 입어본다.
4. 이 과정은 `garment` 등록이나 실제 착용(`wear_event`)으로 간주하지 않는다.

> '구매 내역'도 결제·배송·취소·반품 상태에 따라 실물 보유를 보장하지 않으므로 사용자 확인 없이 자동 확정하지 않는다.

## 2. 범위

| 구분 | 포함 | 제외 / 추후 |
|---|---|---|
| 쇼핑몰 데이터 | 구매, 장바구니, 좋아요, 최근 본 상품의 Mock 조회·정규화 | 제휴 없는 실제 계정 스크래핑, 접근 제한 우회 |
| 상품 정보 | 쇼핑몰 상품 식별자, 브랜드, 상품명, 카테고리, 색상/옵션, 이미지 참조, 확인된 소재·케어 정보 | 근거 없는 소재·케어·구매일 추정 |
| 구매 가져오기 | 선택·확인·중복 검증·실물 단위 의류 생성 | 모든 구매를 무조건 자동 등록 |
| 관심 상품 VTON | 외부 상품 이미지 기반 VTON 입력 연결, 기존 비동기 Job 재사용 | 공급자가 지원하지 않는 품질·핏 정확도 보장 |
| 데이터 운영 | Mock fixture, 재실행 멱등성, 소스·동기화 시각 기록 | 실제 제휴 인증·대규모 동기화 운영 |
| 기존 기능 | 의류·보관·코디·카드·권한 회귀 보장 | 기존 Sprint 기능 재작성 |

## 3. 도메인 데이터 구분

1. **Catalog Product**: 쇼핑몰이 판매하는 상품 및 옵션 정보. 사용자 소유 여부와 무관.
2. **Shopping Activity**: 특정 사용자의 구매/장바구니/좋아요/최근 본 상품 관계. 하나의 상품에 여러 활동 유형이 공존할 수 있음.
3. **Owned Garment**: 사용자가 실제로 보유한다고 확인한 개별 의류. 기존 `garment`가 정본.
4. **Asset**: 검증·승인된 이미지 파일의 비공개 저장소 메타데이터. 외부 URL을 `asset_id`에 대입하지 않음.

권장 관계: `member` → 쇼핑몰 연결(모의 계정) → 활동 기록 → 상품·옵션 카탈로그; 구매 항목(확인 완료) → `garment`; 관심 상품 → VTON 입력. `style_reference`는 기존 스타일 참고 이미지 기능으로 유지하며 쇼핑 활동 전체를 억지로 대체하지 않는다.

## 4. 기존 계약 대비 Gap 분석

| 항목 | 기존 확인 내용 | 제안 변경 |
|---|---|---|
| `garment` | DB에 `name`, `attributes`가 존재하나 등록 API에서 미노출(적재 사전검토 기준) | 등록/수정/조회 DTO·서비스에서 필요한 필드 노출 및 검증 |
| `style_reference` | `source`는 `INSTAGRAM/SHOPPING/OTHER`, 제목·URL·이미지 중심 | 기존 용도 유지; 장바구니/좋아요/최근 본 기록은 별도 모델 검토 |
| 상품 카탈로그 | 전용 모델은 원본 DDL에서 확인되지 않음 | 상품·옵션·쇼핑몰별 외부 ID 관리 모델 추가 검토 |
| 사용자 쇼핑 활동 | 원본 DDL에서 전용 모델 확인되지 않음 | 활동 종류, 발생·동기화 시각, 구매 상태, 원본 참조 기록 |
| VTON | 기존 세션/Outfit/의류 기반 흐름 | **외부 상품 입력**을 지원하도록 입력 계약과 렌더링·권한·결과 연결 검토 |
| 쇼핑몰 연동 | 제휴 Provider 미연결 | Provider 인터페이스 + Mock Adapter + fixture |

**검증 주의:** 표의 기존 상태는 제공된 원본 설계와 2026-10-09 사전검토 문서 기준이다. Sprint 0~7 사이 수정된 최신 코드·마이그레이션과 차이가 있으면 최신 상태를 우선 재확인한다.

## 5. 제안 데이터 모델 (최종 테이블명·컬럼은 구현 검토 후 확정)

### 5.1 `shopping_connection` (신규 후보)
- `id`, `member_id`, `provider`, `external_account_ref`(Mock 식별자), `status`, `last_synced_at`, `created_at`
- 실연동 시 토큰은 별도 비밀 저장 방식 검토. Mock fixture에 인증정보·실제 계정 비밀번호 저장 금지.

### 5.2 `catalog_product` / `catalog_variant` (신규 후보)
- Product: `id`, `provider`, `external_product_id`, `brand`, `name`, `category`, `source_url`, `image_reference`, `material?`, `care_metadata?`, `raw_metadata`, `last_synced_at`
- Variant: `id`, `product_id`, `external_variant_id?`, `color?`, `size?`, `option_label?`
- `(provider, external_product_id)` 중복 방지. 옵션 식별자는 실제 제공될 때만 사용.
- 이미지 외부 참조와 실제 업로드 완료된 `asset`은 구분.

### 5.3 `shopping_activity` / `shopping_purchase_item` (신규 후보)
- Activity: `member_id`, `connection_id`, `product_id`, `variant_id?`, `activity_type` (`CART`, `LIKED`, `RECENTLY_VIEWED`), `occurred_at?`, `synced_at`, `source_record_id?`
- Purchase: `member_id`, `connection_id`, `product_id`, `variant_id?`, `external_order_item_id?`, `quantity?`, `fulfillment_status?`, `purchased_at?`, `synced_at`, `import_status`
- 구매와 관심 활동은 구분. 같은 상품의 다중 활동을 허용. 소스에 없는 이벤트 시각은 수집 시각과 혼동하지 않는다.

### 5.4 `garment` 연결
- 구매 가져오기 성공 시 `garment` 생성, 원본 `catalog_product`/구매 항목과 매핑 관계 유지(별도 `garment_import_source` 후보 또는 검증된 `attributes` 구조).
- 상품명·브랜드·출처는 읽기·쓰기 API에서 손실 없이 보존.
- 수량이 2벌이면 확인된 실물 개체 2개로 처리. 구매 수량만으로 현재 보유 수량을 추정하지 않는다.
- `garment_state`의 실제 위치/신뢰도, `wear_event`, 관측 이력은 허위 생성 금지.

### 5.5 VTON 외부 상품 입력
- 기존 VTON 세션·비동기 작업·결과 Asset 흐름 재사용.
- VTON 대상 아이템이 `owned_garment` 또는 `catalog_variant` 중 하나임을 식별하는 명시적 타입 계약 설계.
- 기존 `outfit_item`이 `garment_id` 필수라면 무리하게 관심 상품을 보유 의류로 위장하지 않는다. 세션 선택 아이템 스냅샷 또는 별도 참조 모델을 검토하고, 저장 코디·카드에 관심 상품이 들어갈 수 있는지 계약을 확정한다.
- 원격 이미지 사용권·VTON 제공자의 입력 요건·이미지 보안 검증을 통과하지 못하면 명시적으로 실패/보류.

## 6. API 계약 (경로는 예시; 기존 OpenAPI와 충돌 검사 후 확정)

| 작업 | 후보 경로 | 주요 동작 |
|---|---|---|
| 쇼핑몰 연결 목록 | `GET /api/v1/shopping/connections` | Mock Provider 목록·동기화 상태 |
| 쇼핑 활동 조회 | `GET /api/v1/shopping/items?type=PURCHASED\|CART\|LIKED\|RECENTLY_VIEWED` | 상품·옵션 포함 목록 |
| Mock 동기화 | `POST /api/v1/shopping/sync` | 중복 없이 fixture 동기화 |
| 구매 내역 가져오기 | `POST /api/v1/shopping/import-purchases` | 선택 항목 검증·실물 등록·부분 실패 보고 |
| 외부 상품 VTON | 기존 VTON API 확장 우선 | `source_type=CATALOG_PRODUCT`, 상품/옵션 참조 |

- 인증·가구/회원 격리·Idempotency-Key·입력 검증·에러 포맷은 기존 계약과 일관되게 유지.
- 기존 엔드포인트와 충돌하지 않도록 계약 테스트를 우선 작성.
- 일괄 가져오기는 항목별 성공/보류/실패를 구분하고 중복 생성 없이 재시도 가능해야 함.

## 7. Mock 데이터 적재 정책

1. 무신사 등 외부 상품 데이터는 **쇼핑몰 Mock 원본**으로 적재한다. URL은 소스 추적/상품 식별 정보이며 사용자 입력 UX가 아니다.
2. 구매/좋아요/장바구니/최근 본 상품이라는 활동 유형은 원본 증거 또는 명시적 데모 시나리오 지정이 있어야 한다. 상품 URL만으로 활동 유형을 추정하지 않는다.
3. 기존 `OWNED_GARMENT_IMPORT_REVIEW.md`의 10개 입력은 고유 상품 9개로 정리되며, 상품 식별·색상 미확인/충돌 항목은 보류 상태를 유지한다.
4. 실제 구매·보유 확인 없이 `garment`를 생성하지 않는다. 데모용 구매 이력으로 사용할 경우 **합성 Mock 구매 이력**임을 fixture와 UI에 명시한다.
5. 이미지 수집·저장은 라이선스/이용약관·동의·기존 MinIO 업로드 검증을 준수. 이미지 URL 확보와 저장 성공을 구분한다.
6. fixture 버전, 상품별 원본 키, 수집 근거, 데이터 확실성, 등록 결과 및 실패 사유를 추적한다.

## 8. 구현 단계 및 산출물

| 단계 | 작업 | 완료 증적 |
|---|---|---|
| P0 영향 분석 | 최신 Sprint 0~7 코드·마이그레이션·VTON 계약과 본 문서 Gap 대조 | 영향 파일/기능 목록, 결정 필요 항목 |
| P1 계약 확정 | HLD/FSD/LLD/OpenAPI 수정, DB 모델·상태 전이 확정 | 계약 diff, `DECISIONS.md` |
| P2 데이터 계층 | 비파괴적 Alembic migration, 제약·인덱스·Repository | migration 및 롤백/호환성 테스트 |
| P3 Provider Mock | Fixture 정규화·동기화·중복 방지 | API·통합 테스트 |
| P4 구매 가져오기 | 사용자 확인·검증·등록·원본 연결 | 다중/중복/부분실패 테스트 |
| P5 관심 상품 VTON | 관심 상품 선택 → VTON → 결과 확인 | Mock VTON E2E |
| P6 통합 검증 | 기존 Sprint 회귀·보안·문서 업데이트 | 테스트 로그·변경 보고서 |

### 변경 통제
- 원본 설계 문서를 임의로 덮어쓰지 말고 변경 전후 차이와 신규 기능 ID를 기록한다.
- 기존 API 호출자 호환성 유지. 불가피한 파괴적 변경은 별도 결정으로 격리.
- 실제 DB 데이터 삭제, 실제 계정 연동, 공개 이미지 배포는 이 문서만으로 승인되지 않는다.

## 9. 인수 기준 (Definition of Done)

- [ ] 구매/장바구니/좋아요/최근 본 상품의 Mock 목록이 쇼핑몰 IA 기능에 맞게 구분된다.
- [ ] 구매 내역 선택 가져오기가 `garment`에 정확히 연결되고, 동일 요청 재시도 시 중복 생성하지 않는다.
- [ ] 취소·반품·보유 불명 항목은 자동 보유 확정하지 않는다.
- [ ] 관심 상품은 `garment` 생성 없이 VTON에 입력되어 결과를 확인할 수 있다.
- [ ] 외부 상품 이미지·옵션 미확인/실패 시 사용자에게 명확한 상태를 제공한다.
- [ ] 회원·가구 격리, 인증, 파일 접근, 기존 멱등성 정책이 유지된다.
- [ ] 기존 Sprint 0~7의 회귀 테스트가 통과한다.
- [ ] 변경된 FSD·OpenAPI·DB·코드·테스트·시연 fixture가 상호 일치한다.
- [ ] Mock을 실제 쇼핑몰 제휴 API라고 표시하지 않는다.

## 10. 결정 필요 사항 (구현 착수 전 확정)

1. **가져오기 단위:** 구매 항목을 사용자가 선택해 가져오는 UX를 기본으로 확정할지.
2. **소유 확인:** 구매 완료·배송 완료와 실제 보유 확인의 구분 및 반품 처리 방식.
3. **관심 상품 코디:** VTON에만 허용할지, 저장 코디/코디카드에도 포함할지.
4. **데모 데이터:** 이번 무신사 수집 목록 중 어떤 항목을 합성 구매 이력, 좋아요, 장바구니, 최근 본 상품으로 지정할지.
5. **상품 이미지:** 로컬 Mock에 사용할 수 있는 이미지의 사용권 및 대체 이미지 정책.

위 미결정 사항은 결정 전까지 가정으로 구현하지 않는다. 충돌 없는 계약 분석과 Mock Provider 기반 작업은 병행할 수 있다.

## 11. Codex 전달용 실행 지시

> `docs/09_SHOPPING_INTEGRATION_CHANGE_REQUEST.md`를 신규 변경요청서로 삼아 먼저 Sprint 0~7 최신 구현과 Gap 분석을 수행하고 `docs/DECISIONS.md`에 확정/미결정 항목을 기록해줘. 확정된 쇼핑몰 구매 내역→선택적 내 옷장 등록, 장바구니·좋아요·최근 본 상품→VTON 두 플로우에 한정해 기존 계약·DB를 비파괴적으로 확장해줘. 제휴 API는 Mock Adapter로 대체하고 기존 기능 회귀 테스트를 실행해줘. 결정이 필요한 사항은 추정 구현하지 말고 해당 부분만 보류해줘. 실제 쇼핑몰 로그인·우회 스크래핑·실제 데이터 적재는 수행하지 마.
