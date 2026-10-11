# Smart Wardrobe B단계 구현·검증 보고

2026-10-12 · 기준 커밋 `6895603` · 브랜치 `feat/handoff-p3-p10`

**판정: PARTIAL. B단계 완료로 판정하지 않는다.** 데이터 보존·적재·권한·멱등성 검사는 통과했다. 오른쪽의 기존 의류 파생 에셋 35개가 원본의 측면 접힘 형태와 다르고, 위치 조회의 기존 슬롯과 Scene의 물리 칸 사이에 호환 바인딩이 남아 있다. C~G는 시작하지 않았다.

## 계약과 수행 범위

`6895603`의 최신 [POC_CONTRACT_A1](../POC_CONTRACT_A1.md), [실행 계약](../execution/STAGE_B_G_EXECUTION_DRAFT.md)의 Q-B01 및 POC-D01~04, H02 데이터 기반을 대조했다. 이번 사용자 지시가 B 실행 승인이고 C~G 승인은 아니다. 기존 보유 의류 76벌의 전체 garment 레코드, 소유 관계, 기존 state의 위치·상태, 기존 asset 레코드를 적재 전 스냅샷과 비교했다. 승인 행거 21벌의 이미지 파일·UI·좌표는 변경하지 않았다.

모든 DB 작업은 loopback PostgreSQL `wardrobe_test_remediation`에서만 실행했다. 운영 DB, 원격 push, 배포, 유료 API, 실물 LED는 실행하지 않았다. LED 검증은 기존 MOCK 명령의 칸별 anchor 중복 제거만 검사했다.

## 요구사항별 결과

| 요구사항 | 결과 | 실제 검증 및 잔여 사항 |
|---|---|---|
| POC-D01 / T-D01 | PASS | 원본 76개 ID와 전체 garment 행·기존 위치/상태 일치. 기존 asset 전체 행 해시 일치. 왼쪽 21벌의 승인 bounds와 실제 Scene 응답 일치, 관련 PNG·렌더링 컴포넌트 Git diff 없음 |
| POC-D02 / 개별 ID·물리 칸·수량 | 부분 PASS | 오른쪽 66개 고유 garment_id, 11칸 × 칸별 6벌, LED anchor 11개. Scene/DOM 87개(왼쪽21+오른쪽66), 중복0. 동일 칸 2벌 Mock 요청은 anchor1개로 귀결 |
| POC-D02 / 원본 시각 비교 | FAIL | 원본은 2묶음×3벌의 넓은 측면 접힘. 기존 35개 파생 이미지가 정면 접힘이며 세로 비율·여백 때문에 작게 표시됨. 승인 K1~K3 기반 31개도 원본의 밀도·묶음 간격을 완전히 재현하지 못함. 수량 검사로 시각 합격을 대체하지 않음 |
| POC-D02 / 위치 연결 | PARTIAL | DB scene_placement의 물리 칸 FK와 LED·Scene는 연결됨. 원본 state 보존을 위해 source_location_id 호환 바인딩을 사용. 일반 의류 상세/위치 안내는 기존 위치 이름을 유지하므로 모든 화면이 단일 물리 칸을 사용하는 상태는 아님 |
| POC-D03 / T-D03 | PASS | 김수진·최휘재 각각 관심3건, TOP/BOTTOM/OUTER. 상품 식별자·원본 사진·색상·카테고리 연결. 보유 garment와 별도 테이블·별도 UUID. 두 프로필 목록과 상대 항목 상세404를 실제 API에서 확인. 이미지 다운로드 확인 |
| POC-D04 / T-D04 | B 범위 PASS | PoC 통합 도구에서 구매 조회·일괄 등록 버튼 제거. 기존 Sprint API는 호환성 때문에 유지. B 브라우저 경로에서 구매·동기화·결제 호출0. 전체 G 시나리오 검증은 미실행 |
| POC-H02 / B 데이터 기반 | PASS | 각54건, 최근90일, 각 wear→outfit/items→Context 연결. 과거 weather/schedule/purpose/season 저장. 현재 합성 Context 각1개와 미래 일정 각2개. Context 조회 API에서도 과거/현재 합성 출처가 구분됨. 실제 추천·관리 판단 검증은 E 범위로 남음 |
| 재적재·참조 보존 | PASS | 시드2회 재실행 전후 관련13개 테이블 행 수·전체 행 해시 불변. 기존 코디·카드·VTON 삭제/초기화 없음. DB FK 적용 및 관심의 사용자/asset household 불일치0 |

## 데이터 수량과 출처

- 기존 보유 **76벌**, 추가 시연 의류 **28벌**, 합계 **104벌**.
- 오른쪽 기존 **38벌** 재사용 + 신규 **28벌** = **66벌**. 왼쪽 승인 **21벌**은 별도 보존.
- 오른쪽에 쓰지 않은 기존17벌: STORED OUTER8, AVAILABLE ACCESSORY8, AVAILABLE SHOES1. 이들의 데이터와 위치는 유지한다. 접힌 상·하의·아우터와 구분한다.
- 추가28벌은 승인 K1~K3 상품의 별도 합성 보유 인스턴스이다. 상품 사진·상품 사실을 새로 만들지 않았으며 고유 garment_id와 `stage_b_namespace`, `is_demo`, `source_garment_id`로 구분한다. 실제 구매나 사용자의 현실 보유 주장으로 기록하지 않았다.
- 관심6건은 검증된 기존 상품 메타데이터·원본 사진을 재사용한 **합성 관심 관계**이다. 실제 쇼핑몰 관심/구매 데이터 수집은 하지 않았다. 상품 ID는 source_product_id, 없으면 공식 URL, 그것도 없으면 명시적 demo-catalog 식별자를 사용한다.
- 착용108건, Context123건(기존13 + 과거108 + 현재2), 관심6건, Scene 바인딩66건. 코디248건(기존140 + 과거 경험 ARCHIVED108), 카드97건, VTON27건. 과거 코디는 추천 결과가 아니며 저장 코디 목록에 자동 노출하지 않는다.
- 기준시각은 **2026-10-12 00:00 KST**. 과거 Context는 `SYNTHETIC_PAST_EXPERIENCE`, 현재 Context는 `SYNTHETIC_DEMO_CURRENT`, `source_mode=MOCK`, `is_mock=true`. 현재 값도 실제 관측 날씨라고 주장하지 않는다. `source_status`를 기존 DTO가 읽도록 적재했다. holiday는 확인되지 않아 null로 유지했다.
- 용무는 schedule.purpose, 계절은 weather._provenance.season에 있다. 기존 Context DTO는 kind/starts_at/people만 schedule에 노출한다. 목적·계절을 이후 E 판단에서 읽는 연결은 E에서 검증해야 한다. 새 DB 필드나 추천 결과는 만들지 않았다.

초기 작업에서 재사용 범주를 TOP/BOTTOM으로 좁혀 추가36벌을 만들었던 오류를 발견했다. AVAILABLE OUTER8의 기존 파생 에셋을 포함하도록 고쳤다. 이번 B 작업에서 만든 참조 없는 복제본8개만 FK가 적용되는 트랜잭션으로 회수했다. 기존76개는 삭제하지 않았다. [회수 증적](evidence/stage-b/excess-fixture-rollback.json)에 대상 ID와 이유를 기록했다. 최종 멱등성 검증은 수정 후 104벌 상태를 기준으로 다시 실행했다.

## 변경 파일과 계약

- `backend/alembic/versions/0005_stage_b_data.py`: liked_item, scene_placement 추가. 기존 테이블·컬럼·데이터는 초기화하지 않음.
- `backend/app/application/wardrobe_scene.py`: 칸 바인딩, 복수 의류 렌더링, 명시 승인 geometry 검사, 250벌까지 조회.
- `backend/app/api/v1/integration.py`: 기존 위치 또는 유효 Scene 바인딩의 물리 칸으로 LED anchor 조회. 선택 시 조명 등 D 동작은 변경하지 않음.
- `backend/app/api/v1/shopping.py`: 사용자별 DB 관심 목록·상세 및 원본 사진 Signed URL. 상대 항목은404.
- `backend/app/schemas/handoff.py`: Scene total 상한100→250. geometry z_index 상한100 유지.
- `web/src/mirror/source/integrations/backendClient.ts`: 관심 이미지와 공식 상품 URL 연결.
- `web/src/mirror/source/IntegrationActions.tsx`: PoC 제외 구매 버튼2개 제거. 기존 서버 구매 API 제거 없음.
- `scripts/stage_b_seed.py`, `stage_b_verify.py`, `stage_b_idempotence.py`, `stage_b_compartments.py`: 격리 DB 적재·검증·Mock 칸 매핑 검사.
- `backend/tests/integration/test_stage_b.py`, `test_postgres_platform.py`, `web/test/stage-b-browser.mjs`: 독립 DB 권한/칸 검사, 새 Migration 검증, 실제 두 프로필 브라우저 검사.
- `docs/06_OPENAPI.yaml`: Scene 상한 및 additive 관심 상세 경로 반영. `CONTRACT_REVISION_1_7.json`에 이전 해시·승인 근거를 보존하는 amendment 추가. 다른 원본 설계 문서 변경 없음.

`scene_placement`는 garment PK, 원래 슬롯 source_location FK, 물리 칸 compartment FK, geometry, namespace로 구성한다. 원본 상품 asset과 옷장 파생 asset의 기존 구분을 유지한다. 새 garment의 brand/size 필수 필드는 도입하지 않았다.

## 실행 검증

- [DB/API](evidence/stage-b/db-api.json): 원본76, 왼쪽21, 오른쪽66, 관심 접근, Context 출처, 이미지 다운로드 검사 통과.
- [멱등성](evidence/stage-b/idempotence.json): 관련13개 테이블의 전체 행 내용까지 두 번 동일.
- [칸·Mock LED](evidence/stage-b/compartments-led.json): 66벌/11칸, 같은 칸 요청 중복 제거. 실물 LED 및 D의30초 정책 검증 아님.
- [브라우저](evidence/stage-b/browser.json): 각 프로필87개 고유 표시, 관심3개, 페이지 오류0. 홈·의류 이미지 decode 확인. 사용자 실물 이동·VTON·추천 생성·카드 생성은 실행하지 않음.
- [전체 백엔드 회귀](evidence/stage-b/backend-tests-final.txt): **297 passed / 새 B 테스트2 failed**. 두 실패는 테스트 fixture의 FAMILY 역할과 SQL JSON literal bind 오류였다. 수정 후 [집중 재검증](evidence/stage-b/backend-stage-b-retest.txt)은 **8 passed**, 해당 B 테스트2개·계약5개·DB baseline1개 포함. 전 스위트를 다시 단일 실행해299 pass라고 보고하지 않는다.
- [프론트 빌드](evidence/stage-b/frontend-build.txt) 통과, [단위 테스트](evidence/stage-b/frontend-tests.txt) **39 passed**, [Ruff](evidence/stage-b/ruff.txt) 통과. 번들 크기 경고와 pytest cache 경고는 남아 있음.
- 최초 전체 검사에는 Windows Temp 권한 오류13개가 있었다. 시스템 권한을 바꾸지 않고 작업공간의 새 `--basetemp`로 재실행해 해소했다. 최초 T2 renderer 일시 실패는 재실행에서 통과했다. 초기 관심 이미지 직접 다운로드는 다른 localhost:9000 MinIO로 향해403이었다. 검증은 앱과 동일한 격리19000 대상·서명 Host 보존 경로로 수정했다. 사용자 앱의 storage 계약을 변경하지 않았다.

## 원본 대비 화면과 미완료

원본: [wardrobe-base-led-off.png](../../../../web/public/assets/mirror-final/wardrobe-base-led-off.png)

실행 캡처: [김수진](evidence/stage-b/김수진-wardrobe.png), [최휘재](evidence/stage-b/최휘재-wardrobe.png).

35개의 기존 파생 에셋은 원본의 측면 접힘과 다르다. 원래 사진이나 승인 행거를 바꾸거나, 다른 상품을 같은 상품인 것처럼 표시하는 방식으로 우회하지 않았다. B의 시각 Gate는 미통과다. 칸별2×3의 원본 접점과 크기는 각 실제 제품에 대응하는 측면 접힘 파생 에셋을 확보한 뒤 맞춰야 한다. 유료 API를 호출하지 않았다.

Scene와 LED는 물리 칸을 공유하지만 기존 상세 위치/수용량 조회는 source 슬롯을 사용한다. 이 호환 바인딩을 전체 위치 조회에 일관되게 적용하는 B 잔여 연결이 필요하다. 현재 SLOT_UNAPPROVED 표시 보류7건도 유지하며 임의 좌표를 부여하지 않았다.

복구는 위 두 B 미완료 항목을 해결한 후 DB/API·브라우저·멱등성 증적을 갱신하는 순서이다. 추가28개의 인스턴스와 alias를 전체 삭제하는 초기화는 하지 않는다. Migration downgrade는 표시/관심 테이블만 없애고 합성 생활 데이터는 되돌리지 않으므로 일괄 복구 명령으로 사용하지 않는다. 수정 전에 참조 관계를 확인하고 namespace 범위로만 계획한다.

## 로컬 재현

프로젝트 루트 PowerShell:

```powershell
.venv/Scripts/python.exe scripts/remediation_local.py serve
# 별도 터미널: 기존 로컬 PostgreSQL/MinIO/Redis/renderer가 켜진 상태
.venv/Scripts/python.exe scripts/stage_b_seed.py
.venv/Scripts/python.exe scripts/stage_b_verify.py
.venv/Scripts/python.exe scripts/stage_b_idempotence.py
.venv/Scripts/python.exe scripts/stage_b_compartments.py
# 마지막 명령만 로컬 MOCK LED 명령을 생성한다.
```

프론트:

```powershell
$env:WEB_API_TARGET='http://127.0.0.1:18081'
$env:WEB_STORAGE_TARGET='http://127.0.0.1:19000'
$env:WEB_PORT='5193'
$env:VITE_HANDOFF_SCENE='on'
cd web
npm run dev
# 별도 web 터미널
node test/stage-b-browser.mjs
```

`http://127.0.0.1:5193` → 마이 → 김수진/최휘재 프로필 → 홈에서 오른쪽 배치 확인. 코디 → 스타일 보관함 → 쇼핑몰에서 개인별 관심 조회. 찾기·확정·VTON은 C~G 최종 동작으로 완료했다고 주장하지 않는다. 위치의 기존24시간 freshness 규칙은 유지되므로 오래된 관측을 현재 관측처럼 자동 갱신하지 않는다.

체크포인트는 [STAGE_B_CHECKPOINT](STAGE_B_CHECKPOINT.md)이며, 로컬 커밋은 완료 보고 메시지 및 Git log의 `feat(poc): add stage B demo data and compartment bindings`로 확인한다. C~G 및 원격 작업은 승인 대기다.

## 인계 검토

`sip`/`shower`의 독립 체크포인트 검토에서 PARTIAL과 C~G 금지는 명확하다고 확인했다. 기준 커밋이 작업 전 기준임을 명시하고, fixture 수정 후 집중 재검증과 전체 재실행을 구분하도록 보완했다. 실행 환경과 시각 판정 기준은 이 보고서를 참조한다.

`mandela` 점검에서는 시드가 만든 개수만 검사하면 시각 성공을 스스로 증명하는 오류가 생길 수 있다고 분리했다. 적재 전 행 해시·사용자 승인 manifest·원본 PNG·실제 브라우저를 별도 기준으로 사용했고, 수량 검사 통과에도 시각 FAIL을 유지했다. OpenAPI 검사는 구조 정합성 검사이며 사용자 플로우 합격 증거로 사용하지 않았다.

`ssotize`는 읽기 전용으로 계약·보고서·추적표·체크포인트를 대조했다. A 산출물의 과거 승인대기 문구를 현재 완료 상태로 해석하지 않으며 실행 상태는 이 보고서와 연결 체크포인트를 따른다. 기존 계약 통합·재작성은 하지 않았다. `re0`로 초기 수량을 최종104개와 오류 회수 내역으로 정리했다. 외부 시장·제품 안전성 주장과 도구 중립성 주장이 없어 이번 인계에서는 `factchk` 외부 조회와 `detool`을 적용하지 않았다.

## Local commit checkpoint

Implementation and evidence: `6f108ba` (`feat(poc): add stage B demo data and compartment bindings`). Base contract commit: `6895603`. Status remains **PARTIAL**. No remote push. Test log encoding and trailing whitespace were normalized without changing recorded outcomes.
