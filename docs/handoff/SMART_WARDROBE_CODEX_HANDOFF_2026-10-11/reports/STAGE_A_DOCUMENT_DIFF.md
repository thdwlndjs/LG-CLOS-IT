# A단계 문서 변경 전후 diff

변경 전 실제 바이트의 SHA256은 STAGE_A_DOCUMENT_CHANGES.json에 기록했다. 아래 diff는 줄바꿈을 정규화해 의미 변경만 비교한다. 기존 untracked 입력도 변경 전 내용으로 역대조했다.

```diff
--- docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/contracts/00_MASTER_CONTRACT.md:before
+++ docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/contracts/00_MASTER_CONTRACT.md:after
@@ -1,23 +1,25 @@
 # MASTER CONTRACT — Smart Wardrobe 통합 변경 기준 H1.0
+
+> **PoC A1 적용(2026-10-11):** [최신 기준 계약](../POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.

 - 상태: **제품/UX/보관 정책 일부 확정**, 실재 제품·수량·실제 DB 매핑 미승인
 - 적용: CHG-00(실제 제품 DB), CHG-01(IA), CHG-02(VTON), CHG-04(코디카드), SW-CARD-TEMPLATE-001, CHG-08(디지털 트윈·LED), CHG-09(에이전트)
-- 정책 문서 간 우선순위: **이 문서의 결정상태표 → 이 폴더의 해당 주제 계약 → 기존 저장소의 실제 스키마/구현(대조·제안 필수) → history(참조만)**.
+- 정책 문서 간 우선순위: **최신 사용자 정책/A1 → 이 문서의 결정상태표 → 이 폴더의 해당 주제 계약 → 기존 저장소의 실제 스키마/구현(대조·제안 필수) → history(참조만)**.
 - 이 계약은 기존 저장소 파일을 읽지 않은 상태에서 작성됨. 실제 코드·DB 스키마를 본 것으로 가장하지 말 것.

 ## I. 확정된 제품 규칙 (`confirmed`)

 1. Smart Wardrobe는 **개인 코디 앱이 아니라 가족 의류·공간의 통합 관리**를 지원한다. 엄마는 가족 의류 관리의 핵심 페르소나. 시연 등장 인물은 **엄마·아들**.
 2. 가족 공유 물리 옷장(`device`)과 구성원(`member`) 소유권은 구별한다. 옷이 옷장 밖 보관 공간에도 존재한다.
-3. 보유·등록된 아이템만 추천·VTON·코디카드에 활용한다. 소품이 카드에 등장하려면 등록/소유/공유 권한이 있어야 한다.
+3. 추천·코디카드는 보유·등록된 아이템만 활용한다. VTON은 사용자별 DB 관심 의류만 또는 보유/관심 혼합도 허용한다. 소품이 카드에 등장하려면 등록/소유/공유 권한이 있어야 한다.
 4. **RULE-01 실제 제품 기준**: 실재 브랜드·상품 모델과 검증된 원본/출처를 바탕으로 시드 등록. 상품 모델과 가족이 소유한 물리적 `item_id`는 다른 개념.
 5. 실제 상품 정보와 추론 속성(계절/보온/레이어링/관리 안내)을 구별한다. 확인되지 않은 소재/색상/품번·상세 이미지는 사실로 만들지 않는다.
 6. 외부 보관함 의류 인식은 시연에서 **일괄 이동 확인** 방식. 외부 보관 공간 RFID/비전 자동 추적은 필수가 아니다.
 7. 보관 제안 시 **반팔·민소매·얇은 여름옷 우선 반출**, 겨울 패딩·두꺼운 울코트·방한 니트 우선 회수. **트렌치코트·데님 재킷·가디건·긴팔 셔츠는 기본 유지**하며 일괄 반출하지 않는다.
 8. 추천은 선제안이며 자동 물리 이동 아님. **제안 생성 → 승인 → 실제 이동 완료 확인 → 현재 위치 갱신**을 구별.
 9. 홈은 2–3개 추천 코디의 가로 캐러셀. 별도의 추천 코디 비교하기 메뉴/화면 추가 금지. `AI 입어보기`로 진입하고 이전 화면·선택·캐러셀 위치를 보존.
-10. `코디 확정/이 코디 입기`, `착용 예정`, `실제 착용`, `코디카드 생성`은 별개 상태/이벤트. 확정 시 해당 위치 LED 안내 가능하나 착용 이력은 자동 생성하지 않음.
-11. 코디카드는 사용자가 요청할 때만 생성; VTON 결과 사진을 카드 소재로 자동 사용하지 않음. 독립된 4개 레이아웃과 Playwright PNG를 사용.
+10. PoC에서는 보유 코디의 `코디 확정/이 코디 입기`가 실제 착용 확인을 겸하며 명시적 intent당 착용 이력1회와 내부칸 LED30초를 수행한다. 카드 저장/생성은 독립이며 착용 예정·별도 평가를 자동 생성하지 않는다.
+11. 저장용 코디카드는 사용자가 템플릿을 골라 요청할 때 생성하며, 사용자·일자별 홈 미저장 PNG 미리보기2~3개는 자동 준비/당일 재사용한다; VTON 결과 사진을 카드 소재로 자동 사용하지 않음. 독립된 4개 레이아웃과 Playwright PNG를 사용.
 12. 옷장 내부 시각 의류는 DB ID·실제 위치와 일치하는 개별 렌더 레이어다. 원본 배경에 고정 의류가 남는 방식은 목표 상태가 아니다.
 13. Mock 환경 데이터·조명·실제 기기·Decart API 지원 상태를 명확히 표기. 검증하지 않은 성공 주장 금지.

@@ -26,13 +28,13 @@
 | 결정 | 상태 | 제안·근거 |
 |---|---|---|
 | 전체 가구원 수 | proposed | 엄마/아빠/아들/딸 4인 구성 제안. 배우는 엄마·아들로 확정 |
-| 시드 데이터 전체 개수 | proposed | 사진 구획을 활용한 옷장 35 + 외부 의류 8 + 소품 8 = 51개. 고정 수량 아님 |
+| 기존 보유 데이터 | confirmed | 기존76과 승인 왼쪽 보존. 오른쪽 부족분 추가 여부/매핑은 A 질문과 B manifest로 확정 |
 | 스마트 옷장 구획별 슬롯 개수 | proposed | A7 B7 C7 D2 E4 F8; 실제 사진/좌표/보관 실용성 검토 필요 |
 | 제품 후보 | pending | 실제 상품 조사/검증 후 사용자 승인 |
 | 상품 이미지 확보/가공 방식 | pending | 권한, 원본 해상도, 생성 결과 품질 검증 필요 |
 | 시연 날짜·환경값·날씨 | pending | Mock을 명확히 표시하고 자료 정합성 검증 |
 | VTON 지원 모드 | pending | Decart 공식 API/계정 지원 및 입력 조합 검증 |
-| LED 실제 제어 위치·시간 | pending | UI Mock vs 실물 하드웨어 구분 필요 |
+| LED 위치·시간 | confirmed / 실물별도 | 내부 알려진 칸30초·재요청갱신. Mock 검증과 실물 별도 |
 | 기존 DB/API·실제 경로 | pending | Codex가 저장소 감사 후 매핑 |
 | 카드 원본 복원 정확도 합격선 | pending | 네 원본 무자막 기준본 및 visual QA 필요 |

@@ -42,7 +44,7 @@
 - 2인 가구만 지원하는 가정(시연에 엄마·아들만 나온다는 이유로).
 - **트렌치코트, 데님 재킷, 스트라이프 긴팔**을 겨울 전환 시 일괄 보관 대상으로 삼는 설정.
 - 템플릿 4장을 하나의 평균화한 CSS 배치로 재구성하는 방식.
-- 추천 시 코디카드를 자동 생성하거나, 코디 확정 시 실제 착용으로 간주하는 방식.
+- 홈 미리보기까지 사용자 갤러리에 자동 저장하거나, 카드 저장을 착용으로 간주하는 방식. (이전 자동 preview/확정 착용 금지 정책은 A1로 대체)
 - 옷장 원본 화면(이미 옷이 그려져 있음)을 그대로 DB 동기화 화면으로 쓰는 방식.

 ## IV. 구현 우선순위 원칙
--- docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/contracts/01_DATA_AND_PRODUCT.md:before
+++ docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/contracts/01_DATA_AND_PRODUCT.md:after
@@ -1,4 +1,6 @@
 # CHG-00 — 실제 제품 기반 데이터 계약
+
+> **PoC A1 적용(2026-10-11):** [최신 기준 계약](../POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.

 ## 1. 제품 조사/DB 적재 필수 원칙 (`RULE-01`)

--- docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/contracts/02_ASSETS_WARDROBE.md:before
+++ docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/contracts/02_ASSETS_WARDROBE.md:after
@@ -1,4 +1,6 @@
 # CHG-08 — 옷장 디지털 트윈·원본/파생 에셋·조명 계약
+
+> **PoC A1 적용(2026-10-11):** [최신 기준 계약](../POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.

 ## 기준 이미지

--- docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/contracts/03_EXPERIENCE_VTON_CARD.md:before
+++ docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/contracts/03_EXPERIENCE_VTON_CARD.md:after
@@ -1,4 +1,6 @@
 # CHG-01/02/04 + SW-CARD-TEMPLATE-001 — 화면·피팅·코디카드 계약
+
+> **PoC A1 적용(2026-10-11):** [최신 기준 계약](../POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.

 ## AI 입어보기 IA

--- docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/contracts/04_STORAGE_AGENT.md:before
+++ docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/contracts/04_STORAGE_AGENT.md:after
@@ -1,4 +1,6 @@
 # CHG-09 — 보관·회수 선제안 에이전트 정책 계약
+
+> **PoC A1 적용(2026-10-11):** [최신 기준 계약](../POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.

 ## 제품 경험

--- docs/03_ARCHITECTURE_HLD_v1.1.md:before
+++ docs/03_ARCHITECTURE_HLD_v1.1.md:after
@@ -1,4 +1,3 @@
-# Smart Wardrobe — 통합 프로토타입 HLD v1.1
 # Smart Wardrobe — 통합 프로토타입 HLD v1.1

 > **PoC A1 적용(2026-10-11):** [최신 기준 계약](handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.
--- docs/04_FSD.md:before
+++ docs/04_FSD.md:after
@@ -1,4 +1,3 @@
-# Smart Wardrobe — FSD 상세 기능명세서 v1.1
 # Smart Wardrobe — FSD 상세 기능명세서 v1.1

 > **PoC A1 적용(2026-10-11):** [최신 기준 계약](handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.
--- docs/05_BACKEND_LLD.md:before
+++ docs/05_BACKEND_LLD.md:after
@@ -1,4 +1,3 @@
-# Smart Wardrobe — Backend LLD v1.1
 # Smart Wardrobe — Backend LLD v1.1

 > **PoC A1 적용(2026-10-11):** [최신 기준 계약](handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.
--- docs/08_IMPLEMENTATION_PLAN.md:before
+++ docs/08_IMPLEMENTATION_PLAN.md:after
@@ -1,4 +1,3 @@
-# Smart Wardrobe Prototype — Codex 구현 명세 v1.0
 # Smart Wardrobe Prototype — Codex 구현 명세 v1.0

 > **PoC A1 적용(2026-10-11):** [최신 기준 계약](handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.
--- docs/IMPLEMENTATION_TRACEABILITY.md:before
+++ docs/IMPLEMENTATION_TRACEABILITY.md:after
@@ -1,4 +1,3 @@
-# Implementation traceability
 # Implementation traceability

 > **PoC A1 적용(2026-10-11):** [최신 기준 계약](handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.
--- docs/11_INTEGRATION_DECISIONS_v1.2.md:before
+++ docs/11_INTEGRATION_DECISIONS_v1.2.md:after
@@ -1,4 +1,6 @@
 # Smart Wardrobe 통합 설계 결정 기록 (ADR) v1.2
+
+> **PoC A1 적용(2026-10-11):** [최신 기준 계약](handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.

 - 확정일: 2026-10-09
 - 상태: **제품 정책 확정** / 기술 계약·마이그레이션·외부 인증 방식은 검토 대상
--- docs/12_FRONTEND_FSD_DRAFT_v0.3.md:before
+++ docs/12_FRONTEND_FSD_DRAFT_v0.3.md:after
@@ -1,4 +1,6 @@
 # Smart Wardrobe Frontend FSD — 통합 수정 초안 v0.3
+
+> **PoC A1 적용(2026-10-11):** [최신 기준 계약](handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.

 - 상태: **화면 동작 정책 반영 완료 / API 상세 계약 검토 대기**
 - 상위 결정: `11_INTEGRATION_DECISIONS_v1.1.md` (ADR-01~13)
--- docs/13_BACKEND_CHANGE_SPEC_DRAFT_v0.3.md:before
+++ docs/13_BACKEND_CHANGE_SPEC_DRAFT_v0.3.md:after
@@ -1,4 +1,6 @@
 # Smart Wardrobe Backend Change Spec — 통합 수정 초안 v0.3
+
+> **PoC A1 적용(2026-10-11):** [최신 기준 계약](handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.

 - 상태: **변경 방향 명세, API/DDL/Migration 적용 미승인**
 - 제품 의사결정: `11_INTEGRATION_DECISIONS_v1.2.md` (ADR-01~13)
--- docs/14_CONTRACT_CONFLICT_REVIEW_v0.2.md:before
+++ docs/14_CONTRACT_CONFLICT_REVIEW_v0.2.md:after
@@ -1,4 +1,6 @@
 # Smart Wardrobe 기존 계약 충돌·결정 대기 리뷰 v0.2
+
+> **PoC A1 적용(2026-10-11):** [최신 기준 계약](handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.

 - 날짜: 2026-10-09
 - 범위: 이번에 확정된 ADR-09~13에 직접 관련된 API/DB 계약 충돌 위주. 기타 모든 기능의 완전한 코드 감사가 아님.
--- docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/execution/02_AFTER_APPROVAL.md:before
+++ docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/execution/02_AFTER_APPROVAL.md:after
@@ -1,4 +1,6 @@
 # 승인 후 Codex 실행 지시서(분할 실행)
+
+> **PoC A1 적용(2026-10-11):** [최신 기준 계약](../POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.

 **주의**: 본 문서는 G1 승인 후에만 사용. 첫 실행에서는 이 페이지를 읽기만 할 것.

--- docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/execution/03_QA_MATRIX.md:before
+++ docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/execution/03_QA_MATRIX.md:after
@@ -1,4 +1,6 @@
 # QA / 수용 기준 매트릭스
+
+> **PoC A1 적용(2026-10-11):** [최신 기준 계약](../POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.

 | ID | 시나리오 | 통과 기준 | 전제 |
 |---|---|---|---|
--- docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/execution/04_P3_P10_AUTONOMOUS_EXCUTION.md:before
+++ docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/execution/04_P3_P10_AUTONOMOUS_EXCUTION.md:after
@@ -1,4 +1,3 @@
-\# Smart Wardrobe — G1 승인 / P3\~P10 자율 연속 실행
 \# Smart Wardrobe — G1 승인 / P3\~P10 자율 연속 실행

 > **PoC A1 적용(2026-10-11):** [최신 기준 계약](../POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.
--- docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/execution/05_P3_P10_REMEDIATION.md:before
+++ docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/execution/05_P3_P10_REMEDIATION.md:after
@@ -1,5 +1,4 @@
 \# Smart Wardrobe — P3\~P10 미완료 항목 시정 및 시연 완성 지시
-\# Smart Wardrobe — P3\~P10 미완료 항목 시정 및 시연 완성 지시

 > **PoC A1 적용(2026-10-11):** [최신 기준 계약](../POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.

--- docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/references/card/CARD_TEMPLATE_CONTRACT.md:before
+++ docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/references/card/CARD_TEMPLATE_CONTRACT.md:after
@@ -1,4 +1,6 @@
 # Smart Wardrobe — Editorial Outfit Card Template Contract
+
+> **PoC A1 적용(2026-10-11):** [최신 기준 계약](../../POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.

 - 계약 ID: `SW-CARD-TEMPLATE-001`
 - 상태: **설계 확정 / 구현·실증 미완료**
--- docs/integration_sources/09_SHOPPING_INTEGRATION_CHANGE_REQUEST.md:before
+++ docs/integration_sources/09_SHOPPING_INTEGRATION_CHANGE_REQUEST.md:after
@@ -1,4 +1,6 @@
 # CR-009 — 쇼핑몰 연동 기능 확장 명세 및 구현 변경요청서
+
+> **PoC A1 적용(2026-10-11):** [최신 기준 계약](../handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.

 - 문서 버전: v0.1 (검토안)
 - 작성일: 2026-10-09
--- docs/integration_sources/10_DB_IMPORT_AND_SHOPPING_INTEGRATION_DESIGN.md:before
+++ docs/integration_sources/10_DB_IMPORT_AND_SHOPPING_INTEGRATION_DESIGN.md:after
@@ -1,4 +1,6 @@
 # Smart Wardrobe — DB 초기 적재 및 쇼핑몰 연동 통합 설계서
+
+> **PoC A1 적용(2026-10-11):** [최신 기준 계약](../handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/POC_CONTRACT_A1.md)이 이 문서의 상충 조항보다 우선한다. 보유 코디 확정=착용1회, LED30초, 관심/혼합 VTON, 홈 미저장 PNG, 구매동기화 제외, 가이드 전용 케어 및 단계별 승인은 A1 기준이다. 아래 종전 정책/기술 경로는 상충 범위에서 이전 기준이며 현재 코드의 구현 완료를 뜻하지 않는다. A단계는 문서만 변경했고 B~G는 별도 승인 전 미착수다.

 - 문서 ID: INT-DATA-004
 - 버전: v1.0 (설계 결정안, 실행 전 검증 필요)
--- docs/06_OPENAPI.yaml:before
+++ docs/06_OPENAPI.yaml:after
@@ -1,4 +1,3 @@
-openapi: 3.1.0
 openapi: 3.1.0
 x-poc-stage-a:
   status: target-policy-not-implemented
--- docs/CONTRACT_REVISION_1_7.json:before
+++ docs/CONTRACT_REVISION_1_7.json:after
@@ -12,13 +12,13 @@
     "08_IMPLEMENTATION_PLAN.md": "47c2621054b6ea423ac871f586129e8986192bcb5128093bc6e01ac7e4d0ee12"
   },
   "current_sha256": {
-    "03_ARCHITECTURE_HLD_v1.1.md": "07962f34ce1b7bea389ba85cf396c7aaf5c5fb0b637bb5b022694fb542f46f5b",
-    "04_FSD.md": "137fcd54862894119896d2c676db89b8abaf6fd736b5c0a8d8b3266a9ce35d43",
-    "05_BACKEND_LLD.md": "05cc1483a6dd54207f6d70fe82c5c40eed2f271571b964831885a047e24a2c2c",
-    "06_OPENAPI.yaml": "c21094d779c4ea7afdc033054533fc331c6a80910a9ac20ccea737f07b842dcc",
+    "03_ARCHITECTURE_HLD_v1.1.md": "bc2da35a2ebdd29805798e9ee15c6ce64494d3475fd0304f64f26d5c31d5c1b4",
+    "04_FSD.md": "25f65541bbd5bd2e6ad671c403e37df35592455bd71a2184a8ca296ad7f810a1",
+    "05_BACKEND_LLD.md": "e1788c759369c815e300717c2bacd42ff9f745dc3f2d589139e89193425f60fa",
+    "06_OPENAPI.yaml": "881a0ed01d5a1daa101a1f24dd796f428659371c48143666fe4e0d61180c1086",
     "07_DATABASE_SCHEMA.sql": "79f5facd4c42b322b19cca244209cb95336a557234c2bd2a19c30156e9f26935",
     "07_DATABASE_SEED.sql": "a0cbd33d2461fe616ed4cfe0e2a81587ba571c7df9858bdf06612718bd1a6418",
-    "08_IMPLEMENTATION_PLAN.md": "48793ac8eb392cdc83ec2dcaa49b4aeeb9f7820c55317fcc1151beffffa0e5de"
+    "08_IMPLEMENTATION_PLAN.md": "c76e1e8a7be44f884bfbaaf1a6abf7bce6f383f17baae5afa408343cc5115b7e"
   },
   "amendments": [
     {
@@ -53,6 +53,30 @@
         }
       },
       "rationale": "Existing G1 FSD and additive integration API implementation documented, including demo personas, sessions, devices, LED and Mock shopping. Missing FSD mappings and integration request schemas restored. No endpoint behavior, legacy payload, DB schema or frozen baseline changed."
+    },
+    {
+      "id": "2026-10-11-PoC-stage-A",
+      "authorized_by": "User SMART_WARDROBE_STAGE_A_CONTRACT.md; documentation only, no implementation approval",
+      "base_head": "badf6f2",
+      "previous_current_sha256": {
+        "03_ARCHITECTURE_HLD_v1.1.md": "07962f34ce1b7bea389ba85cf396c7aaf5c5fb0b637bb5b022694fb542f46f5b",
+        "04_FSD.md": "137fcd54862894119896d2c676db89b8abaf6fd736b5c0a8d8b3266a9ce35d43",
+        "05_BACKEND_LLD.md": "05cc1483a6dd54207f6d70fe82c5c40eed2f271571b964831885a047e24a2c2c",
+        "06_OPENAPI.yaml": "c21094d779c4ea7afdc033054533fc331c6a80910a9ac20ccea737f07b842dcc",
+        "07_DATABASE_SCHEMA.sql": "79f5facd4c42b322b19cca244209cb95336a557234c2bd2a19c30156e9f26935",
+        "07_DATABASE_SEED.sql": "a0cbd33d2461fe616ed4cfe0e2a81587ba571c7df9858bdf06612718bd1a6418",
+        "08_IMPLEMENTATION_PLAN.md": "48793ac8eb392cdc83ec2dcaa49b4aeeb9f7820c55317fcc1151beffffa0e5de"
+      },
+      "current_sha256": {
+        "03_ARCHITECTURE_HLD_v1.1.md": "bc2da35a2ebdd29805798e9ee15c6ce64494d3475fd0304f64f26d5c31d5c1b4",
+        "04_FSD.md": "25f65541bbd5bd2e6ad671c403e37df35592455bd71a2184a8ca296ad7f810a1",
+        "05_BACKEND_LLD.md": "e1788c759369c815e300717c2bacd42ff9f745dc3f2d589139e89193425f60fa",
+        "06_OPENAPI.yaml": "881a0ed01d5a1daa101a1f24dd796f428659371c48143666fe4e0d61180c1086",
+        "07_DATABASE_SCHEMA.sql": "79f5facd4c42b322b19cca244209cb95336a557234c2bd2a19c30156e9f26935",
+        "07_DATABASE_SEED.sql": "a0cbd33d2461fe616ed4cfe0e2a81587ba571c7df9858bdf06612718bd1a6418",
+        "08_IMPLEMENTATION_PLAN.md": "c76e1e8a7be44f884bfbaaf1a6abf7bce6f383f17baae5afa408343cc5115b7e"
+      },
+      "scope": "A1 policy overlay; existing wire paths and schema unchanged"
     }
   ]
 }

```

추가 형식 정리: execution/04와05 문서의 기존 말미 빈 줄을 제거했다. 본문 정책은 추가로 변경하지 않았으며 최종 바이트 해시는 변경 목록 JSON을 따른다.
