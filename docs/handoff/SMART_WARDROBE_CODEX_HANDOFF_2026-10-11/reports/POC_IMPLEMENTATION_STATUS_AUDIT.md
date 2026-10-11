# Smart Wardrobe PoC 구현 현황 감사

2026-10-11 · 기준 HEAD `1275d60` · 코드/계약/격리 DB/실제 브라우저 대조.

이번 지시의 PoC 요구를 판정 기준으로 사용하되 기존 계약과 충돌하는 정책은 따로 기록한다. 코드·DB·기존 설계/보고서·에셋을 수정하지 않았다. migration/seed/초기화/추천·VTON·카드·이동 생성 요청을 실행하지 않았다. 새 감사 보고서와 증적만 작성한다. 브라우저 인증은 데모 로그인 세션을 만들며, 선택에서 발생한 LED POST는 차단했다. “제품 DB 쓰기 없음”과 “인증 세션 등 어떤 부작용도 없음”을 혼동하지 않는다.

범위: 로컬 앱5193/API18081 및 `wardrobe_test_remediation` 격리 PostgreSQL. 배포·운영 DB에 관한 판정이 아니다. DB READ ONLY 스냅샷 시각은 [poc-status-db.json](evidence/remediation/poc-status-db.json)의 captured_at이다. 사용자/다른 로컬 작업의 누적 데이터가 있어 직전 감사와 일부 작업 로그 수량이 다르며, 이번 조사에서 발생시킨 작업으로 간주하지 않는다.

실행 증적: [브라우저/Scene 매핑](evidence/remediation/poc-status-browser.json), [초기 홈](evidence/remediation/poc-home-initial.png), [실제 기록 전환](evidence/remediation/poc-home-server.png). 김수진 프로필에서 홈·Scene·단순 선택만 재확인했다. 최휘재 전체 시나리오, 생성 중 선택, VTON 실행, 저장·공유·삭제·이동은 이번에 실행하지 않았다. 이전 실행 증거는 [browser.json](evidence/remediation/browser.json)에 있으며 20PASS/1PARTIAL이다. 과거 성공과 이번 실행 여부를 구분한다.

## 1. 기능별 구현 현황표

판정: **구현 완료**는 명시 범위의 실제 실행/데이터 근거가 있는 경우, **수정 필요**는 구현 또는 계약과 목표의 차이가 확인된 경우, **미구현**은 필요한 저장/경로가 없다고 확인한 경우, **확인 불가**는 코드가 있어도 실행 근거가 부족한 경우다.

| 항목 | 판정 | 근거 파일·함수·API | 실제 동작 | 확정 요구사항과의 차이 |
|---|---|---|---|---|
| 오른쪽 선반 배치·밀도 | 수정 필요 | approved_scene_manifest.json, WardrobeSceneLayers, GET /integration/devices/{id}/scene, wardrobe-visual-review/REVIEW | 이번 화면 K1~K3만 표시; 선반 바닥에서 떨어진 개별 접힘 샘플 | 원 승인 오른쪽 E24+F42=66벌의 2묶음×3층 미반영 |
| 표시 의류→garment_id 일대일 | 구현 완료 | Scene items/DOM data-scene-item-id, poc-status-browser.json | Scene24/unique24, DOM24/unique24, ID 집합 차이0 | **현재 표시24개 한정**. 전체 선반 및 보유76개가 표시됐다는 뜻 아님 |
| 원본/파생 에셋 매핑 | 수정 필요 | provision_wardrobe_sprites.py, 승인 manifest, asset.metadata, wardrobe_scene.py | 승인24 파생 사용, 기존 내부32는 승인 슬롯 부족으로 보류 | 전체 선반·기존 의류의 개별 제품/표시 에셋 매핑 미완성 |
| 기존 왼쪽 행거 유지 | 구현 완료 | approved-v1 A1~A7/B1~B6/C1~C8, 이번 화면 | 승인 행거21 레이어가 기존 좌표/옷장 배경에서 표시 | 승인된 현재 행거 유지 범위. 모든 원본 픽셀 완전 일치나 전체 조명 품질 신규 승인 뜻 아님 |
| 보유76 유지 | 구현 완료 | DB garment/garment_state | garment76/state76, AVAILABLE68/STORED8; 모두 location 연결 | 유지 수량은 충족. 전체 장면 매핑은 별도 미완료 |
| 사용자별 LIKED 사전 적재 | 미구현 | adapters/shopping.py LIKED, GET /integration/shopping/liked, DB schema | 공통 Python tuple1개 반환. style_reference0, shopping_import0; 사용자별 관심 저장 모델/row 없음 | 관심 의류를 DB에 사전 적재하라는 목표 미충족 |
| 보유/관심 데이터 분리 | 수정 필요 | backendClient.reload externalItems, core/externalOutfits.ts | 관심은 externalItems로 분리·garment 자동 생성 안 함 | 개념/UI 분리는 존재하지만 사용자별 DB 관계·이미지 분리가 미구현 |
| 보유만 VTON | 확인 불가 | ServerMockFitting.execute, POST /vton-sessions /vton-jobs | 보유 경로 코드와 과거 두 프로필 Mock 실행 증거 있음 | 이번 실행 안 함. 실제 Decart 품질/지원은 별도 게이트 |
| 관심만 VTON | 수정 필요 | ServerMockFitting.execute, LikedVton, shopping.py liked_vton | 현재 관심1개만 external_vton_job으로 실행하는 Mock 경로. 입력은 external_item_id/person만 | 관심 DB/이미지 없음; completeOutfit은 상하 또는 원피스 요구, 관심상의1개만으로 완성 조합 불가. 다중 관심 조합 불가 |
| 혼합 VTON | 수정 필요 | ServerMockFitting external.length 분기, POST /shopping/liked/vton-jobs | 외부1개가 있으면 보유 items를 요청에 보내지 않고 LIKED 단품 경로 선택 | 화면 혼합 선택을 전체 혼합 조합 시착으로 볼 수 없음 |
| 입어보기 실행시에만 결과 갱신 | 수정 필요 | MirrorExperience.replaceTop/selectedFromPicker→chooseMedia(allowExecution), draftChanged | 선택 변경에서 실행 허용 경로 및 결과/표시 초기화가 코드상 존재 | 실행 버튼만 작업/결과 갱신하도록 고정된 상태가 아님. Mock/실시간/준비영상 모드별 재검증 필요 |
| 생성 중 선택 허용 | 확인 불가 | MirrorCompare 상의 후보, MirrorOutfitWorkspace picker, ServerMockFitting.busy/current | 선택 UI는 작업 busy와 완전히 묶여 있지 않으나 일부 입력은 busy로 비활성 | 생성 중 실제 선택/불변 요청 스냅샷/이전 결과 처리 미실행. revision 변경 시 current() false로 busy 정리가 건너뛰어질 가능성도 검증 필요 |
| 중복 요청 방지 | 확인 불가 | pending ref, serverCommand running/journal, backend idempotent | 동시 중복 guard와 같은 key 재사용 코드 존재 | 이번 연타/선택변경/재시도 실행 없음. 전체 모드 정상 작동 단정하지 않음 |
| 이탈 시 임시 시착 초기화 | 확인 불가 | MirrorExperience.endComparison/navigate, fittingSession.stop | displayed/pendingDisplay/mockResult 초기화 코드 존재 | 요청이 끝난 뒤 결과 유입/초안 보존·임시 결과 범위의 실제 검증 필요 |
| 보유만 코디 확정 | 확인 불가 | confirmServerLook completeOutfit/hasExternalItems, backend outfit/session 권한 | 외부 포함 시 예외, 보유 FK로 확정 경로 | 과거 보유 확정 성공은 있음. 이번 관심 혼합 차단 안내/서버 우회 요청은 미실행 |
| 확정 시 착용 이력 생성 | 수정 필요 | secondHandoffActions.confirmServerLook, MirrorExperience.commit, wear_event0 | 현재 의도적으로 생성하지 않으며 문구도 ‘착용 기록 없음’ | 최신 요구와 기존 이벤트 분리 계약 충돌. 정책 변경 승인/명시 필요 |
| 해당 보관 칸 동시 점등 | 확인 불가 | integration.py led_command, confirmServerLook, led-state | 여러 garment_ids의 실제 슬롯을 서버 검증. 과거 보유 코디 확정 점등 증거 | 이번 실제 실행 안 함. 최신30초 및 착용 생성과 결합한 시나리오는 미검증 |
| LED30초 자동 소등 | 수정 필요 | config.led_off_seconds, remediation_local.py serve LED_OFF_SECONDS=10 | 현재 로컬10초. 과거10초 자동 소등 검증 | 30초 목표 미충족. 실물 장치 제어는 미검증 |
| 관심 포함 확정 불가 안내 | 확인 불가 | confirmServerLook hasExternalItems, MirrorCompare confirm | ‘보유 의류의 완성된 조합에서만’ 예외 코드 | 실 UI 혼합 조합 선택 후 안내 표시 미실행 |
| 사용자·일자별 홈 추천2~3 | 수정 필요 | MirrorHome, todayServerRecommendation, context/outbox | 초기 Mock 구성형3개; 실제 기록 진입 후보0/자동 요청0. 버튼 실행 코드는 limit3 | 사용자/날짜별 실제 초기 조회·재사용 정책 미완성 |
| 최우선 관리 제안1개 | 미구현 | MirrorHome storage.proposed_items/diagnostics, homeServerStorageAdvice | 고정 계절 시나리오 또는 제안 건수/보류 출력 | 실제 후보 우선순위1위 선정·단일 카드 표시 없음 |
| 이동 완료시에만 위치 변경 | 확인 불가 | sprint6.py, storage_worker, StorageMovePanel, storage_action | 승인/완료 분리 코드와 과거 브라우저 이동/DB 갱신 증거 | 이번 실행 안 함. 최신 시연 상황으로 승인 전후/완료/취소 재검증 필요 |
| 날씨·일정·착용 기반 추천 | 수정 필요 | context adapter, domain/recommendations, context_snapshot/wear_event | Mock기온·rule scoring 경로. Context13 일정0/장소0, wear0 | 입력 및 일부 소비 규칙 누락. 날씨/일정/경험이 모두 연결된 실제 개인화가 아님 |
| T1~T4/PNG 생성 | 수정 필요 | renderer card-layouts/server, sprint4, outfit_card97 | 과거4종 실제 PNG/MinIO/DB/download 성공. 원본 디자인 Gate A/B PARTIAL | PNG 생성 성공과 원본 복원 완료가 다름. 이번 생성 안 함 |
| 보유만 카드 생성 | 확인 불가 | backendClient.saveOutfit externalItems guard, saveServerCard, /cards/drafts, sprint4 | 보유 refs 검증, 외부 포함 경로 차단 근거 있음 | 이번 관심 단독/혼합 카드 차단 실행 안 함 |
| 카드 저장·재시착 | 확인 불가 | MirrorOutfitWorkspace saved library/AI입어보기, saveServerCard | 저장·다시 열기 코드와 과거 저장 증거 | 이번 재시착/원본 아이템 누락 상태 미실행 |
| 카드 공유 UI | 확인 불가 | ServerCardShare, POST /cards/{id}/save SHAREABLE | 저장 카드에서 공유 버튼/링크 표시 코드 | 이번 실제 링크 생성/유효성 확인 안 함 |
| 카드 삭제 | 미구현 | sprint4.py routes, MirrorOutfitWorkspace | 카드 DELETE API/연결 UI 없음 | 의류/style 삭제 API가 카드 삭제를 대신하지 않음 |
| 카드 저장·착용 확정 독립 | 확인 불가 | saveServerCard vs confirmServerLook, sprint4/sprint5 | 별도 명령. 과거 카드 저장 후 자동 착용0 검증 | 최신 확정→wear 생성 정책으로 바뀌더라도 카드 저장 단독은 wear를 생성하면 안 됨. 이번 실행 안 함 |
| 실제 쇼핑몰 API 제외 | 구현 완료 | adapters/shopping.py Mock Provider | 실제 쇼핑몰 호출 구현을 가정하지 않음 | 제외 기준 충족. 관심 사전 적재는 별개 작업 |
| 구매 동기화 제외 | 수정 필요 | shopping.py PURCHASED/bulk import, IntegrationActions | 현재 Mock 구매/일괄 등록 기능이 남아 있음 | 최신 PoC에서 제외. 신규 구매 동기화를 진행하지 않고 UI 노출/범위 정리 필요; 조사 중 삭제 안 함 |

## 2. 요구사항 충돌·누락

| 주제 | 기존 기준 | 이번 기준 | 처리 제안 |
|---|---|---|---|
| 확정과 실착 | MASTER I.10, FSD HIST-002, 기존 통합 지시: 확정≠실착 | 보유 코디 확정 시 착용 이력 생성 | PoC에서 ‘확정’이 실제 착용 확인인지 명시하고 기존 planned/session/wear 분리 정책과 API를 개정할 필요. 지금 임의 적용 안 함 |
| LED 시간 | 현재 로컬10초; 과거10초 QA | 30초 | 설정·자동소등 acceptance 변경. 단순 조회/선택 무점등 기존 최신 요구 유지 |
| VTON 관심/혼합 | MASTER owned-only 원칙은 후속 LIKED 예외로 일부 확대. 현재 외부1개 Mock 경로 | 보유만/관심만/혼합 | 외부 아이템 DTO·입력 스냅샷·권한을 PoC 계약으로 확정. 단품 작업을 혼합 성공으로 판정 금지 |
| 구매/생활 데이터 | 기존 PURCHASED Mock 및 구매 연결/적재 계획 | 실제 API·구매 동기화 제외, 관심 DB 사전 적재 | PURCHASED 구현 확대/구매 시드를 이번 PoC 필수로 계속 추진하지 않음. 기존 보유·경험 보존, 노출 범위 정리 |
| 홈 카드 | MASTER 자동 생성 금지 vs 이후 홈 완성 PNG 요구 | 이번 표는 추천2~3을 요구하며 기존 최신 카드 요구를 명시적으로 취소하지 않음 | 홈 PNG 자동 프리뷰 예외의 계약 결정은 여전히 남음 |
| 생성을 위한 선택 | 현재 일부 선택 변경→chooseMedia 실행 및 UI 초기화 | 선택 허용, 결과 갱신은 실행시에만 | draft/요청 입력/표시 결과를 분리하고 명시적 실행 액션에만 submit |
| 최우선 관리1개 | 기존 계절 제안/배치 이동 | 홈 최우선1개 | 우선순위·동점·보류 시 표시 기준을 계약으로 구체화 |

## 3. DB 스키마 및 실제 데이터

실제40개 테이블/컬럼과 전체 수량은 poc-status-db.json에 기록했다. 다음은 기능 관련 현재 수량이다.

| 범위 | 테이블/표현 | 실제 수량 및 연결 |
|---|---|---|
| 계정·기기 | household/member/device/device_member/member_settings | 1/4/1/4/4 |
| 보유 | garment/garment_state | 76/76, location76, AVAILABLE68/STORED8 |
| 관심 | style_reference, Python LIKED | style_reference0. 코드 공통1개이며 사용자별 관심 영속 모델/행 없음 |
| 원본/파생/결과 | asset | 271. 역할별 상세는 기존 감사 참고. 관심 API→externalItems.asset=null |
| 위치·환경 | storage_location/lighting_zone/environment_reading/garment_observation | 89/85/65/114. 공간 수가 가시 의류 수와 같다는 뜻 아님 |
| 맥락/실착 | context_snapshot/wear_event | 13/0. 전부MOCK, 일정/장소/휴일 데이터0 |
| 코디·선택 | outfit/item/session/session_event/feedback | 140/400/41/55/14. 선택 이력≠착용 이력 |
| 카드/렌더 | outfit_card/card_render_job | 97/97. 사용자 동작/QA 누적 수이며 템플릿 시각 승인 증거 아님 |
| 시착 | vton_job/external_vton_job/job | 27/6/155. 외부 작업 행은 관심 카탈로그 적재 행이 아님 |
| 보관 | storage_action/storage_action_item | 25/308. 제안/승인/완료 누적; 현재 위치는 garment_state |
| LED | led_command | 68. 이번 선택 요청은 abort해 신규 실행 안 함 |
| 케어/구매 | care_profile/care_schedule/care_event/shopping_import | 모두0. 구매0은 이제 제외 범위와 별도로 해석 |
| 이벤트/감사 | domain_event_outbox/audit_log/idempotency_key | 1173/2023/884. 실행 누적이며 경험 데이터 대체 아님 |

DB 확인 후 브라우저 인증 시점이 달라 감사/세션 로그 수가 늘 수 있다. 이번에는 DB 초기화·seed·migration을 하지 않았다. Signed URL/인증정보는 기록하지 않는다.

## 4. 수정 대상 목록과 단계 의존성 제안

수정 목록이며 지금 변경하지 않는다. 기존 정상 API/보유76/승인 행거를 재사용한다.

| 단계 | 수정 대상 파일·컴포넌트·API | 선행 조건 | 완료 검증 |
|---|---|---|---|
| A 계약 확정 | FSD/OpenAPI/PoC 결정 문서(승인 후) | 확정=실착 여부, 관심/혼합 DTO, 홈카드 정책, 관리 우선순위, 구매 제외 | 충돌 결정 기록과 액션/부작용/필요데이터/테스트 연결 |
| B 데이터·전체 배치 | 기존 provision/manifest, garment_state/asset metadata, wardrobe_scene.py; 관심 사용자 연결·이미지 모델/API 최소 확장 | A, 미확정 선반 상품 매핑 | 기존76 보존, 관심과 보유 분리, 전체 선반 배치/접점/ID 일대일, seed 재실행 무중복 |
| C VTON 상태·입력 | ServerMockFitting, MirrorExperience, MirrorCompare, fittingSession controller, shopping liked DTO/job/worker, backendClient | A+B | 보유/관심/혼합 각각 전체 입력 반영; 선택만으로 submit0; 생성 중 선택/연타/이탈 후 늦은 결과 차단 |
| D 확정·LED | confirmServerLook, integration led API/config, sprint5 wear 확인 경로 | A+B; C와 일부 독립 | 보유만 허용, 관심 안내, 계약상 실착 생성 정확히1회, 슬롯 동시점등/30초 소등, 카드 저장 단독 wear0증가 |
| E 홈·관리 | MirrorHome, homeServerActions, context adapter, recommendations/storage planner, StorageMovePanel | A+B, 카드 이미지 필요 시F | 사용자·일자별2~3, 맥락 근거, 최우선1, 승인 시 위치불변/완료시에만 변경 |
| F 코디카드 | renderer T1~T4, MirrorOutfitWorkspace, ServerCardShare, secondHandoffActions, sprint4 API/DB 상태 | A+B; PNG파이프라인 재사용 | A/B 시각 및 PNG C; 보유만 저장/재시착/공유/삭제; 착용 독립. 삭제 API는 계약 승인 후 추가 |
| G 통합 감사/QA | 기존 browser tests/evidence/checkpoint | B~F 완료 | 두 프로필 처음 로그인부터 실제 브라우저 E2E, 모든 양성·음성 조건과 미검증 외부 게이트 분리 |

B→C/D/F, B→E, F→홈 완성 PNG가 핵심 의존성이다. 구현 순서는 기존 P3/P4→P7→P5/P8/P9→P10 틀을 유지하고, 관심 DTO/확정 정책은 작업 전 A에서 먼저 확정한다. 실제 쇼핑몰 API·구매 동기화·운영 DB·유료 Decart·실물 LED·push/배포는 이번 구현 제안의 자동 실행 범위가 아니다.

## 5. 판정 한계 및 감사 완료

이번 직접 실행은 현재 데이터/화면/Scene ID 대응과 단순 선택 요청 확인에 한정된다. 생성·삭제·이동 등 쓰기 시나리오는 조사 제한에 따라 재실행하지 않았으며 코드만으로 완료 처리하지 않았다. 과거 성공은 그 시점/계약의 경로 증거다. 신규 PoC의30초·실착 생성·관심 DB·혼합 시착 성공으로 대체하지 않는다.

현재 기준으로 핵심 미충족은 전체 선반, 사용자별 관심 DB, 진짜 혼합 시착, 명시적 실행 상태 분리, 최신 확정/30초 정책, 초기 개인화 추천/최우선 관리, 카드 시각 품질/삭제다. 조사 보고서 제출 후 구현은 별도 계약 승인까지 대기한다.

검토 보강: ‘확인 불가’는 이 표에서 코드 부재가 아니라 **이번 조사에서 목표 조건을 실행 검증하지 못했다**는 뜻이다. 각 행에 과거 실행/현재 코드/이번 실행을 구분했다. 최신30초·확정 실착·구매 제외의 출처는 이번 사용자 「Smart Wardrobe — 구현 현황 감사 지시서」 §1.4/§1.7이며, 기존 자동 카드 금지의 출처는 MASTER I.11/III다. ‘수정 필요’는 최신 목표와 차이가 확인됐다는 판정이며 계약 개정을 지금 허가받았다는 뜻이 아니다. ‘실제 쇼핑몰 API 제외 구현 완료’는 **외부 호출을 사용하지 않는 제외 조건만 충족**했다는 뜻이고, 쇼핑 기능 전체 완료를 의미하지 않는다.
