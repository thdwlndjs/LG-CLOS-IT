# Smart Wardrobe Backend Change Spec — 통합 수정 초안 v0.3

- 상태: **변경 방향 명세, API/DDL/Migration 적용 미승인**
- 제품 의사결정: `11_INTEGRATION_DECISIONS_v1.2.md` (ADR-01~13)
- 기준: Sprint 7 FastAPI·PostgreSQL·MinIO, `06_OPENAPI.yaml` 및 `07_DATABASE_SCHEMA.sql` (실제 코드/마이그레이션 대조 전에는 최종 계약으로 승격하지 않음).
- 원칙: 가구 단위 물리 옷장 + 사용자별 개인 데이터 + 타 기기 로그인/조회. 기능적으로 쓰이지 않는 브랜드·사이즈 전용 컬럼/DTO/fixture는 추가하지 않음.

## 1. 현재 계약과 변경 방향

| ID | 현 문서 계약/모델 | 이번 결정과 충돌 | 변경 방향 (구현 전 검증 필요) |
|---|---|---|---|
| BE-ACCOUNT-01 | `household`, `member(external_subject)`, 세션 요청 `household_id`·`member_id` | 외부 매장 미러에서 **동일 계정 로그인**을 실제로 인증하는 플로우가 문서만으로 보장되지 않음 | 개인 계정 식별→허용된 household 조회→동일 member 세션/가구 의류 조회. 기기 신뢰·개인정보·로그아웃/세션 만료 모델 검증. 로컬 프로필 선택을 로그인으로 간주 금지 |
| BE-GARMENT-01 | `garment.household_id`, `owner_id NOT NULL`; GET garments에 optional owner_id | 물리 옷장 단위 소속 식별자가 없음 | **`garment.owner_id` 유지 + `garment.device_id` 추가**. 사용자-기기 연결(`device_member`)로 허용된 기기 의류 전체 조회. 기존 `household_id`는 기존 인가·참조 호환용으로 유지하며 임의 삭제하지 않음. 신규 기기/사용자 관계의 FK 및 Migration 검증 |
| BE-PERSONAL-01 | `outfit.member_id`, `wear_event.member_id`, `member_settings.member_id`, VTON session `member_id` | 가구 공통 의류와 사용자별 코디·기록을 구분해야 함 | 기존 member scope 유지. 같은 가구 garment를 여러 사용자 코디에서 참조할 수 있어야 하고, 타 household는 차단 |
| BE-GARMENT-02 | 요청 DTO에 `owner_id`, `category`, `color` 필수. DDL 이미지 선택, `name` 기존 컬럼 존재 | 신규 UI 브랜드/사이즈 적재 불필요. 팀원 등록 UI 이름/사진 필수 등 충돌 | category/color 검증 유지. 브랜드/사이즈 추가 요구 삭제. 이름은 현재 컬럼이 있으나 **필수 정책 미확정**, 실제 화면 표시 필요 시 기존 `name`의 노출/매핑만 평가. 이미지 선택/동의/READY 절차 보존 |
| BE-OUTFIT-01 | VTON 세션 final selection/end, wear-confirmation | 코디 확정 → 계획 저장을 가정한 이전 초안과 충돌 | 확정은 최종 조합 선택 + 로컬 칸 점등. plan/wear 자동 생성 금지. plan 저장은 **별도 명시적 액션**으로 신규 계약 검토 |
| BE-LED-01 | `storage_location`, `garment_state` 존재; 조명 매핑/API 미정 | 다중 칸 점등·타이머·외부 기기 차단 | 기존 위치 ID ↔ 팀원 칸 ID ↔ Mock lighting zone 매핑. 기기 제어 가능 컨텍스트를 검증하고 로컬 컨트롤러에서만 실행, 제어 성공/실패·만료 구분 |
| BE-SHOP-01 | 쇼핑 모델/API 자체가 추가 제안이며 기존 설계는 '선택 가져오기' | **전체 일괄 등록** 요구와 충돌 | GET purchases + POST bulk-import(후보). 사용자 명시적 일괄 등록 1회, 항목별 결과 반환, 중복·취소·반품·색상 등 검증 실패는 제외/검토 상태 |
| BE-LIKED-01 | 기존 VTON은 garment/outfit 기준 | 외부 LIKED 상품을 garment로 오인할 수 있음 | 외부 상품 자산 입력을 분리하고 Mock VTON 검증. LIKED는 보유 garment/wear/outfit/card 생성 금지 |
| BE-CARD-01 | 카드 job/asset 기존 구조 | 팀원은 Outfit 썸네일을 카드로 표시 | 기존 실제 카드 draft/render-job/asset/save/share 재사용, 상태와 오류를 UI에 연결 |

## 2. 최소 데이터 모델 원칙

**기존 엔터티 재사용**

- `household` — 기존 가구·인가 데이터 스코프(물리 기기 ID와 동일시하지 않음).
- `member` — 동일한 개인 계정 식별. `external_subject`의 실제 계정 발급/인증 경로는 검증 필요.
- `garment`, `garment_state`, `storage_location`, `garment_observation` — 실제 보유 의류와 위치 데이터. `owner_id`는 **유지**하며 `device_id`로 물리 옷장 소속을 추가 식별.
- `outfit`, `outfit_session`, `wear_event`, `outfit_card`, `member_settings` — 개인별 코디·세션·착용·설정.
- `asset` — GARMENT/PERSON/VTON_RESULT/CARD 등 private upload & READY 절차.

**필요한 경우에만 신규 엔터티/필드 제안**

- 구매 기록의 `provider`, `external_purchase_item_id`, 실제 사용할 의류 이미지/카테고리/색상, 상태, 중복 키, mock 출처, import 결과.
- LIKED 상품의 provider 상품 키, VTON용 이미지/옵션 참조(실제 VTON 입력을 식별할 수준), 활동 발생자와 출처.
- 사용자 ID에 대한 외부 계정 식별/기기별 인증 컨텍스트(현 시스템이 충족하는지 먼저 검증).
- `lighting_zone` ↔ 기존 `storage_location` ↔ 팀원 UI 칸 ID의 매핑. 중복 슬롯, 복수 칸과 소등 타이머.
- 별도 착용 예정 엔터티(필요 시 `member_id`, 날짜/타임존, `outfit_id` 등), 저장·수정·취소 API.

**추가 금지(현재 요구 기준):** 브랜드·사이즈 전용 저장 컬럼, 소유자별 의류 분할/공유 ACL, 쇼핑 장바구니/최근 본 항목, 미사용 raw 쇼핑 메타데이터 전량 복제. 기존 DB의 `material`, `care_label`, 위치 관련 필드는 제거 대상이 아님.

`catalog_product`·`catalog_variant`를 포함한 기존 INT-DATA-004의 정규화 제안은 **그대로 구현 확정하지 않는다**. 동일 상품 참조·중복 방지·색상/이미지·VTON 외부 입력에 꼭 필요한 최소 구조만 검토하며, variant/brand/size 데이터를 관성적으로 추가하지 않는다.

## 3. 명령·상태 의미

### BE-LED-002 — local Mock LED 명령

1. **트리거:** 보유 의류 찾기 또는 보유 의류로 구성된 코디 확정.
2. 서버가 `garment_id`→현재 위치 상태 조회, 동일 household 제한 및 신선도 확인.
3. 디바이스가 해당 가구 물리 옷장에 연결된 **로컬 제어 대상**인지 확인. 외부 매장 미러이면 조명 호출하지 않고 '매장에서는 집 옷장 조명 제어 안 함'으로 응답/표시.
4. 신뢰 가능한 위치를 team UI 칸/LED zone으로 매핑하고 여러 칸은 dedupe하여 점등.
5. 설정된 TTL 이후 자동 소등. 구체 TTL 숫자는 이번 문서에서 임의 결정하지 않음.
6. 성공/부분 성공/위치 불명/zone 미매핑/권한 오류/제어 실패·타임아웃 구분. **명령 재시도 멱등 및 기존 타이머 갱신**은 기술 상세에서 확정.
7. 실제 wear, plan 또는 실제 물리 위치 상태를 조명 명령으로 바꾸지 않음.

### BE-OUTFIT-002 — 코디 확정·계획·실착 구분

- 저장(Outfit): 코디 구성의 저장/수정, LED/plan/wear 변경 없음.
- 확정(final selection/end): 최종 선택 및 조명 트리거. **plan/wear 변경 없음**.
- 착용 예정(plan): 캘린더에서 독립적으로 저장·변경·취소. 기존 contract에 없으므로 신규 API·DDL 필요성을 별도 판단.
- 실제 착용(wear): 명시적 확인으로 기존 wear-confirmations 생성/취소. 멱등·취소/버전 충돌 보존.

### BE-SHOP-002 — 구매 내역 일괄 import

1. Mock Provider에서 구매 목록 조회. 인위적 fixture를 실제 쇼핑몰 구매 증빙처럼 표시하지 않음.
2. 사용자의 **일괄 등록** 버튼 1회로 처리 시작(품목 선택은 필수 아님).
3. 외부 구매 항목 고유 키·이전 가져오기 내역 비교. 이미 등록된 개체는 중복 생성하지 않음.
4. 취소·반품으로 알려진 구매 항목, category/color 등 기존 `garment` 필수 정보가 없는 항목, 불명확한 수량/상품 식별 등은 무작정 등록하지 않고 **SKIPPED/NEEDS_REVIEW/FAILED**.
5. 적격 항목만 `garment`로 생성하고 가구 옷장에 반영. 별도 이력(실착·위치관측·케어)을 생성하지 않음.
6. `{registered, skipped, needs_review, failed}` 개별 결과와 재시도용 참조 반환. API 경로·DTO는 후보로만 기록.
7. Mock 구매 내역에 등록 성공했다고 해서 **외부에서 실물 소유가 독립적으로 검증됐다고 주장하지 않음**. 사용자의 등록 명령과 Mock 시연 자료의 출처를 구분.

### BE-LIKED-002 — LIKED VTON

- LIKED 상품 목록·선택 → 허용된 외부 이미지 입력 검증 → Mock VTON job 및 결과 조회.
- 보유 의류 등록, 코디 저장·카드, 착용 예정, wear 이벤트 자동 생성 0.

## 4. 기술 검증·Migration 선행조건

1. 실제 repo 백엔드/ORM/마이그레이션과 현재 DDL·OpenAPI를 비교: **기존 `owner_id`는 유지**, `garment.device_id` 추가와 `device_member` 접근 검사에 필요한 코드·DDL·DTO 변경 위치 및 기존 `household` 경계 검증.
2. 타 기기 로그인 시 `SessionStartRequest(household_id, member_id, demo_mode)`만으로 신원 위조가 가능한지 및 서버가 외부 계정 식별자(`external_subject`)와 기기 인증을 어떻게 검증하는지 확인.
3. 데이터 이관 시 기존 `owner_id`와 `household_id`는 보존. 기존 garment의 `device_id` 백필, device_member 연결, 외래키·DTO·권한 검증 및 롤백 계획 수립. **검증 전 직접 DB 수정 금지**.
4. plan·LED·shopping 신규 계약의 OpenAPI path/DTO/오류/멱등·부분 실패를 작성하고, 프론트 화면별 액션과 테스트를 대응시킴.
5. 기존 실제 보유 의류 10개 URL의 미확인 필드는 임의 보완하지 않음. Mock 구매 목록과 실제 보유 입력을 구분한 채 Seed/Import 계획 재작성.
6. MinIO READY, 동의, private URL 접근, 다른 기기 조회 및 VTON external image 권한 처리.
7. Mock E2E→실데이터 등록(별도 실행 승인 후)→실 Decart 최종 검증. 물리 LED 제어는 별도 범위.

**코드/DB 변경은 아직 승인되지 않았다.** 최종 계약 충돌 목록은 `14_CONTRACT_CONFLICT_REVIEW_v0.1.md` 참조.


## 기기 식별 모델 변경 결정 (이번 개정에서 우선 적용)

- **확정:** `user_id`/기존 `member_id`는 사람과 개인화 자료를 식별한다. **`device_id`는 집의 물리적 스마트 옷장을 식별한다.** `garment.owner_id`는 기존 컬럼으로 유지하고 `garment.device_id`를 추가한다. `device_member`(명칭은 구현 시 기존 관계 모델과 충돌 확인)로 접근 가능한 사용자와 옷장을 연결한다.
- **조회:** 같은 물리 옷장에 연결된 구성원은 `owner_id`와 관계없이 해당 `device_id`의 모든 의류를 본다. 코디·착용 기록 등 개인 자료는 기존 `member_id` 범위를 유지한다.
- **외부 매장:** 매장의 미러 기기는 **접속 기기**이고, 집의 `device_id`는 **보관 기기**다. 로그인으로 접근 권한을 확인한 뒤 집 옷장 데이터를 불러오되, 매장에서는 집 LED 제어 명령을 실행하지 않는다. 두 종류의 기기 ID를 혼용하지 않는다.
- **호환:** 기존 `household`/`household_id`를 즉시 삭제·대체하지 않는다. 이미 존재하는 FK, API, 권한 경계를 보존하면서 물리 옷장 식별자와 매핑한다. 기존 의류에 대한 `device_id` 백필 방법은 실제 데이터 확인 후 확정한다.
- **미확정 기술 세부:** 기기 등록·인증 방법, `device_member`의 실제 테이블명과 PK/FK, 다중 기기 소유 시 선택 UX, 조명 컨트롤러의 인증 방식. 제품 요구로 임의 추가하지 않는다.
- **변경 금지:** 팀원 프론트의 옷장 구조·중앙 미러 크기·비율·좌표·컴포넌트 규격. 구매 일괄 등록·좋아요 VTON 한정·코디 확정 시 조명만·자동 소등 등 기존 확정사항 유지.

> 본 개정의 기기 식별 정책이 이전 본문에 남아 있는 ‘household가 물리 옷장 ID’ 또는 ‘owner_id 삭제 검토’ 표현보다 우선한다. 실제 API/DDL 구현은 코드 검증 후 별도 승인한다.
