# Smart Wardrobe PoC 기준 계약 A1

2026-10-11 · 상태: **사용자 최신 정책 확정 / 구현 미실행**. A단계 결과물이며 B~G 실행 승인이 아니다.

## 권위와 적용 범위

최상위 근거는 [사용자 A단계 지시서](SMART_WARDROBE_STAGE_A_CONTRACT.md)의 최신 확정 정책이다. 이 문서는 그 정책을 요구 ID/상태/부작용/검증으로 전개한 PoC 기준이다. 우선순위는 **최신 사용자 명시 결정 → A단계 지시서/A1 → 수정된 MASTER 및 주제 계약 → 기존 FSD/OpenAPI/단계 계획**이다. 충돌 없는 기존 인증·기기/소유·권한·동의·원본/파생 에셋·원격 실물 제어 제한은 유지한다. 기존 운영/다른 프로필에 대한 정책을 일괄 변경하는 계약이 아니다.

원본 FSD/OpenAPI의 기존 endpoint/DTO는 실제 현재 구현의 호환성 기준이다. 새 PoC 행동은 아래 목표이며, A단계에서 존재하지 않는 endpoint/테이블이 이미 구현됐다고 주장하지 않는다. B~G에서 필요한 최소 변경 DTO/마이그레이션/오케스트레이션을 단계 증적과 함께 제시한다. MASTER의 구 H1.0 폐기 목록은 A1 변경사항에 적용하지 않는다.

## 정책 및 상태 규칙

- 보유76과 승인 왼쪽 행거21을 보존한다. 오른쪽 원본 밀도/접점 복원은 별도 보유-제품-표시에셋-칸 manifest로 검증한다. 접힌 한 벌마다 고유 garment_id이고 같은 칸에 여러 벌을 담을 수 있다. 화면의 개별 좌표와 실제 보관 칸/LED 구역을 구별하며 칸 capacity/동시성 검사를 유지한다. 기존 단일 슬롯 가정은 B에서 최소 변경 대조 대상이다.
- 사용자별 관심 ID는 보유 garment_id와 구분된다. 관심/보유 혼합은 시착 입력만 허용하며 관심을 자동 보유 등록하지 않는다. 구매 API·쇼핑 계정 연결·구매 동기화·결제는 PoC 제외다.
- VTON은 선택 draft, 실행 요청 snapshot, 화면 결과를 구별한다. 선택 변경은 요청/결과를 갱신하지 않는다. 실행 버튼만 immutable 요청 snapshot을 만들며 처리 중 버튼 중복은 차단한다. 생성 중 선택은 허용하며 결과에 요청 snapshot을 붙여 현재 선택과 혼동하지 않게 한다. 이탈은 임시 draft/result와 화면 세대 토큰을 초기화하고 이전 결과 유입을 차단한다. 저장 코디/영속 서버 Job 기록을 삭제하라는 뜻은 아니다.
- 관심 포함 시 확정/카드 버튼은 보이게 유지하고 실행 시 설명 후 종료한다. 성공/실패를 가장하거나 wear/card/outfit/LED 부작용을 일으키지 않는다.
- 이 PoC에서 보유 코디 확정/저장 카드의 ‘이 코디 입기’는 실제 착용 확인을 겸한다. 한 사용자 명시 확정 intent에 wear_event 정확히1개를 기록한다. 동일 intent 재시도는 재사용하고 새 명시 착용은 새 intent로 추가한다. member/outfit/time/context 및 items snapshot을 보존한다. 별도 평가/착용 확인 화면과 예정 기록을 자동 추가하지 않는다.
- LED는 알려진 내부 칸들의 집합만 동시에 점등,30초 후 소등. 다시 명시적 점등 요청하면 해당 칸 타이머를30초 갱신한다. wear 재시도 멱등성과 LED 타이머 갱신은 독립이다. 위치불명/외부 칸은 안내하되 알려진 내부 칸은 수행한다. 기존 외부매장→집 원격 실물 LED 차단은 유지한다. LED 실패/차단으로 이미 기록된 wear를 중복 생성하거나 삭제하지 않는다. 실패는 부분 실패로 알려주고 LED만 재시도할 수 있어야 한다.
- 홈은 사용자/그 사용자 기준일의 최초 방문에 실제 보유와 Context로 PNG2~3개를 준비하고 당일 재사용한다. 자동 렌더는 **홈 미저장 preview**다. ‘저장한 코디’ 갤러리에 들어가지 않고 착용 이력을 생성하지 않는다. 날짜 경계는 Context timezone을 따르고 다른 사용자 캐시 혼입을 금지한다. 삭제/권한 해제된 의류의 당일 캐시는 표시/사용 전에 유효성을 재검증하고 stale로 안내한다.
- 과거 합성 착용/날씨/일정/환경은 출처·시각·namespace로 실제와 구별한다. 소재/케어 등 미확인 상품 사실을 창작하지 않는다. 현재 Context와 과거 착용 Context/미래 일정·예보를 구별해 추천 근거로 연결한다.
- 홈 관리는 다가오는 일정의 회수 > 계절 보관/회수 > 장기 미착용 순으로 한 제안만 표시한다. 동순위 후보의 결정적 비교/근거는 E에서 명세와 fixture로 제시한다. 전체 목록은 관리 화면에 둔다.
- 이동 수락은 위치불변, 완료 시에만 원자 갱신. 진행 중 이탈은 미완료 실행을 취소하되 원 제안 유지; 이미 완료된 품목/위치의 rollback은 하지 않는다. 보관 action 상태와 제안 식별자는 취소 후에도 재실행 가능한 관계를 보존한다.
- 특별 관리 의류는 라벨/소재 가이드·권장 주기만 제공한다. 실제 케어 완료를 합성으로 생성하지 않는다. 기존 기록은 삭제하지 않는다.
- 명시 카드 생성은 보유 조합+사용자가 고른 T1~T4로 수행한다. 홈 자동 preview는 명시 저장 카드 예외와 분리한다. 네 레이아웃의 접힘/가림/광원 특징을 유지하고 원본 일치 시각 게이트를 PNG 저장 게이트와 구별한다. VTON 사진 자동 소재 사용 금지는 유지한다.
- 저장 카드 조회/재시착/공유/삭제 지원. 공유는 SNS 공유 시트 **목업**과 실제 PNG 다운로드/저장이며 실제 SNS 게시 성공은 주장하지 않는다. 카드 삭제의 결과/공유 링크 무효화/참조 보존은 F 기술 명세에서 확정하되 원본 의류와 wear 기록은 삭제하지 않는다. 저장만으로 wear 생성 금지.

## 요구사항 추적표

문서 열의 정책 번호는 A단계 지시서 ‘최신 확정 정책’ 번호다. T-*는 향후 독립 검증 ID이며 현재 존재하는 테스트라는 뜻이 아니다. 모든 행의 구현 상태는 기존 감사에 따르고 A단계에서 통과로 변경하지 않는다.

| ID | 문서/입력·상태 | 허용 동작·금지 부작용 | 코드/API/DB 영향 | 독립 테스트·완료 기준 | 단계 |
|---|---|---|---|---|---|
| POC-D01 | 정책1/보유76 | 기존 ID·원본·소유·왼쪽 보존 | garment/state/assets/provision | T-D01: 전후76 ID/출처 집합 보존, 무단 이동/삭제0 | B |
| POC-D02 | 정책1/오른쪽 칸·개별 garment | 원본밀도/바닥 접점, 1벌1ID, 칸 단위 | scene/geometry/location/lighting/capacity | T-D02: 승인 원본 비교, 중복ID0, API/DOM/manifest 일치 | B |
| POC-D03 | 정책1/사용자별 관심 | 관심 DB 사전 적재, 보유 ID 분리 | liked model/API/backendClient | T-D03: 두 사용자 가시성/권한·원본 이미지·재시드 무중복 | B |
| POC-D04 | 정책1/제외범위 | 쇼핑API·계정·구매·결제 실행 금지 | shopping/IntegrationActions 노출 | T-D04: PoC 진입점/네트워크에 제외 액션0 | B/G |
| POC-V01 | 정책2/보유·관심·혼합 | 모든 선택 아이템 입력, 관심 보유전환 금지 | fitting DTO/snapshot/job/provider | T-V01:3유형 입력manifest, IDs/asset 해시와 결과 대응 | C |
| POC-V02 | 정책2/선택변경 | draft만 변경, submit/결과갱신0 | Experience/Compare/picker | T-V02: 선택10회 요청0, 실행1회 snapshot 고정 | C |
| POC-V03 | 정책2/생성중 선택 | 선택 허용, 중복 실행차단 | busy/pending/journal/controller | T-V03: 연타1job, 선택후 늦은 결과는 요청snapshot 표시 | C |
| POC-V04 | 정책2/이탈·재진입 | 임시선택/결과 초기화, 늦은결과 차단 | endComparison/context generation | T-V04: 이탈중 완료→재진입 오염0 | C |
| POC-V05 | 정책2/관심포함 | 확정/카드 CTA 표시+안내, 부작용0 | UI guards/server validation | T-V05: 버튼 보임·안내, wear/card/outfit/LED delta0 | C/D/F |
| POC-W01 | 정책3/보유확정intent | wearer/outfit/time/context wear1 | confirm orchestration/wear/session | T-W01: 성공1, 재시도delta0, 새intent1 | D |
| POC-W02 | 정책3/저장카드 다시입기 | 새시점 wear1, 저장과독립 | saved look/confirm/wear snapshot | T-W02: 저장delta0→다시입기1→같은intent재시도0 | D/F |
| POC-L01 | 정책3/내부확실칸집합 | 동시점등/칸dedup/30초·갱신 | led_command/config/state/UI | T-L01: 복수칸·같은칸·30초·새요청갱신 | D |
| POC-L02 | 정책3/선택·찾기 | 선택점등0,명시찾기30초 | select/find/action routing | T-L02: 조회/상세/선택0, 찾기1 | D |
| POC-L03 | 정책3/외부·불명·원격 | 안내+알려진 내부만;원격실물차단 | locate/LED partial result | T-L03: 혼합위치 부분성공·외부0·wear중복0 | D |
| POC-H01 | 정책4/사용자·일자 | PNG2~3 최초준비/당일재사용 | home/recommend/cardpreview/cache | T-H01: 첫진입2~3PNG,재진입렌더0,갤러리/wear delta0 | F |
| POC-H02 | 정책4/상황·실착·보유 | 출처·시각분리/개인화 근거 | context/wear/feedback/rules | T-H02: 외부기대 fixture로 맥락변화/개인화 검증 | B/E |
| POC-M01 | 정책4/관리후보 | 순위1개 홈/전체 관리 | storage reasoning/ranking/UI | T-M01: 일정회수>계절>저사용,0건상태 안내 | E |
| POC-M02 | 정책4/수락·완료·이탈 | 수락불변/완료갱신/미완료취소 | action/item/movement/UI | T-M02: 단계별DBdiff,이탈제안유지,완료부분보존 | E |
| POC-M03 | 정책4/특별관리 | 가이드/주기만,실제완료조작금지 | care profile/UI | T-M03: 라벨근거·unknown·care_event delta0 | E |
| POC-K01 | 정책5/보유+선택T1~4 | 명시생성/PNG,선택변경생성0 | renderer/drafts/jobs/asset | T-K01:4독립원본GateA/치환B/PNG저장C | F |
| POC-K02 | 정책5/저장카드 | 조회/재시착/삭제,wear원본보존 | cards API/Workspace/delete | T-K02:재조회/삭제권한/재시착,원본/wear변동0 | F |
| POC-K03 | 정책5/공유 | SNS목업+실PNG 다운로드 | share sheet/ServerCardShare | T-K03: bytes/hash/decode,게시성공표시0 | F |
| POC-G01 | A실행게이트/전체 | 단계별독립검증·증적·승인 | trace/checkpoint/QA | T-G01:두프로필전체흐름·양성음성·미완료행0 | G |

## 확인된 기준 자료

- [승인 행거·선반 검수](reports/hanger-individual-v1/review.html): 패키지 경로는 자료 확인표에서 실제 위치를 검증한다. 잘못된 링크면 확인 필요로 남기며 새 시안 생성하지 않는다.
- [원본 배치 시안/원본 이미지 해시](reports/wardrobe-visual-review/REVIEW.md), [시안](reports/wardrobe-visual-review/proposal.html).
- [T1 원본](references/card/T1_reference.png), [T2](references/card/T2_reference.png), [T3](references/card/T3_reference.png), [T4](references/card/T4_reference.png), [템플릿 기술 계약](references/card/CARD_TEMPLATE_CONTRACT.md).
- [현재76 데이터/스키마 snapshot](reports/evidence/remediation/poc-status-db.json), [현재Scene24/DOM 대응](reports/evidence/remediation/poc-status-browser.json), [개별 의류 매핑](reports/evidence/remediation/live-data-mapping.csv).
- [기존 E2E](reports/evidence/remediation/browser.json), [기존 단계별 검증](reports/evidence/remediation/verification-results.json), [현재 구현 감사](reports/POC_IMPLEMENTATION_STATUS_AUDIT.md). 기존 결과를 새로운 A1 목표의 통과로 승격하지 않는다.

A단계 산출물: [충돌/변경 이력](reports/STAGE_A_ALIGNMENT_REPORT.md), [B~G 실행계약/게이트](execution/STAGE_B_G_EXECUTION_DRAFT.md). 질문 미응답은 승인으로 간주하지 않으며 A단계 이후 중단한다.

추가 차단 질문 Q-CD01: 생성 중 선택이 바뀐 뒤 결과가 도착한 경우, 확정/카드 CTA가 결과의 요청 snapshot을 대상으로 하는지 현재 선택을 대상으로 하는지 사용자에게 질문했다. 결과 자체는 요청 snapshot에 대응한다는 정책은 확정이다. 다만 후속 액션의 대상은 기존 자료로 명확하지 않아 임의 선택하지 않는다. C/D/F에서는 답변으로 정한 대상 snapshot을 CTA·관심 포함 검사·wear·LED·card 입력에 일관되게 적용하고, 표시 결과와 현재 선택을 조용히 혼용하지 않는다.
