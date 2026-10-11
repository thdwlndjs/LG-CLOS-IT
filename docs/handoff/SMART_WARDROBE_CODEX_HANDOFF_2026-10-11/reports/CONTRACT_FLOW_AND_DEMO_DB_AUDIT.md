# Smart Wardrobe 계약·사용자 플로우·시연 DB 감사 및 실행 제안

2026-10-11 · 조사 기준 `7f79161` · 브랜치 `feat/handoff-p3-p10`.

**현재 상태는 전체 기능 완수가 아니다.** 승인 에셋24개의 DB 연결과 개별 API 경로는 구현했지만, 전체 옷장 배치·시연 생활 데이터·홈 자동 추천 카드·명시적인 찾기 액션을 하나의 제품 흐름으로 완성하지 못했다. 착용/구매/케어 0건은 데이터 적재 누락이며, 단순 의류 선택의 LED 요청은 잘못된 구현이다. 환경 제약이나 유료 AI 부재가 이 문제들의 공통 원인은 아니다.

이번 작업은 읽기 전용 조사와 제안서 작성이다. 제품 코드·계약·DB·에셋을 변경하지 않았으며 원격 push·배포도 하지 않는다. 범위는 **로컬 격리 DB `wardrobe_test_remediation`**, API18081, 앱5193이다. 운영/클라우드 DB의 상태를 확인한 보고서가 아니다. DB 트랜잭션은 READ ONLY이며 브라우저 데모 인증 세션 외 제품 생성 요청을 실행하지 않았다. 단순 선택으로 발생한 LED POST는 가로채서 중단했다. 따라서 이번 조사에서 LED 점등 실행 성공을 새로 주장하지 않는다.

증적: [전체40개 테이블·컬럼·연결 요약](evidence/remediation/contract-db-audit.json), [실제 브라우저 재확인](evidence/remediation/contract-browser-audit.json), [실행 화면](evidence/remediation/contract-home-initial.png), [직전 보관 planner 진단](evidence/remediation/meeting-db-diagnosis.json). 스키마·데이터 조사 시각은 JSON의 captured_at을 따른다. 비밀번호·토큰·Signed URL은 증적에 포함하지 않는다.

## 1. 기존 계획과 확정 범위

기준은 `contracts/00_MASTER_CONTRACT.md`, `01_DATA_AND_PRODUCT.md`, `execution/04_P3_P10_AUTONOMOUS_EXCUTION.md`(저장소 실제 파일명의 오탈자 포함), 최우선 `05_P3_P10_REMEDIATION.md`, 이후 사용자 승인이다. 현행 FSD와 통합11~14는 기존 API/DB 동작을 대조하는 기준이다. 이전 문서의 pending 표를 이후 승인에도 그대로 적용해서는 안 된다.

| 원래 포함된 데이터 | 계약 근거 | 확정 수준 / 남은 정의 |
|---|---|---|
| 가구·가족4명·기기 접근·소유자 | DATA §2~3, MASTER I.1, G1 실행 계약 | 엄마 김수진42세·아들 최휘재27세 시연 확정. 아빠·딸 가족 구성 유지 |
| 실제 상품 근거와 합성 보유 의류 | DATA RULE-01 / §2 | 상품 사실과 시연 소유 구분 확정. 미확인 상품 사실·실제 구매를 임의 확정하지 않음 |
| 원본 이미지·행거/접힘 파생·버전·출처 | DATA RULE-01, P3/P4 | 승인 행거21·선반 샘플3 최종 승인. 샘플 승인은 전체 선반72벌의 상품-아이템 매핑 완료와 다름 |
| 옷장/외부 공간·슬롯·현재 위치·관측·이동 | DATA §2~3, MASTER I.8/I.12 | 합성 시연 위치 허용. 승인→실물 이동 완료→현재 위치 갱신 분리 확정 |
| 사용자 맥락·날씨·습도·캘린더·예보 | DATA §2~3, FSD REC-001, remediation §2/§5 | 합성 입력 허용 확정. 구체 시연 날짜·일정·예보·장소 값의 통합 manifest는 미완성 |
| 착용 경험·실제 착용·피드백·선택 | MASTER I.10, FSD HIST-002/REC-002, remediation §2/§5 | 합성 착용 이력 허용. 당시 맥락의 전체 필드와 시나리오별 건수는 계약/DTO에 모두 구체화되지 않음 |
| 세탁 상태·케어 계획·완료 | FSD CARE-002/003, remediation 합성 데이터 허용 표 | 계획≠실행 확정. 시연용 상세 케어/완료 데이터 미적재 |
| 쇼핑 PURCHASED·LIKED·일괄 등록·중복 방지 | 통합 지시 D, shopping design §구매/보유 구분 | Mock Provider 사용 확정. URL 수집/기존 보유 적재를 실제 구매 증거로 취급 금지. 현재 의류와 연결할 합성 구매 manifest 필요 |
| 추천 근거·규칙 버전·환경 스냅샷 | DATA §2~3, REC-002, STO-002/003 | 근거 재현/불확실성 표시 확정. 추천 이력은 기존 outbox 표현 재사용 가능 |
| VTON·카드·LED·에이전트 실행/실패 로그 | DATA §2, P4~P9 | Mock/실제 분리, 요청/결과 추적 확정. 유료 Decart·실물 장치는 별도 게이트 |

P2 `reports/DB_MAPPING_AND_SEED_PLAN.md`는 초기 적재에 이력 없이 시작할 것을 권고했다. 그러나 후속 시정 지시문은 **착용·세탁·날씨·습도·캘린더 합성 데이터를 허용**했고 계절 시연을 요구했다. 초기 상품/위치 시드에서 멈추고 생활 데이터 적재 단계로 확장하지 않은 것이 현재 누락의 원인이다. 후속 허용에도 불구하고 “승인을 못 받아서 이력0”이라고 설명하는 것은 맞지 않는다. 다만 구체 맥락 값/건수까지 이미 확정된 것으로 간주하지 않는다.

### 계약 조항과 기능 완료 기준

| 기능 | 기존 조항 | 완료 기준 |
|---|---|---|
| 찾기·확정 조명 | P4, QA WARD-03, MASTER I.10, 통합 지시 C | 실제 확정 슬롯만 점등, 자동 소등, 미확실/원격 차단. 최신 지시로 조회/선택은 무점등, 찾기/코디 확정만 실행 |
| 카드→VTON→복귀 | MASTER I.9, FSD VTON-004, P5/P9 | 동일 코디·프로필·진입 화면 상태를 보존하고 결과/실패/취소 후 복귀 |
| DB 옷장 | MASTER I.12, DATA §2, P3/P4 | 승인 전체 아이템/소유자/원본·파생/슬롯 FK가 Scene API와 실제 레이어에 일치; 위치 변경 반영 |
| 홈 추천 | FSD COM-002/REC-001/002, P5 | 현재 사용자 맥락과 보유 의류 입력, 후보2~3, 로딩/빈 결과/오류 및 진입점. 완성 PNG 표시·사용이력 UI 제거는 최신 지시 |
| 관리 | FSD STO-002/003, CARE-002/003, MASTER I.7/I.8, P8 | 실제 입력 근거의 제안, 여름 반출/겨울 회수/간절기 유지, 승인만으로 위치 변경 금지 |
| 쇼핑 | 쇼핑 설계09/10, 기존 통합 지시 D | 구매 전량 조회·검토 분리·멱등 등록·보유 연결, LIKED 보유/착용 미등록 |
| 선반·카드 시각 품질 | 승인 배치 REVIEW, P7, CARD A/B/C | 선반당2묶음×3벌 원본 원근/접점 유지. T1~T4 원본 복원+실제 이미지 치환+PNG 저장/조회 모두 통과 |

**수정할 계약 충돌:** MASTER I.11 및 III는 추천 시 카드 자동 생성을 금지하고 사용자 요청 시 생성을 규정한다. 최신 사용자는 홈 진입 추천을 완성 코디카드로 표시하도록 요구한다. 제안은 “홈용 미저장 프리뷰 PNG는 자동 생성/재사용 허용, 보관함 저장·공유는 명시적 요청, VTON 결과 자동 재료 사용 금지”로 예외를 명시하는 것이다. 이번에는 계약을 수정하지 않는다. 카드 초안 생성과 보관함 저장을 구분한 승인 후 기존 API의 초안/저장 상태를 재사용한다.

## 2. 현재 상태

### 실제 DB 적재 및 연결

한 가구의 격리 DB 전체40개 wardrobe 테이블을 읽었다. 아래 수치는 API/브라우저 QA가 누적한 행도 포함한다. **작업/감사 로그가 많다는 사실은 생활 이력이 구축됐다는 증거가 아니다.** 부모가구1개는 확인했지만 모든 로그를 개별적으로 합성 시드/QA 발생으로 라벨링한 상태는 아니므로 실제 고객 경험 로그라고 해석하지 않는다.

- 의류76: 기존52+승인24. 김수진20·최휘재43·아빠9·딸4. 모두 device_id·원본 image_asset_id 연결76/76, garment_state 위치76/76. AVAILABLE68/STORED8. 자신감>=0.8은76이나 이는 합성 시연 위치이며 실제 센서 실측 증거가 아니다.
- 화면은 행거21+선반3=24개. 위치 attributes 기준 visible 기본24, external11, hidden41. hidden41 전부가 위치 누락은 아니다. Scene의 표시 보류32는 승인되지 않은 기존 내부 subdivision 슬롯이며 닫힌 서랍/외부 수납은 의도된 비표시로 분리된다.
- Context13 전부 MOCK18°C. 일정 포함0, location_label0, is_holiday0. Outfit session40 중 context_snapshot_id 연결0. **맥락 테이블이 있어도 VTON/최종 선택 경험에 연결되지 않는다.**
- Feedback13 전부 ACCEPTED, rating0, changes 유의미한 값0. 이는 선택/종료 피드백이며 착용 후 만족도13건이 아니다.
- Wear0, shopping_import0, care_event/profile/schedule 모두0. 원래 상품 사진과 의류 원본은 존재하지만 구매·착용·케어 연결은 없음.
- 환경65, 의류 관측114(MOCK90/MANUAL24), 보관 action25(COMPLETED4/PROPOSED5/AWAITING_CONFIRMATION16), item308. 완료·미완료의 혼합 QA 상태이며 시연 시작상태를 안정적으로 구성하지 않았다.
- Outfit138/item390/card97/render97, VTON job27+external6, job155 모두 SUCCEEDED. 이는 파이프라인 실행 증거다. 카드 디자인 승인이나 홈 추천-카드 연결 완수를 증명하지 않는다.
- Outbox1170에 OutfitRecommended13, ContextCaptured13, 카드 생성/저장 각각97, 보관/이동/VTON 이벤트 존재. WearConfirmed·케어·구매 이벤트는 현재 없음. 원문 payload 전체를 공개하지 않고 event_type 집계만 증적에 기록했다.

전체 테이블 수량은 부록에 포함한다. 독립 product_reference/weather_forecast/calendar_event/agent_decision 테이블은 현재 없음. 계약은 개념 모델이므로 **테이블 부재 자체가 반드시 미구현은 아니다**. 상품은 garment.attributes, 맥락은 context_snapshot JSON, 판단/실행은 outbox/job/storage_action.reasoning으로 표현 가능하며 필요한 연결과 소비가 있어야 한다.

### 착용 당시 사용자 맥락 반영 수준

| 맥락 | 계약 | 실제 스키마·DTO·기록 | 현재 활용 / 부족 |
|---|---|---|---|
| 당시 날씨 | HLD §추천 입력, REC-001 | context_snapshot.weather JSON; ContextWeather 기온/습도/강수/condition. wear_event.context_snapshot_id | Context13는18°C 동일값. Wear0이므로 당시 날씨 연결0 |
| 일정·만나는 사람 | REC-001, HLD 입력 | schedule JSON; ContextSchedule(kind,starts_at,people) | 현재 schedule 전부 빈 배열. 수집 adapter가 Mock여도 [] 반환 |
| 장소 | REC-001의 위치 맥락 | context_snapshot.location_label/Context 응답 | capture 요청은 장소 입력을 받지 않고 INSERT에도 장소를 쓰지 않음. 현재 모두 NULL |
| 목적 | 일정 유형을 통한 추천 요구 | schedule.kind는 목적 일부 표현 가능 | 상세 목적 전용 필드/작성 UI/검증 규칙 없음. JSON 저장 가능성을 구현 완료로 보지 않음 |
| 선택 의도 | 세션 변경/최종 선택 추적 | outfit_session_event, feedback.changes JSON | 자유 의도/선택 이유를 받는 확정 DTO 없음. 현재13 feedback changes={} |
| 피드백 | REC-002, HLD 선택/취향 학습 | outfit_feedback(type,rating,changes), 세션 종료 ACCEPTED/MODIFIED | 선택 종료와 착용 후 만족도 구분 필요. 현재 rated0, 실착 후 피드백0 |
| 착용 시각·코디 스냅샷 | HIST-002 | WearConfirm(member,outfit,worn_at,method,optional session/context), wear_event.items_snapshot | API 및 테스트 구현 존재, 시연 DB0. 코디 확정으로 자동 생성하지 않는 것은 정상 |
| 장소·목적·의도의 추천 반영 | REC-002 캘린더/피드백 반영 | 현재 domain/recommendations는 기온·계절 constraint·theme·최근 wear·일부feedback·다양성 사용 | humidity/장소/people/자유 의도 직접 점수화 없음. 맥락 수집뿐 아니라 규칙 소비도 보강 필요 |

현행 WearConfirm DTO에 장소·목적·의도·실착 피드백이 모두 들어 있는 것이 아니다. 최소 확장안은 기존 context/session/feedback 연결을 먼저 사용하고, 표현되지 않는 사용자 의도 및 착용 후 피드백의 저장 위치·읽기 DTO·작성 경로만 계약으로 확정하는 것이다. 임의로 garment 필드를 늘리거나 JSON 아무 곳에 넣고 완료로 판정하지 않는다.

## 3. 계획 대비 누락 원인과 기능 분류

| 항목 | 현재 원인과 근거 | 분류 |
|---|---|---|
| 내 옷 선택 조명 | MirrorExperience.tsx selectGarment(514행 부근)가 상세 선택과 setIllumination+POST /integration/led-commands를 함께 수행. Scene hitbox와 내 옷 목록이 동일 callback 사용 | **잘못된 구현**. 조회 자체 자동 LED는 이번 브라우저에서 발견하지 않았고 선택에서1회 요청 확인 |
| 카드→입어보기 | MirrorOutfitWorkspace AI 입어보기→openLook→previewDraft→compare 경로는 존재. 하지만 완성 PNG 카드 단계를 필수 중간 화면으로 통일하지 않음 | **부분 구현·통합 누락**. VTON 전체 미구현이라고 볼 수 없음 |
| 복귀·맥락 | comparisonOrigin/library 복귀 코드 존재. ServerMockFitting은 source_screen OUTFIT_EDITOR 고정, session에 context_snapshot_id를 전달하지 않음 | **통합 누락**. 현재40 세션 모두 Context 미연결; 카드 진입점/선택/스크롤 복귀 추가 검증 필요 |
| 위치 확인 필요 | wardrobe_scene.py는 hidden 기존 subdivision을 SLOT_UNAPPROVED로 보류. WardrobeSceneLayers는 모든 blocked를 “위치·사진 확인 필요”로 뭉뚱그림 | **전체 매핑 누락+오해를 만드는 UI**. 76 위치 FK가 있으므로 전부 DB 위치0인 문제가 아님 |
| 초기 홈 | 실제 브라우저 MOCK 구성형3개. 실제 기록 전환 후 후보0, 자동 추천 POST0. MirrorHome은 기본 시나리오이며 서버 추천은 버튼 실행 | **통합 누락·홈 목표 미구현** |
| 완성 코디카드 | 저장 outfit에는 cardAsset 연결, 새 추천에는 없음. 상품 사진 composition fallback. 카드 자동 생성 금지 기존 계약도 존재 | **통합 누락+계약 변경 필요**. PNG 생성/저장 백엔드는 재사용 가능 |
| 홈 이력 UI | 실제 화면 사용 이력 영역 존재 | **최신 변경 요구 미반영**. 내부 추천 로그 삭제 대상은 아님 |
| 관리 추천 | 홈 기본 WEAR_PATTERN+ALL+dry_run. Wear0이라 기존 planner가 76개를 INSUFFICIENT_WEAR_HISTORY로 보류. WINTER 조건에서는 제안8개 생성 가능 | **시연 DB 누락+상황/정책 연결 누락**. 보관 엔진 부재가 아님 |
| 환경 기반 보관 장소 | DB environment65 존재하나 홈 습도·다음 주 예보 문구는 고정 시나리오. Context/forecast 입력과 화면 설명 불일치 | **데이터가 있지만 소비·표시 통합 누락** |
| 구매·LIKED | Mock Provider의 고정 상품 목록과 승인 옷장 상품이 별개. shopping_import0. 등록 경로는 새 의류를 만들지만 기존 승인 의류와 이미지/위치/Scene 연결 계획 없음 | **DB 연결 누락+시드/통합 누락**. LIKED 자동 보유 금지는 유지 |
| 케어 | care_profile/schedule/event0; 가이드 근거·예정·완료 시연 연결 없음 | **DB 누락**과 UI/API 소비 연결 필요 |
| 오른쪽 선반 | 실제 화면3개 샘플. 상단 folded 하단이 지지 선반보다 높고 빈칸 많음. geometry는 개별 샘플 box일 뿐 묶음 층/바닥 기준 없음 | **전체 배치 통합 누락·잘못된 접점 배치** |
| 판단/실행 로그 | outbox/job/storage 로그는 있으나 생활 맥락 연결이 빈 상태로 QA가 실행 | **시나리오 의미 연결 누락**. 감사 로그 생성 기능 미구현으로 분류하지 않음 |

선반 원 승인 계획 REVIEW는 D6+E24+F42=접힘72, 행거21로 가시93이다. 오른쪽은 E/F66이며 현재 오른쪽3개뿐이다. 상품 후보33개와 실제 의류93개는 다른 수량이다. 승인한 시각 구조는 유지하되 기존52에서 어떤 것을 각 선반에 재사용할지 먼저 확정 매핑해야 한다. 미확정 제품을 수량 채우기로 등록하지 않는다. 따라서 “부족한 숫자만 신규 생성”은 실행안이 아니다.

### 테스트가 통과해도 놓친 이유

1. 백엔드/계약 테스트는 권한·DTO·이벤트 분리·동시성·멱등·Job/PNG 저장을 검증했다. 이 성과는 유지할 가치가 있지만 시연 DB의 생활 데이터 수량과 관계가 충분한지는 별도 검증하지 않았다.
2. 이전 브라우저 E2E는 추천 버튼을 직접 누르고 생성/확정 경로를 실행했다. **처음 로그인→홈 자동 추천 카드**는 별도 조건이었고 누락됐다. 현재 그 조건으로 재확인하니 기본MOCK, 서버후보0이다.
3. 이전 테스트는 Scene 의류 클릭을 찾기 동작으로 취급해 점등을 정상으로 확인했다. 조회/선택과 명시적 찾기를 분리한 음성 테스트가 없어서 잘못된 사용자 액션 연결을 놓쳤다.
4. 승인24개 레이어 정합성을 확인했지만 전체 원본 배치93개/선반72개 및 바닥 접점 품질을 완료 조건으로 검증하지 않았다. 샘플 에셋 승인과 전체 배치 완료를 분리하지 못했다.
5. 카드 PNG 파일/저장/다운로드 성공은 Gate C에 해당하며 원본 레이아웃 Gate A, 실제 치환 Gate B를 대신하지 않는다. 현 인계도 A/B와 전체 E2E를 PARTIAL로 기록하고 있다.
6. 직전 browser.json은20 PASS+1 PARTIAL이고, 전체 작업은 부분 완료였다. “테스트 통과”를 “제품 전체 완수”로 해석할 수 없다. 현재 제품 목표를 만족하는 충분한 데이터/사용자 액션/시각 검수 조건으로 테스트를 확장해야 한다.

책임 있는 설명은 **기존 구현을 버릴 정도의 API 부재가 아니라, 승인된 전체 범위의 데이터 구축과 제품 수준 통합·검수까지 끝내지 못했다**는 것이다. 유료 Decart·실물 장치·운영 배포는 별도 외부 게이트이며 이번 문제를 해결하기 위한 선행 조건이 아니다.

## 4. 기존 구현을 재사용하는 실행 제안

아래는 승인 전 실행하지 않는 제안이다. P3/P4→P7→P5/P8/P9→P10 순서를 유지하며 새로운 파이프라인을 만들지 않는다.

### P3/P4: 시연 DB와 전체 Scene 연결

- 기존 approved_scene_manifest, live-data-mapping, garment.attributes.product_reference, image_asset_id 및 파생 asset metadata를 하나의 적재 manifest로 대조한다. 제품 사실/시연 소유/합성 경험/QA 발생을 명시적으로 구분한다.
- 각 아이템의 불변ID·제품·소유자·기기·현재 슬롯·원본/표시 에셋을 매핑한다. hidden 기존32개는 미확정 슬롯을 억지 점등하지 않고 승인 전체 배치로 연결하거나 의도된 보관 상태로 분리한다. blocked 이유별 안내를 표시한다.
- 시연 기준일을 고정하고 사용자 상황→Context→코디→선택 세션→실제 착용→피드백을 시간 순서와 FK로 만든다. 합성 착용은 명시적 합성 경험이며 코디 확정으로 자동 생성하지 않는다. 최근 사용/저사용/곧 필요한 일정/예외 의류를 포함하되 건수·기간·상황은 승인할 manifest에 제시한다.
- PURCHASED 합성 주문/line ID는 승인 보유 garment와 연결한다. 동일 구매 재실행은 기존 import/garment를 재사용하고 신규 물리 의류를 만들지 않는다. LIKED는 별도 목록·VTON 입력만 사용한다. 원본 상품 URL을 실제 주문 증거로 변환하지 않는다.
- care_profile의 확인된 근거, 예정 care_schedule, 수행 완료 care_event를 분리 구성한다. 미확인 케어 정보를 사실로 추정하지 않는다.
- environment_reading과 합성 예보/일정은 시각·단위·신선도·출처를 일치시키고 보관 proposal reasoning/outbox에서 참조한다. JSONB/기존 FK로 표현 가능한 범위는 migration 없이 활용한다. 의도/실착 피드백/예보의 부족한 DTO만 계약 승인 후 최소 확장한다.
- 선반은 원본 바닥 좌표·좌우2묶음·각3층·원근·그림자·앞뒤 가림 기준으로 기존 승인 접힘 에셋을 재사용한다. 같은 이미지 복제가 별개 상품 정체성을 허위로 표현하지 않도록 제품-파생 관계도 유지한다. 추가 제품/파생이 필요한 자리는 미확정으로 남기고 명세를 승인받는다.

**완수 조건:** 적재 전후/재실행 diff 및 기존52 보존, 중복 구매·아이템·이력0, FK/원본파생/현재위치 정합, 승인 전체 장면의 화면 개수 일치, 보관 변경이 DB→Scene→브라우저에 반영. 엄마/아들 동일 기기 조회와 다른 가구 차단. 착용/구매/케어뿐 아니라 당시 맥락 연결과 추천에서 실제 사용하는 값까지 검증한다. 수량만 채우지 않는다.

### P4: 찾기·선택·확정 분리

- selectGarment를 순수 상세 선택으로 바꾸고 조명/POST를 분리한다. 명시적 “내 옷 찾기”는 기존 LED endpoint, 코디 확정은 기존 확인된 슬롯 결과를 사용한다.
- 개별 의류/옷걸이 레이어만 선택 밝기1, 비선택0.4로 표현한다. 배경 감광/사각형 glow를 추가하지 않는다. 만료/프로필 전환/닫기 시 시각 상태를 정리한다.

**완수 조건:** 내 옷 조회·선택·상세 열기 LED0회, 찾기1회, 여러 의류 확정은 정확한 슬롯들만, 정상 밝기·60% 감광·자동 소등. 위치 불확실/외부매장 원격 요청은 실제 차단, 확인만으로 wear/planned-wear0증가.

### P7: 완성 카드와 VTON 진입점

- 현재 T1~T4 renderer/API/Job/MinIO/DB를 재사용하여 원본 복원 Gate A와 실제 선택 의류 Gate B를 완료한다. 템플릿을 하나의 평균 레이아웃으로 바꾸지 않는다.
- 카드 화면의 “입어보기”가 현재 코디ID/아이템 스냅샷/프로필/Context/진입 화면을 전달한다. ServerMockFitting의 고정 source_screen과 누락 context 연결을 보완한다. 홈/카드/탐색 출발점을 복귀 상태로 보존한다.
- 카드 asset도 기존 asset ID 기반 Blob cache/URL 만료1회 복구를 사용한다. 실패를 composition으로 조용히 대체해 카드 완성으로 보이게 하지 않는다.

**완수 조건:** T1~T4 각각 원본/실제 의류 비교 승인, PNG bytes→MinIO key→DB→재조회/다운로드 일치, 카드→Mock VTON→결과/취소/실패→동일 카드/선택 복귀. 같은 동작 재시도에 중복 Job/저장 없음. 유료 Decart는 별도 검증.

### P5/P8/P9: 홈·관리·쇼핑 통합

- 계약 예외 승인 후 홈 진입 시 실제 보유+현재 Context로 추천2~3개를 가져오고 기존 카드 draft/render 결과를 연결한다. 같은 입력/템플릿/이미지 버전은 재사용, 이전 프로필 결과가 새 프로필에 섞이지 않게 한다. 자동 draft와 사용자가 저장한 카드 목록을 구분한다.
- 홈 사용 이력 영역은 제거하되 착용/상황 입력과 개인화 로그는 유지한다. 로딩·오류·빈 후보를 명확히 표시한다.
- 관리 기본 WEAR_PATTERN+ALL 고정 대신 시연 상황의 계절/기간/환경 입력으로 계획한다. 일정/최근 착용 예외·간절기 유지·겨울 회수 근거를 실제 조회 값으로 보여준다. 과거 착용과 미래 예보를 혼합하지 않는다. 엄마 가족관리 권한과 아들 조회/실행 범위를 맞춘다.
- 보관 승인과 실제 이동 완료를 분리하고 완료 후 API 재조회로 옷장 위치·상태를 갱신한다. 쇼핑은 구매 목록/이미지/기존 보유 연결/검토 대상/LIKED의 실제 API 상태를 표시한다.

**완수 조건:** 신규 브라우저 세션에서 김수진→가족 관리 제안→승인(위치불변)→완료(위치변경)→최휘재→홈 카드→VTON→복귀→확정→찾기→카드 저장/다운로드까지 연결된다. 구매 재실행 무중복, LIKED 실행 후 garment/wear 증가0. 환경/일정/과거 경험 한 값 변경 시 근거 및 추천의 예상 변화/불변을 외부 기대값과 대조한다.

### P10: 검증 범위와 인계

- 실제 두 시연 프로필과 처음 진입 상태를 기준으로 실행한다. 단위/API 성공과 제품 E2E/시각 승인/외부 게이트를 별도 집계한다.
- 데이터와 같은 입력으로 기대값을 생성해 스스로 맞다고 판정하지 않는다. 승인 슬롯/상품 manifest, 원본 디자인, 부작용 전후 row diff를 독립 기준으로 사용한다.
- 기존 계약 검사(OpenAPI x-fsd-ids/문서 해시), 변경 기능 회귀, seed 재실행/복구, PNG/URL 실패, 권한/원격 차단을 수행하고 각 단계 증적을 갱신한다.

**최종 완료:** 승인 전체 에셋·데이터 연결, 실제 생활 맥락이 소비되는 추천/관리/쇼핑, 명시적 찾기/확정 조명, 완성 카드 및 VTON 복귀가 모두 실제 브라우저로 통과해야 한다. 파이프라인 테스트나 합성 픽셀 fixture만으로 완료를 선언하지 않는다. 운영 DB/유료 호출/실물 제어/원격 push·배포는 별도 승인 전 실행하지 않는다.

## 5. 계약 확정 시 필요한 명시사항

1. 홈 자동 **미저장** 카드 프리뷰 생성 예외와 기본 T1~T4 템플릿. 저장/공유는 사용자 요청 유지.
2. 실제 경험의 장소·목적·선택 의도·착용 후 피드백 표현과 기존 Context/session/feedback의 역할. 필수 입력을 늘리지 않고 모르는 값은 missing으로 유지.
3. 시연 기준일/과거 기간/예보·일정·환경과 착용·케어·구매 연결 manifest. 모든 값은 합성 여부와 시간/FK 일관성 검증 대상.
4. 승인 전체 선반의 기존 상품 재사용/미확정 제품 경계. 시각 배치 승인과 신규 보유 등록 승인을 구분.

LED의 단순 선택 무점등, 홈 이력 제거, 코디 확정≠착용, LIKED≠보유는 이미 최신 사용자 지시로 목표가 명확하다. 이를 다시 제품 선택사항으로 돌리지 않는다. 위 항목은 이번 제안서의 계약 확정 범위를 분명히 하기 위한 것이며 지금 구현을 실행하지 않는다.

## 부록: 격리 DB 테이블별 수량

각 테이블 컬럼과 상세 집계는 contract-db-audit.json에 있다. 아래는 현재 한 가구 격리 DB 전체 수량이며, 운영 DB가 아니다.

| Table | Rows |
|---|---:|
| access_station | 1 |
| account_credential | 4 |
| asset | 271 |
| audit_log | 2017 |
| card_render_job | 97 |
| care_event | 0 |
| care_profile | 0 |
| care_schedule | 0 |
| consent_history | 4 |
| context_snapshot | 13 |
| device | 1 |
| device_member | 4 |
| domain_event_outbox | 1170 |
| environment_reading | 65 |
| external_vton_job | 6 |
| garment | 76 |
| garment_observation | 114 |
| garment_share | 0 |
| garment_state | 76 |
| garment_tag | 0 |
| household | 1 |
| idempotency_key | 881 |
| job | 155 |
| led_command | 64 |
| lighting_zone | 85 |
| member | 4 |
| member_settings | 4 |
| outfit | 138 |
| outfit_card | 97 |
| outfit_feedback | 13 |
| outfit_item | 390 |
| outfit_session | 40 |
| outfit_session_event | 53 |
| shopping_import | 0 |
| storage_action | 25 |
| storage_action_item | 308 |
| storage_location | 89 |
| style_reference | 0 |
| vton_job | 27 |
| wear_event | 0 |

## 문서 검토 및 실행 경계

독립 cold-read는 핵심 제안 발췌문을 검토했으며 전체 파일이나 실행 사실을 별도로 재검증한 것은 아니다. 지적된 승인/수량/카드 상태 경계를 다음과 같이 명확히 한다.

- 76은 현재 보유 의류 레코드 수, 24는 현재 보이는 의류 수, 93은 기존 승인 배치안의 목표 가시 의류 수다. 93=행거21+왼쪽 접힘6+오른쪽 접힘66이다. 후보 상품 수33과는 다른 지표다. 전체 목표를 달성하기 위한 신규 의류 레코드 수는 아직 확정하지 않는다.
- 행거21·선반 샘플3 에셋과 전체 시각 배치 방향은 이미 승인됐다. 추가 상품 사실·개별 선반 보유 매핑과 생활 맥락 manifest는 이번 실행안에서 구체화할 대상이다. 이번 지시는 조사만이므로 알려진 결함 수정도 실행하지 않았다.
- “미저장 프리뷰”는 낮은 품질/미완성 그림이라는 뜻이 아니다. 실제 선택 의류로 생성된 완성 PNG이되, 보관함 저장 여부만 미확정인 상태다. 자동 초안 호출의 서버 상태 전이/보관함 노출을 현행 API와 대조해 승인된 계약에 명시한다.
- 카드 Gate는 템플릿4개 각각에 적용하는 A/B/C 세 단계다. 재실행 diff=0은 같은 승인 시드의 제품/보유/슬롯/경험/구매 연결 대상에 신규 중복이 생기지 않는다는 뜻이다. 인증·감사 조회 로그의 전체 DB 행 수가 영구적으로 같아야 한다는 뜻이 아니다.
- 장소·목적·의도·착용 후 피드백은 사용자와 확정할 계약 항목이다. 미정 값은 NULL/missing으로 남기며 저장 가능한 JSON이라는 이유로 사실을 채우지 않는다. 이미 표현 가능한 schedule.kind와 context/session FK는 재사용한다.

일관성 감사에서는 P2 초기 이력 없음 권고와 remediation 합성 이력 허용, MASTER 자동 카드 금지와 최신 홈 카드 요구를 확인해 이 보고서에 구분했다. 기존 계약 문서의 중복/충돌 자체는 수정하지 않았다. 검증 독립성 검토에서는 클릭=찾기라는 테스트 가정과 PNG 생성=시각 품질이라는 범위 오판을 확인하고 음성 액션 검증·원본 디자인·승인 manifest·행 변경 전후를 독립 기준으로 제안했다. 외부 시장/의학/가격 등 사실 주장과 이식성 주장은 없어 외부 factchk/이식성 검토는 적용 대상이 없으며, 프로젝트 수치는 실제 DB/브라우저 증적으로 확인했다.
