# Smart Wardrobe 기존 계약 충돌·결정 대기 리뷰 v0.2

- 날짜: 2026-10-09
- 범위: 이번에 확정된 ADR-09~13에 직접 관련된 API/DB 계약 충돌 위주. 기타 모든 기능의 완전한 코드 감사가 아님.
- 검토한 파일: `INTEGRATION_PREPARATION_REPORT.md`, `03_ARCHITECTURE_HLD_v1.1.md`, `04_FSD.md`, `06_OPENAPI.yaml`, `07_DATABASE_SCHEMA.sql`, `04_DB_IMPORT_AND_SHOPPING_INTEGRATION_DESIGN.md`, 11~13 이전 초안.
- 한계: 제공된 문서·보고서 기준 **정적 계약 비교**. 실제 Sprint 7 실행 코드·ORM/마이그레이션을 직접 확인한 결과가 아님. 구현/DB 변경 승인 아님.

## 1. 충돌 매트릭스

| ID | 기존 계약의 근거 | 이번 확정 정책 | 충돌 수준 | 최소 변경 방향·검증 사항 |
|---|---|---|---|---|
| C-01 | DDL `garment(owner_id NOT NULL, household_id)` 및 GET `/api/v1/garments?owner_id=`; FSD GAR-001에 소유자·공유 범위 필터 | **하나의 물리 기기(`device_id`) 옷장**, 연결 사용자 전체 의류 조회 | **High / 신규 식별자·인가·쿼리** | `owner_id` 유지, `garment.device_id` 신규 추가, `device_member` 연결. 기존 household 인가 경계 보존. 기본 owner 필터 제거 및 기기별 조회 검증 |
| C-02 | DDL `member(external_subject UNIQUE)`, OpenAPI `POST /api/v1/sessions` 요청 `household_id`, `member_id`, `demo_mode` | **타 매장 미러에서 동일 개인 계정으로 로그인·기존 데이터 복원** | **High / 인증** | 현 계약만으로 외부 신원 인증을 증명할 수 없음. 실제 인증 주체, 계정 식별 바인딩, 기기·토큰 재발급·만료, 가구 조회 인증 검증. 프로필 선택만으로 보안성 보장한다고 주장 금지 |
| C-03 | DDL `outfit/member_id`, `wear_event/member_id`, `member_settings/member_id` | 코디·착용·개인 설정만 사용자별 | **Low / 기존 구조 적합** | 개인 데이터는 member scope로 유지하되 같은 household 모든 garment 참조 가능 여부 테스트 |
| C-04 | FSD/팀원 ‘이 옷으로 입기’ → plan 발생, `/vton-sessions/{id}/end`는 final selection, `wear-confirmations`는 실착 | **코디 확정 시 조명만**, plan 별도 | **High / 이벤트 의미** | 버튼 명칭·행동/세션 종료 계약 분리. 새 plan API·엔터티 여부는 실제 달력 사용 정책과 기존 구현 확인 후 설계. 확정만으로 plan/wear 0 보장 |
| C-05 | DDL에 `storage_location`, `garment_state` 존재. 조명 API·zone/device mapping 문서에 없음 | 로컬 Mock LED 다중 점등 + TTL 소등. 외부 미러에서 집 조명 제어하지 않음 | **High / 신규 기능·기기 범위** | 위치-ID ↔ 화면 칸-ID ↔ mock zone, 컨트롤러의 설치 위치/기기 허용 범위, TTL 및 타이머·오류·멱등 검증. 실제 LED 장치 계약은 제외 |
| C-06 | INT-DATA-004 §1·§2·§7 ‘구매 내역 조회·선택 가져오기’, ‘품목별 실물 확인’ | **전체 일괄 등록 1회 동작** | **High / 플로우·API** | 항목 선택을 전제로 한 UI/API 변경. 취소/반품·중복·정보 부족 항목을 일괄 성공 처리하지 않는 규칙 설계. Mock 구매 활동과 실제 보유 검증은 별개임을 표시 |
| C-07 | INT-DATA-004 `catalog_product(브랜드 등)`, `catalog_variant(사이즈 등)` / 이전 BE draft name·brand·size 확장 | **브랜드·사이즈 필드 추가하지 않음** | **Medium / 과설계 제거** | 기능의 실제 읽기 경로부터 역으로 최소 필드 선정. 출처 외부 키/이미지/카테고리/색상/상태/멱등에 필요한 구조만 유지. 카탈로그·variant 테이블은 아직 도입 확정 아님 |
| C-08 | 팀원 등록: 사진/이름 필수·색상 선택. 기존 `GarmentUpsert`: owner/category/color 필수, 이미지 선택 | 기능상 필요한 속성만; 사진·이름·브랜드·사이즈 강제 수집 금지 | **Medium / UI·DTO** | 기존 `category/color` 누락 허용이 아니라 팀원 폼을 현재 계약에 맞춤. 이름/이미지 필수 처리 제거·유지 여부는 원본 UX 변경 불가 조건과 충돌하므로 최소 어댑터·단계 내 보완 검토 |
| C-09 | private `asset`, 서명 업로드/동의, 현재 mock UI only | 외부 기기에서 자신의 옷장 이미지 사용 | **Medium / 자산 접근** | 동일 로그인/가구 권한으로 허용된 자산만 private 조회/서명 URL 재발급. CDN 공개화 등 임의 변경 금지 |

## 2. 새 결정으로 이미 해결된 정책 충돌

- 코디 확정 시 plan 자동 저장: **하지 않음**. 별도 착용 예정 등록을 유지.
- 구매를 품목별 선택 가져오기: **하지 않음**. 일괄 등록으로 변경하되 항목별 오류 표기.
- 가구별 의류 공유 설정/소유자별 분리: **하지 않음**. 물리 옷장 공통 조회, 개인 자료만 분리.
- 브랜드·사이즈 저장: **기능에 사용하지 않으므로 신규 요건에서 제거**.
- 일반 웹 모바일 반응형 재설계: **하지 않음**. 팀원 원본 규격 고정.
- 외부 매장에서 가정 내 LED 원격 조작: **하지 않음**. 외부 기기에서는 가구 데이터 접근 및 VTON만.

## 3. 구현 전 남은 기술 선택(사용자 제품 정책 재질문 불필요)

| 우선 | 계약·기술 결정 | 판단에 필요한 실제 코드 증거 |
|---|---|---|
| P0 | `owner_id` 유지 + 신규 `device_id`/`device_member` 적용: 기존 household 인가와 필수 DTO 호환 방식 | 라우트·Pydantic·서비스·SQLAlchemy·테스트에서 owner/household를 적용한 로직 |
| P0 | 외부 매장 계정 인증 방식/같은 계정 재조회 계약 | 현재 토큰 발급/검증, 외부 identity binding, device/session 처리 |
| P0 | 일괄 import의 입력·응답·멱등·부분 실패 계약 | 현재 DB uniqueness, 기존 idempotency infra, Mock Provider fixture 구조 |
| P1 | 계획 API/엔터티 및 캘린더 CRUD, 코디 확정 경로 | 기존 calendar/plan 데이터와 VTON session-end·history API |
| P1 | 위치↔LED 구역/디바이스 식별 및 TTL 기본값 | 실제 팀원 UI 칸 mapping, storage location 관측 신뢰도, Mock controller 처리 위치 |
| P1 | 원본 의류 등록 폼의 최소 필드 호환 방식 | 팀원 컴포넌트 상태, `GarmentUpsert` 실제 구현, 현재 MinIO 업로드 요구 |
| P2 | 카드 공유 정책·허용 정보 범위/만료 | 기존 card 공유 기능과 실제 UI |

## 4. Codex 구현 전 검증 요청(실행 아님)

1. 위 C-01~09별로 실제 `backend/`, `web/`, 팀원 전달본의 **파일·함수·현재 동작**을 증거로 제시.
2. P0를 우선 처리하는 API request/response·DB migration diff를 제안하되 실제 적용은 별도 승인 후 수행.
3. 기능 없이 만들어지는 컬럼/테이블을 구분해 삭제 제안(새 브랜드·사이즈 및 불필요한 쇼핑 variant 등). 기존 레거시 데이터는 임의 삭제하지 말 것.
4. UI 개발에서 팀원 파일 규격/좌표가 바뀌지 않도록 시각 회귀 확인.
5. 모든 QA의 **정적 확인 / Mock E2E / 실제 FastAPI·DB E2E / 외부 서비스 검증** 레벨을 구분.

**검토 결론:** 제품 정책은 추가 질문 없이 문서에 반영할 수 있다. 단 `device_id` 추가 위치·외부 기기 로그인·bulk import·LED 제어의 구체적 API/DDL은 코드 확인 없이 확정하지 않는다. `owner_id` 유지 결정은 확정이다.


## 기기 식별 모델 변경 결정 (이번 개정에서 우선 적용)

- **확정:** `user_id`/기존 `member_id`는 사람과 개인화 자료를 식별한다. **`device_id`는 집의 물리적 스마트 옷장을 식별한다.** `garment.owner_id`는 기존 컬럼으로 유지하고 `garment.device_id`를 추가한다. `device_member`(명칭은 구현 시 기존 관계 모델과 충돌 확인)로 접근 가능한 사용자와 옷장을 연결한다.
- **조회:** 같은 물리 옷장에 연결된 구성원은 `owner_id`와 관계없이 해당 `device_id`의 모든 의류를 본다. 코디·착용 기록 등 개인 자료는 기존 `member_id` 범위를 유지한다.
- **외부 매장:** 매장의 미러 기기는 **접속 기기**이고, 집의 `device_id`는 **보관 기기**다. 로그인으로 접근 권한을 확인한 뒤 집 옷장 데이터를 불러오되, 매장에서는 집 LED 제어 명령을 실행하지 않는다. 두 종류의 기기 ID를 혼용하지 않는다.
- **호환:** 기존 `household`/`household_id`를 즉시 삭제·대체하지 않는다. 이미 존재하는 FK, API, 권한 경계를 보존하면서 물리 옷장 식별자와 매핑한다. 기존 의류에 대한 `device_id` 백필 방법은 실제 데이터 확인 후 확정한다.
- **미확정 기술 세부:** 기기 등록·인증 방법, `device_member`의 실제 테이블명과 PK/FK, 다중 기기 소유 시 선택 UX, 조명 컨트롤러의 인증 방식. 제품 요구로 임의 추가하지 않는다.
- **변경 금지:** 팀원 프론트의 옷장 구조·중앙 미러 크기·비율·좌표·컴포넌트 규격. 구매 일괄 등록·좋아요 VTON 한정·코디 확정 시 조명만·자동 소등 등 기존 확정사항 유지.

> 본 개정의 기기 식별 정책이 이전 본문에 남아 있는 ‘household가 물리 옷장 ID’ 또는 ‘owner_id 삭제 검토’ 표현보다 우선한다. 실제 API/DDL 구현은 코드 검증 후 별도 승인한다.
