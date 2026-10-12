# C단계 구현 및 검증 결과

기준 `a1e439b`, B-01 승인 `aed6b48`. C1~C6 Mock 흐름과 **사용자가 추가 승인한 C4 반응형 Scene 정합성 수정·검증은 PASS**다. C단계 최종 Mock 검증 완료로 판정한다. 최초 반응형 FAIL 증적은 이력으로 보존하고, 아래 후속 승인 수정 결과에 최종 PASS를 기록한다. 실제 VTON 시착 품질은 미검증이다. A1과 B-01은 유지하고 B-02는 DEFERRED다. D~G는 수행하지 않았다.

## 구현 결과와 요구사항 추적

| 단계 / 요구사항 | 구현 | 독립 검증과 완료 경계 |
|---|---|---|
| C1 / C-SLOT, POC-V01 | 6개 슬롯, 슬롯당 1개, 최대 6개 상한, TOP+BOTTOM 또는 DRESS, DRESS 충돌, 중복 kind/id, 이미지·원본 버전 검사 | 단위 10개 및 OWNED/LIKED/혼합 실DB 검증. DRESS는 격리 fixture만 검증; 시연 DB에 임의 등록하지 않음 |
| C2 / POC-V01~03, C-AUTH | POST/GET/cancel additive 경로, 기존 Job JSON Snapshot, Idempotency-Key, actor/context 중복 lock, 개인 LIKED·본인 인물·가족 기기 의류 권한 | 동일 key 동시 재전송 Job 1개, 다른 payload 409, 활성 context 중복 409, 타 사용자 조회/취소 404, 다른 기기 의류 및 타인 LIKED 차단 |
| C3 / C-MOCK | 모든 실제 원본 이미지 바이트의 크기·타입·SHA256 검증, typed Provider manifest, MinIO Mock PNG 저장 및 재조회 | 서로 다른 색의 인물/상의/하의 fixture를 독립적으로 저장소에서 읽어 worker 입력·순서·manifest 대조. 입력/동의 변경·취소·타임아웃 시 READY 결과 0 |
| C4 / POC-V02~04, V06 | selectionDraft, pendingRequest, displayedResult 분리. 생성 중 편집, 동기 중복 latch, 불명확 네트워크 같은 intent 재전송, 이탈 취소 및 이전 결과 차단 | 상태 테스트와 두 프로필 실제 브라우저. 선택만으로 Job 생성 0, 늦은 응답은 원래 요청 Snapshot, 실패 B는 표시 A 유지, 결과 이미지 오류가 새로운 Job을 자동 생성하지 않음 |
| C5 / POC-V05~06 | 마지막 표시 결과 기준 확정/카드 검사. LIKED 결과는 CTA를 유지하고 제한 이유 표시. 보유 결과는 Job/Snapshot 기반 D/F 인계 안내 | LIKED 결과+보유 draft 차단, 보유 결과+LIKED draft 결과 기준, 결과 없음 draft 대체 0. C에서는 실제 착용/LED/카드 API 호출 0; D/F 서버 구현의 PASS를 주장하지 않음 |
| C6 / C-REGRESSION | OpenAPI·해시·Ruff·타입/build·기존 VTON·B 및 작업 상태/워커 회귀, 두 프로필 브라우저, 기존 데이터/에셋 보존 검사 | PASS. 최종 215개 백엔드·계약/회귀 및 48개 프론트 테스트, 두 프로필 브라우저와 기존 데이터/시각 파일 보존. 실제 시착 품질은 별도 |

## 주요 변경 파일 및 DB/API

- `backend/app/schemas/poc_vton.py`, `api/v1/poc_vton.py`, `application/poc_vton.py`: 통합 요청 DTO, 서버 Snapshot, 접근 권한, 멱등 생성·조회·취소.
- `application/poc_vton_worker.py`, `domain/vton.py`, `application/inline_worker.py`, `workers/vton.py`: 검증된 실제 입력과 manifest, 통합 Job의 lease·timeout·결과 저장. 기존 ProviderRequest 인자 3개는 유지한다.
- `application/vton_worker.py`: 기존 timeout 처리에서 C Job 제외. 기존 보유/단품 LIKED 경로와 조회는 유지한다.
- `infrastructure/resources.py`: 기존 B migration `0005_stage_b_data`가 실제 DB head인데 readiness가 0004만 허용하던 오류 수정. 신규 migration 또는 schema 변경은 없다.
- `web/src/mirror/source/pocVton.ts`, `ServerMockFitting.tsx`, `MirrorCompare.tsx`, `MirrorExperience.tsx`: 불변 요청, 요청/결과 분리, 선택 중 생성, 실제 표시 결과 기반 검사, 임시 상태 정리. 기존 Blob 캐시와 1회 Signed URL 복구 재사용.
- `core/app.ts`, `MirrorOutfitWorkspace.tsx`, `mirror-compare.css`: 임시 draft만 정리, C UI 6개 슬롯, 입력 패널 경계와 결과 표시. 왼쪽 행거·오른쪽 shelf SVG/geometry/이미지 파일을 변경하지 않는다.
- `docs/06_OPENAPI.yaml`, `docs/CONTRACT_REVISION_1_7.json`: 세 개 additive 경로와 DTO, 기존 `x-fsd-ids` 및 POC ID 추적. 원본 CRLF 해시 규칙 유지.
- `backend/tests/unit/test_poc_vton.py`, `integration/test_stage_c.py`, `unit/test_free_cloud_runtime.py`, `web/test/poc-vton.test.mjs`, `stage-c-browser.mjs`, `scripts/stage_c_*.py`: 독립 검증, 격리 서비스 실행, 보존 검사, 체크포인트.

경로는 POST `/api/v1/integration/vton-jobs`, GET `/{job_id}`, POST `/{job_id}/cancel`이다. `job.request_payload.contract_version='poc-vton-c1'`로 식별하며 요청·Snapshot을 JSON에 저장한다. 결과는 기존 asset/result_ref에 연결한다. 기존 outfit FK에 LIKED를 넣거나 가상 보유 garment를 만들지 않는다. Snapshot에는 Signed URL이나 storage key·인증정보를 저장하지 않는다.

## 실행 검증과 실패 처리

초기 슬롯 단위 검증 10개, 초기 API/권한·멱등 검증 4개, worker까지 12개, 프론트 상태 검증 9개를 단계별로 실행했다. 전체 프론트 48개와 타입/build, 기존 VTON·B·계약 회귀 54개가 통과했다. 확대 회귀는 초기 `197 PASS / 1 FAIL / 13 ERROR`였고, OS 기본 임시 폴더 권한과 새 worker 단위 double 누락을 해결한 뒤 213개가 통과했다. OS 보안/권한 설정은 변경하지 않았다. 서로 다른 색의 입력 이미지·실제 deadline·게시 직전 입력 변경·B DB readiness·기존 단품 LIKED 경로와 C 워커의 분리 검증을 추가한 최종 확대 회귀는 **215 PASS / 0 FAIL / 0 ERROR / 0 SKIP**다. C 통합 테스트는 17개다. 별도 최종 계약/C 검증 29개도 통과했으며 전체 검사와 중복되므로 합산하지 않는다.

| 검증 | 최종 결과 | 증적 |
|---|---|---|
| 백엔드 unit·계약·C·기존 job/inline worker | 215 PASS | `evidence/stage-c/backend-regression.xml` |
| 프론트 상태·API·이미지 캐시 등 | 48 PASS, C 상태 9개 포함 | `web/test/poc-vton.test.mjs`, `npm test` |
| TypeScript 및 Vite build | PASS; 기존 500kB chunk 경고는 남음 | `npm run build` |
| Ruff / diff whitespace | PASS | 본 보고의 재현 명령과 로컬 실행 기록 |
| 김수진·최휘재 실제 브라우저 | 각 OWNED/LIKED/혼합/역방향 Snapshot, 생성 중 변경·이탈·프로필 전환 PASS | `browser-results.json`, 프로필별 PNG |
| PostgreSQL·MinIO 결과 | 실제 입력 bytes/hash, PNG 다운로드, 실패·취소·timeout READY 출력 0 | C 통합 테스트 및 XML |
| 기존 데이터·B-01 시각 | 기존 행 변경/삭제 0, 보유 의류 신규 0, 시각 파일 변경 0 | `preservation-before.json`, `preservation-after.json` |
| 로컬 readiness | DB·Redis·storage·renderer·worker 모두 OK | 실제 `/health/ready` 응답 |

브라우저의 race 검증은 실제 POST 응답을 잠시 지연했으며 대체 Job/이미지 응답을 만들지 않았다. 마지막 지연 요청은 실제 202와 서버 Snapshot을 기록하고, 화면 이탈 후 다른 프로필 로그인까지 수행했다. 각 프로필에서 정상 표시한 결과 4개와 이탈 중 응답한 요청 1개를 구분한다. 초기 브라우저 실패 캡처는 `failed-attempts/`에 남기며 최종 PASS 증적과 구분한다.

실제 브라우저에서 발견한 오류는 draft revision에 따른 컴포넌트 재마운트, React 개발 모드 cleanup에서 임시 draft를 삭제하던 문제, 입력 패널의 CTA 가림이다. key는 화면/프로필/draft ID로 고정하고, 실제 내비게이션 이탈 시에만 draft 정리를 실행하며, 결과 표시 시 입력 패널을 접는다. 단위 테스트의 PASS만으로 브라우저 PASS를 대신하지 않았다.

증적은 [stage-c](evidence/stage-c/)에 있다. 브라우저 데이터에는 토큰/인증정보/Signed URL을 기록하지 않는다. backend XML, 요청 Snapshot, 두 프로필 캡처, 보존 전후 해시를 제공한다. 기존 104벌(76+28), 착용 이력·outfit·card·LIKED·Scene·보관 칸 및 승인 시각 파일의 기존 행/파일 해시를 비교하고, C 테스트가 추가한 Job/결과 asset은 구분한다.

## 실제 시착 및 후속 게이트

**C Mock PASS는 실제 VTON 시착 품질 PASS가 아니다.** 출력은 처리 확인 PNG이며 사람에게 옷을 입힌 이미지가 아니다. 별도 [실제 시착 게이트 인계](STAGE_C_REAL_VTON_GATE_HANDOFF.md)에 공급자 입력 수용, 인증·비용·개인정보, 실착 품질, Snapshot 대응, 장애/취소 검증을 정리했다. 실제 Decart 호출 0, 실물 LED 0, 운영 DB 변경 0, 원격 push·배포 0이다.

B-02의 외부 10벌 Scene 중복과 상세/찾기/LED/수용량 정합성은 계속 DEFERRED이며 기능 PASS로 바꾸지 않았다. D/F의 실제 착용 확정·LED·코디카드 생성은 구현하지 않았다. C의 결과 검사/인계만 완료 대상으로 삼는다.

## 로컬 재현

기존 격리 PostgreSQL/MinIO/Redis/renderer가 실행 중인 상태에서 다음을 사용한다. `serve`는 DB 적재·migration을 수행하지 않는다.

```powershell
.venv/Scripts/python.exe scripts/remediation_local.py serve
cd web
npm run dev -- --host 127.0.0.1 --port 5193
node test/stage-c-browser.mjs
npm test
npm run build
```

루트에서 `.venv/Scripts/python.exe scripts/stage_c_tests.py backend/tests/unit backend/tests/contract backend/tests/integration/test_stage_c.py -q`로 격리 DB 테스트를 실행할 수 있다. 기본 tmp 권한 문제를 피하기 위해 테스트별 새 `test-results/stage-c-pytest-*` 경로를 사용한다. 기본 .env/운영 DB를 읽지 않고 기존 ignored 로컬 서비스 manifest를 사용한다.

수동 QA: 마이 → 김수진/최휘재 프로필 → 코디의 기존 카드 AI 입어보기 → Mock 피팅 → 업로드 동의 및 인물 사진 → 6개 슬롯 중 유효 조합 선택 → Mock VTON 실행. 생성 중 선택을 바꾸고, 결과 확인 후 확정/카드에서 결과 기준 안내 확인. 홈으로 나갔다 재진입하면 임시 결과/선택은 초기화된다. 실제 시착은 별도 승인 및 공급자 검증 이후 가능하다.

## 인계 및 로컬 커밋

구현 커밋은 `c072136` (`feat(vton): implement C-stage snapshot-aware mock flow`)이며 브랜치는 `feat/handoff-p3-p10`다. 결과 문서·증적은 후속 `docs(vton)` 커밋으로 남긴다. [체크포인트](STAGE_C_CHECKPOINT.md)를 기준으로 재개할 수 있다. 코드·문서·증적을 로컬에 커밋하고 사용자 승인 대기 상태로 중단한다. main 병합·원격 push·배포는 하지 않았다.

독립 cold read에서 실제 시착 게이트의 승인자·품질 PASS 기준·미지원 슬롯 처리·원본 변경 검사와 draft 편집의 차이를 확인했다. 승인자는 사용자로 명시하고, 미래 품질 판정 정책은 미확정으로 남겼으며, 원본 DB 변경 검사와 현재 선택 편집을 분리했다. 검증 독립성 검사에서는 모든 입력이 같은 이미지였던 초기 fixture를 서로 다른 이미지로 보완하고 저장소 원본과 worker bytes를 직접 비교했다. 실제 시착 품질을 Mock의 입력 통과로 대체하지 않았다. A1·실행 계약·API·최종 보고를 대조했으며 임의의 추가 제품 정책은 도입하지 않았다.

## C4 최초 감사 — 반응형 스마트미러 Scene 정합성 (수정 전 FAIL)

사용자 지시에 따라 제품·업무 데이터 변경 없이 실제 두 프로필의 화면 크기를 전환했다. 검사 세션의 로그인 인증만 수행했으며 제품 코드·CSS·의류/위치 등 업무 DB·에셋·기존 계약서는 수정하지 않았다. 보고서와 브라우저 증적만 추가한다. 기존 Mock 테스트 PASS를 반응형 Scene PASS로 확대하지 않는다.

| 점검 항목 | 판정 | 실제 근거 및 증적 |
|---|---|---|
| 모바일 옷장 시각 컨테이너 및 모든 의류·투명 에셋·오버레이 숨김 | **FAIL** | 두 프로필 모두 390×844, 667×375, 767×844에서 배경은 `display:none`이나 `.photo-db-scene`은 표시됨. 의류 87개·클릭 영역 87개가 남음. SVG 투명 파생 에셋과 상태 오버레이가 함께 숨겨지지 않음 |
| 숨겨진 레이어의 미러 가림·클릭 가로채기 차단 | **FAIL** | 모바일 미러 영역의 12×12 표본 중 41점에서 Scene이 최상위 hit target. 390×844에서는 홈·옷장·코디·마이의 중앙 hit-test 및 실제 Playwright 클릭 모두 실패. 667×375에서는 마이를 제외한 세 메뉴 실패. 767px에서는 메뉴 클릭은 통과했으나 41점의 Scene hit target은 남음 |
| 데스크톱 B-01 승인 화면 및 복귀 보존 | **PASS** | 1672×941 전환 전/후 두 프로필의 87개 garment_id·표시 영역·클릭 영역·filter 완전 일치. B-01 커밋 `aed6b48` 이후 `PhotoWardrobeStage.tsx`, `WardrobeSceneLayers.tsx`, 원본 geometry 및 `web/public/assets` 변경 없음. 기존 B-01 승인과 C 보존 증적에 더해 실제 전환 후 캡처 확인 |
| 두 프로필 실제 브라우저 크기 전환 | **수행 PASS / 기능 FAIL** | 각 desktop1672 → portrait390 → landscape667 → mobile767 → desktop768 → desktop1672. 프로필별 garment_id 중복/변경 없음, JS 오류 0. 두 프로필에서 동일 모바일 결함 재현 |

### 증적과 재현

- [실측 JSON](evidence/stage-c/responsive-scene-audit/results.json): 조상 포함 유효 표시 상태, 모든 Scene 자식, 의류·클릭 영역, 미러 rect, hit-test, 메뉴 클릭 결과, 전환 전후 ID/geometry를 기록했다. Signed URL·토큰은 기록하지 않았다.
- [김수진 모바일](evidence/stage-c/responsive-scene-audit/김수진-mobile-portrait.png), [최휘재 모바일](evidence/stage-c/responsive-scene-audit/최휘재-mobile-portrait.png): 미러 위에 행거·선반 에셋이 남는 실제 캡처.
- [김수진 데스크톱 복귀](evidence/stage-c/responsive-scene-audit/김수진-desktop-after.png), [최휘재 데스크톱 복귀](evidence/stage-c/responsive-scene-audit/최휘재-desktop-after.png). 같은 폴더에 각 프로필의 전환 전 및 667/767/768px 캡처도 제공한다.
- 기존 `web/test/responsive-browser.mjs`와 `test-results/responsive-browser.json`은 구형 6벌 화면에서 `.photo-background`와 `.photo-led-layer`를 검사했다. DB Scene·SVG·투명 파생 에셋·hit button 검사가 없고 현재 87개 Scene에 대한 증적도 아니므로 이번 요구의 PASS 근거로 사용할 수 없다.
- API mutation 기록은 프로필별 `/integration/demo-login` 1회뿐이다. Job·의류·착용·LED·카드·이동 API의 변경 요청은 없었다.

재현은 프로젝트 루트에서 `node docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/evidence/stage-c/responsive-scene-audit/audit.mjs`를 실행한다. 기존 로컬 API 18081과 웹 5193이 필요하다. 이 감사 스크립트는 실패를 JSON의 FAIL 상태로 기록하고 제품 파일이나 DB 시드를 수정하지 않는다.

### 원인 및 승인 대기 최소 수정안

`mirror-responsive.css`의 767px 이하 숨김 대상은 `.photo-background`, `.photo-led-layer` 두 개다. `PhotoWardrobeStage.tsx`에서 DB 기반 `WardrobeSceneLayers`가 별도 sibling으로 추가되었지만 숨김 규칙에 포함되지 않았다. `.photo-db-scene` 부모의 `pointer-events:none`도 자식 버튼의 명시적 `pointerEvents:auto`를 막지 못한다(`WardrobeSceneLayers.tsx`의 hit button). 87개 실제 에셋을 적재한 상태의 반응형 검사 및 클릭 hit-test가 기존 테스트에서 누락됐다.

권장 제품 수정은 **`web/src/mirror/source/mirror-responsive.css` 한 파일의 기존 모바일 미디어 규칙에 `.photo-db-scene { display:none; }`를 포함**하는 것이다. 부모를 숨겨 그 하위 frame·SVG/image·투명 에셋·상태/조명 표현·hit button을 함께 제거하고, 중앙 `.photo-mirror`와 거울 배경 효과는 유지한다. 미러까지 포함하는 `.photo-wardrobe`/`.photo-stage` 전체를 숨기거나 개별 의류 opacity만 낮추는 방식은 사용하지 않는다. DB·에셋·geometry·데스크톱 규칙·B-02·LED 정책 변경은 필요하지 않다.

최초 감사에서는 **767px 이하** 모바일 Scene 유효 표시/클릭 영역 0, 미러 hit-test Scene 0, 실제 내비게이션 클릭 성공, desktop87개 ID·좌표·필터 복귀 일치, 거울 배경 효과 및 프로필/화면 상태 보존을 승인 후 기준으로 제안했다. **768px은 데스크톱 Scene 표시를 유지하는 경계 검사**로 구분했다. 당시 수정은 실행하지 않고 사용자 승인을 기다렸으며, 이후 명시적 승인에 따른 결과는 다음 절에 기록한다. D~G는 시작하지 않았다.

## C4 후속 승인 수정 — 반응형 Scene 검증 PASS

사용자는 `mirror-responsive.css` 한 파일의 부모 Scene 숨김 수정을 승인했다. 제품 수정은 기존 `@media (max-width: 767px)`의 숨김 선택자 목록에 **`[data-display-mode="mobile"] .photo-db-scene,` 한 줄을 추가**한 것이 전부다. 숨김은 해당 Scene 하위 요소에만 적용하며, 자식 87개를 개별 제어하지 않는다. `.photo-wardrobe`/`.photo-stage` 전체나 중앙 거울을 숨기지 않는다. 중앙 미러 코드·기존 거울 배경 규칙과 DB·API·Snapshot·VTON·에셋·geometry·데스크톱 스타일은 변경하지 않았다. 미러 안의 일반 상품 사진과 기능 UI는 숨김 대상이 아니다.

| 승인 검증 항목 | 판정 | 실제 결과 |
|---|---|---|
| 두 프로필 390px 모바일 Scene 및 클릭 영역 숨김 | **PASS** | 김수진·최휘재 모두 `.photo-db-scene` 유효 표시 없음, Scene 자식/의류/클릭 영역 표시 0개. DOM의 87개 ID는 유지되며 부모 숨김만 적용 |
| 가림 및 이벤트 가로채기 없음 | **PASS** | 각 모바일 미러 12×12 표본의 Scene top target 0/144. 이전 41/144에서 0으로 감소. 실제 네비게이션 버튼 중앙 hit-test 모두 통과 |
| 홈·옷장·코디·마이 정상 이동 | **PASS** | 두 프로필에서 실제 클릭 성공 및 `data-screen`이 home/wardrobe/outfit/my로 변경됨을 각각 확인 |
| 모바일 → 데스크톱 복원 | **PASS** | 390/667/767px 모바일에서 모든 Scene 표시·hit 0. 768px 및 1672px 데스크톱은 의류 87개·hit 87개 정상 표시. 두 프로필에서 복귀 후 ID·표시/클릭 rect·filter 일치 |
| B-01 승인 배치 및 시각 유지 | **PASS** | 수정 전 감사 증적의 1672×941 geometry와 수정 후 초기/복귀 geometry 일치. 기존 왼쪽 및 오른쪽 옷장 영역의 캡처 픽셀 차이 각각 0. 중앙 미러의 시간/콘텐츠는 픽셀 비교에서 제외 |
| 관련 프론트 회귀 | **PASS** | `npm test` 48 PASS / 0 FAIL / 0 SKIP. `npm run build` TypeScript·Vite 통과. 기존 500kB chunk 경고는 동일하며 이번 수정 범위에서 제외 |

실행 크기 순서는 각 프로필에서 **1672×941 → 390×844 → 667×375 → 767×844 → 768×844 → 1672×941**이다. 실제 이미지 decode와 브라우저 렌더링을 확인하고 JS 오류 0건을 기록했다. 제품·업무 데이터 변경 요청은 없으며 검사 인증용 demo-login만 각 프로필 1회 수행했다. 첫 브라우저 시도는 프로필 화면 대기에서 시간 초과됐고, 검증 스크립트 보완 중 한글 문자열 인코딩 문제도 발생했다. 해당 시도를 PASS로 처리하지 않았으며 UTF-8 원문/Unicode escape로 검증 도구를 정리한 최종 실행에서 두 프로필의 모든 항목이 통과했다. 추가 제품 수정은 없었다.

증적:

- [최종 실측 JSON](evidence/stage-c/responsive-scene-fix/results.json)
- [데스크톱 geometry 및 픽셀 비교](evidence/stage-c/responsive-scene-fix/desktop-comparison.json): 1672×941 이미지의 왼쪽 `(0,0)-(700,941)` 및 오른쪽 `(980,0)-(1672,941)` 영역을 수정 전/후 동일 조건에서 비교. 두 프로필의 초기/복귀 모두 변경 픽셀 0.
- [김수진 390px](evidence/stage-c/responsive-scene-fix/김수진-mobile-portrait.png), [최휘재 390px](evidence/stage-c/responsive-scene-fix/최휘재-mobile-portrait.png)
- [김수진 desktop 복귀](evidence/stage-c/responsive-scene-fix/김수진-desktop-after.png), [최휘재 desktop 복귀](evidence/stage-c/responsive-scene-fix/최휘재-desktop-after.png). 같은 폴더에 각 크기의 캡처를 보존한다.
- [재현 스크립트](evidence/stage-c/responsive-scene-fix/verify.mjs): 프로젝트 루트에서 `node docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/evidence/stage-c/responsive-scene-fix/verify.mjs`. 로컬 API 18081·웹 5193 필요.

**C4 반응형 추가 완료 게이트를 PASS로 변경한다. C단계 최종 Mock 검증은 완료이며 실제 시착 품질 게이트는 계속 별도다.** 기존 백엔드 215 PASS는 이전 C 검증 기록이고 이번 CSS 수정에서 백엔드 테스트를 재실행했다고 주장하지 않는다. 수정 파일과 문서·증적을 함께 로컬 커밋에 남기고 이번 작업을 종료한다. 원격 push·배포는 하지 않으며 D~G 착수는 별도 사용자 승인 대기다.


## C-2 FitRoom: 2026-10-12

See [C-2 implementation and zero-cost evidence](C2_FITROOM_IMPLEMENTATION_REPORT.md). Existing C Mock completion remains valid. Actual supplier calls: 0. Real fitting quality remains unverified. B-02 remains DEFERRED; D-G, remote push and deployment were not performed.
