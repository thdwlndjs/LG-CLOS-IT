# P3–P10 시정 작업 결과

2026-10-11 · 브랜치 `feat/handoff-p3-p10` · 시작 커밋 `1fffbeb`.

**전체 판정: PARTIAL.** 실제 상품 사진 52개, 격리 DB 기반 옷장, 엄마·아들 추천/VTON/PNG 저장, 겨울 보관·회수는 실행했다. T1–T4 사진 치환 결과의 접힘·가림·부피가 참조 원본에 충분히 대응하지 않아 시각 Gate A/B를 완료로 판정하지 않는다. 계약 검사에도 기존 문서 정합성 실패 2건이 남아 있다.

## 적용 계약과 기존 결과의 차이

최우선 기준은 `execution/05_P3_P10_REMEDIATION.md`다. 이전 G1/P10의 UNKNOWN-only 위치 처리와 최소 데이터 해석을 시정하여, 4인 가족의 합성 데모 위치·환경·계절 맥락을 명시적으로 구성했다. 실제 상품 원본 정보와 합성 소유/계절/위치/사용 맥락은 분리했다. 실측 슬롯·실제 가족 구매·실제 착용 기록이라고 주장하지 않는다. 기존 P10 보고서는 과거 증적으로 보존하며 현재 상태는 본 보고서와 `REMEDIATION_CHECKPOINT.md`를 따른다.

운영 DB, 원격 push/merge/배포, 유료 Decart 호출은 수행하지 않았다. 기존 팀원 원본·설계 문서를 덮어쓰지 않았다. 작업은 기존 기능 브랜치 및 별도 `wardrobe_test_remediation` DB에서만 수행했다.

## 계약별 결과

| 범위 | 결과 | 실제 근거 및 한계 |
|---|---|---|
| 최소 51개 데이터 | PASS | 실제 사진 52개, 엄마18/아들25/아빠5/딸4. 초기 내부35/외부8/소품9 |
| 원본 메타데이터/사진 | PASS, 재배포 권리 미확정 | 51개 Patagonia Worn Wear 공개 공식 카탈로그와 Dr. Martens 공식 PC11 1개. 원본 해시/모델/색상/출처 보존 |
| 소유자·카테고리·계절·상태·위치 | PASS, 데모 맥락 | DB 4인·52개. 계절/소유/위치/환경은 합성. 착용 완료 기록은 0개 유지 |
| clean plate/동적 scene | PASS, 데모 시각화 | 원본 옷장 기반 빈 배경, A–F 이미지 좌표와 G 닫힌 서랍/신발함. DB 위치와 실제 이미지 ID로 렌더링 |
| 찾기/Mock LED | PASS | 화면 의류 클릭→해당 DB 슬롯만 강조/Mock LED→10초 자동 소등. 임의 슬롯 생성 없음 |
| 보유 의류 추천/복귀 | PASS, Mock 맥락 | 접근 가능한 가족 옷장 중 AVAILABLE만 사용, 추천3개, carousel 선택→VTON→동일 선택 위치 복귀 |
| LIKED VTON | PASS, Mock | 별도 쇼핑 Mock 항목으로 실행. 보유52개 및 착용0 유지 |
| 계절 보관·회수 | PASS | 승인 시 위치 불변, 명시 완료 시 DB 위치 변경, 회수 품목 scene 신규 표시 |
| T1–T4 원본 복원 Gate A | PARTIAL | 문구 제거 복원/빈 바닥/독립 레이아웃 확보. 가려진 부분은 생성 복원이며 개별 원본 접힘·레이어 완전 복원 아님 |
| 실제 의류 치환 Gate B | PARTIAL | 실제 원본 픽셀을 SVG 마스크로 표시. 곡선 접힘·소매 방향·미세 occlusion/부피가 원본과 다름 |
| 카드 저장 경로 Gate C | PASS, 로컬 | React→Playwright PNG→private MinIO→DB 저장→재조회/다운로드. 엄마·아들 각4개 신규 카드 검증 |
| 실제 Decart/실물 LED | 미검증 | Mock 검증과 분리. 유료 호출 승인/하드웨어 별도 인수 게이트 |

## 데이터와 이미지 증적

정본 매핑은 `../templates/remediation_products.json`이다. 각 항목에 상품명/모델/색상/URL/소유자/카테고리/합성 계절·위치와 원본 SHA256, MIME, 크기, SVG 마스크를 기록했다. 기존 PC01–PC11 조사와 이전 검증 DB는 보존했다. PC11은 공식 1461 Smooth Black 제품 사진을 추가 확보했다. PC01–PC10과 PC12/13의 막힌 사진 또는 불명확한 변형은 임의로 생성하지 않고 실제 사진이 검증된 대체 제품을 사용했다. 이들은 동일 모델·색상 대체라고 주장하지 않는다.

공식 [Worn Wear 카탈로그](https://wornwear.patagonia.com/products.json?limit=250)는 이번 수집 시 HTTP 200과 실제 제품 사진을 제공했다. [Worn Wear 사이트](https://wornwear.patagonia.com/)의 전환 안내와 별개로 공개 카탈로그 접근을 확인했으며 현재 구매 가능성을 보증하지 않는다. 사진은 중고 개별 매물이며 새 제품이나 실제 가족 구매의 증거가 아니다. [Dr. Martens PC11](https://www.drmartens.com/us/en/1461-smooth-leather-oxford-shoes-black/p/11838002)은 공식 CDN의 실제 768×768 PNG를 검증했다. 소재/케어가 확인되지 않은 항목은 null로 유지했다. PC12 공식 현재 변형은 PBSU이며 BLK로 추정하지 않았다. PC13 이전 URL의 제품/색상 변형도 확정하지 않았다.

원본 사진은 gitignore된 `test-results/remediation/source-images/`에 보관한다. `web/public/`에서 제거하여 향후 웹 빌드에 원본 사진이 자동 공개되지 않게 했다. 다운로드가 사용·재배포 허가를 뜻하지 않는다. 현재는 공개 배포 없는 로컬 검증이며 상업/외부 공유 권리는 미확정이다. 비교 캡처·생성 카드 역시 원본 사진을 포함하므로 원격 공개 전 권리 확인이 필요하다.

동의→업로드 intent→private S3 PUT→SHA256 finalize 경로로 52개 READY 사진을 등록했다. `evidence/remediation/data-integrity.json`에서 원본/DB checksum 및 새 Signed GET의 다운로드 해시 **52/52 일치**를 확인했다. DB에는 Signed URL이 아니라 에셋 연결을 유지한다. SVG 마스크는 외부 연결 흰 배경의 벡터 경계를 계산하며 원본 래스터를 수정하지 않는다. 자동 경계의 흰 테두리/세부 누락은 수동 시각 검토 대상이다.

반복 이동 QA 후 현재 내부33, 두번째 방10, 소품 서랍8, 신발함1이다. 초기35/8/9와 현재 위치를 혼동하지 않는다. AVAILABLE44/STORED8, 착용0, 용량 초과 없음. 저장 카드는 반복 QA 누적으로44개이며 최종 브라우저 실행은 각 계정4종의 **새 카드 ID**만 성공으로 인정했다.

## 시각 증적

![엄마 계정 동적 옷장과 추천](evidence/remediation/mom-home-51-images.png)

캡처 파일명의 `51`은 초기 명명이며 실제 검증 수량은52다. 옷장과 중앙 미러의 원래 비율을 유지했다. 슬롯은 이미지 기반 데모 분할이며 실제 측정·물리 수용량의 증거가 아니다. D/E/F 높이는 선반 목재를 가로지르지 않도록 참조 픽셀 기준으로 조정했다. G 닫힌 서랍/외부 위치는 scene에 거짓 가시 품목으로 그리지 않는다.

| 카드 | 원본→생성 복원→빈 바닥→등록 사진 PNG 비교 | 남은 차이 |
|---|---|---|
| T1 | [비교 캡처](evidence/remediation/T1-comparison.png) | 원본 가방/굽은 니트와 실제 선택 모자/펴진 상의의 형태·겹침 차이 |
| T2 | [비교 캡처](evidence/remediation/T2-comparison.png) | 아우터 소매 접힘·상의 가림·바지 부피 재현 부족 |
| T3 | [비교 캡처](evidence/remediation/T3-comparison.png) | 원본 햇빛 바닥은 복원했으나 의류 자체 접힘·광원 반응은 부족 |
| T4 | [비교 캡처](evidence/remediation/T4-comparison.png) | 원본 스웨트/가방 occlusion과 실제 상품 외곽/주름 차이 |

`remediation_card_manifest.json`에 원본/복원/배경/실제 PNG 해시와 Gate별 판정을 기록했다. `remediation_generated_assets.json`에는 image_gen 출처·생성 영역·해시가 있다. 이전의 CSS multiply 방식은 천이 바닥에 비치는 오류가 있어 제거하고 불투명 원본 픽셀+SVG clip으로 수정했다. `evidence/remediation/T*-v1.png`는 이전 시도이며 최종 결과는 `mom-T*-v1.png`, `son-T*-v1.png`다. 과거 synthetic-test 증적은 시작 커밋의 원본으로 복원했다.

## 실제 브라우저 12단계

정본은 `evidence/remediation/browser.json`이다. 최종 17개 assertion 그룹 통과, page error0/HTTP 실패0. 외부 네트워크 요청은 브라우저 route guard로 차단했다.

| 단계 | 증적 | 판정 |
|---|---|---|
| 1 엄마 로그인/가족 공유 | mom-home-51-images.png, browser.json | PASS, 4인52개 |
| 2 실제 사진 scene | mom/son-home-51-images.png | PASS, 현재33개 가시 |
| 3 UI 의류 찾기 | mom/son-find-led.png | PASS |
| 4 슬롯/Mock LED/자동 소등 | browser.json | PASS, 10초 |
| 5 겨울 제안 | mom-winter-proposal.png | PASS, 합성 맥락 |
| 6 승인/완료 분리 | browser.json | PASS |
| 7 DB 위치/scene 갱신 | mom-storage-completed-scene-refreshed.png, mom-winter-retrieved-scene.png | PASS |
| 8 보유 추천 | mom/son-home-51-images.png | PASS, 각3개 |
| 9 보유·LIKED VTON | mom/son-owned-mock-vton.png, mom-liked-mock-no-owned-or-wear.png | PASS, Mock |
| 10 복귀/코디 선택 | browser.json | PASS, carousel 선택 위치 유지 |
| 11 T1–T4 선택/생성 | mom-card-templates.png | 기능 PASS, 시각 PARTIAL |
| 12 PNG 저장/재조회/다운로드 | mom/son-T1~T4-v1.png | PASS, 신규 DB 카드/실제 PNG |

초기 실패는 `browser-failure.json`에 남겼다. 로그인 비동기 대기, scene hit pointer-events, 테스트 버튼 이름, 승인 후 item 상태를 실제 계약에 맞춰 수정했다. 회수 항목은 PENDING과 AWAITING_CONFIRMATION 둘 다 허용하고 현재 source 위치를 대조한다. 실패를 무시하는 우회나 기존 카드로 신규 생성 성공을 대체하는 검사는 사용하지 않는다.

## 테스트 및 계약 정합성

| 실행 | 결과 |
|---|---|
| `python scripts/handoff_checks.py` | 실 PostgreSQL backend279 PASS, 718 deprecation warnings |
| web `npm test` | 35 PASS |
| renderer `npm test` | 5 PASS, 임의 외부 URL/unsafe SVG 거절 포함 |
| web `npm run build` | TypeScript/Vite PASS, 기존 chunk>500KB 경고 |
| Ruff backend/시정 스크립트 | PASS |
| openapi-spec-validator, docs/06_OPENAPI.yaml | PASS |
| contract suite | **8 PASS / 2 FAIL** |
| 시작 커밋1fffbeb 별도 worktree contract suite | **7 PASS / 같은2 FAIL** |

실패1: 문서 추가 operation에 `x-fsd-ids`가 없어 FSD inventory 추적 검사 실패. 실패2: 기존 CONTRACT_REVISION_1_7 기록 해시와 현 문서 해시 불일치. 둘 다 별도 baseline worktree에서 재현한 기존 문서 정합성 결함이다. 이번 작업의 optional `SceneItem.image_mask`는 별도 검사로 null 기본값/비필수/객체 타입을 확인하고 기존 필수 wire 계약을 계속 전수 대조한다. 계약 전체 성공으로 보고하지 않는다. 원본 문서 해시를 현 상태에 맞춰 자동 갱신하여 실패를 숨기지 않았다. 로그는 evidence/remediation의 backend-regression.log, contract-current.log, contract-baseline.log에 있다.

DB 신규 컬럼/Migration은 없다. 기존 JSON metadata/attributes를 사용한다. API 변경은 scene의 비필수 `image_mask`뿐이며 legacy 클라이언트는 무시할 수 있다. 저장/추천/동의/업로드/LED/이동 API와 필수 필드는 유지한다. 대규모 SVG mask metadata의 응답 크기는 후속 최적화 대상이다.

## 주요 변경 파일

- `scripts/remediation_catalog.py`, `remediation_local.py`, `remediation_evidence.py`: 원본 frozen manifest/해시 검증, 격리 데모 seed·업로드·서버, 읽기 전용 증적.
- backend `application/wardrobe_scene.py`, `card_worker.py`, `schemas/handoff.py`: 숨긴 위치 처리, 실제 이미지 마스크 전달. contract test에 optional 필드 호환 검사 추가.
- web `WardrobeSceneLayers.tsx`, `PhotoWardrobeStage.tsx`, `MirrorExperience.tsx`: DB scene 실제 의류 클릭과 동일 슬롯 LED, SVG clip.
- web `homeRecommendations.ts`, `MirrorHome.tsx`, core/types.ts, integrations/backendClient.ts: 실제 AVAILABLE 상태 및 가족 공유 범위 유지, 계정 전환 시 맥락 초기화.
- web `StorageMovePanel.tsx`: 서버 목적지 이름과 이동 상태 갱신.
- renderer `src/card-layouts.mjs`, `template.mjs`, `Dockerfile`, assets/: 4종 독립 배경/배치, 실제 source pixels, 입력 안전성.
- web test/remediation-{browser,masks,comparisons}.mjs 및 추천/renderer 테스트: 실 UI·객체 저장 검증과 비교 캡처.
- public/assets/remediation/, templates/remediation_*.json, reports/evidence/remediation/: 생성 배경, 매핑, 시각/DB/테스트 증적.

## 로컬 실행과 재개

현재 서버는 loopback 웹 `http://127.0.0.1:5193`, API18081, renderer3300다. MinIO19000/PostgreSQL56433/Redis16379의 별도 데모 서비스를 사용하며 기존 사용자 서비스는 보존했다. DB 컨테이너는 tmpfs이므로 삭제·재시작 시 데이터가 유지되지 않을 수 있다. 현재 이동 상태를 초기 상태로 덮어쓰지 않는다.

루트 PowerShell에서 준비(신규 환경에는 Docker Desktop, 설치된 .venv/npm 및 인계 입력 에셋 필요):

```powershell
.\.venv\Scripts\python.exe scripts/remediation_catalog.py
cd web
node test/remediation-masks.mjs
cd ..
.\.venv\Scripts\python.exe scripts/remediation_local.py prepare
```

현재 세 서버는 실행 중이며 이미 기동된 포트에 중복 실행하지 않는다. renderer 창에서 `cd renderer` 후 `$env:RENDERER_PORT='3300'`, `$env:RENDERER_BIND_HOST='127.0.0.1'`, `npm start`를 각각 실행한다. 루트의 별도 창에서 `.\.venv\Scripts\python.exe scripts/remediation_local.py serve`를 실행한다. API 실행 후 루트에서 `.\.venv\Scripts\python.exe scripts/remediation_local.py provision`, 이어서 `.\.venv\Scripts\python.exe scripts/remediation_local.py layout`을 실행한다.

web 창:

```powershell
$env:WEB_API_TARGET='http://127.0.0.1:18081'
$env:WEB_STORAGE_TARGET='http://127.0.0.1:19000'
$env:VITE_HANDOFF_SCENE='on'
npm run dev -- --host 127.0.0.1 --port 5193
node test/remediation-browser.mjs
```

`npm run dev`는 별도 지속 실행 창을 사용한다. 브라우저 검증 후 루트 `python scripts/remediation_evidence.py`, `node web/test/remediation-comparisons.mjs`로 정합성/최종 비교를 갱신한다. frozen manifest가 있는 재수집은 원본 URL과 해시를 유지하며 변경 사진은 실패로 처리한다. 자동 마스크 생성은 한 번 실행한 뒤 수동 검토 결과를 기록한다.

로그인 계정 `remediation-mom`, `remediation-son`. 비밀번호/접속 기기 ID/기기 인증은 gitignore된 `test-results/handoff/runtime.json`의 demo_password/remediation_station_id/remediation_station_credential을 사용한다. 파일 전체나 값을 Git/공개 로그에 복사하지 않는다. 새 Git clone에는 미추적 인계 원본/참조 에셋이 별도로 필요하다. 현재 런타임 파일 없는 기존 명명 컨테이너를 덮어쓰지 않고 준비 스크립트가 중단한다.

## 남은 작업과 인수 게이트

1. **P0 구현 미완료:** T1–T4의 개별 레이어 추출, 선택 품목별 접힘/소매/가림·광원 retargeting. 단순 affine/SVG 치환은 원본을 충실하게 복원하지 못한다. 위 비교 캡처를 기준으로 수정하고 Gate A/B를 다시 검증해야 한다. 외부 장애로 위장하지 않는다.
2. **P1 문서 정합성:** 기존 FSD operation 추적과 1.7 문서 변경 이력의 정당한 revision을 정리해야 한다. 현재 원본 계약 문서는 보존했다.
3. **별도 외부 인수:** 사진 공개/상업 사용 권리, 실제 Decart 비용·인증 승인, 실물 LED/센서·실측 슬롯. Mock 성공으로 대신하지 않는다.
4. **보안/운영:** 기존 로컬 MinIO 바이너리는 운영 안전성을 인증하지 않았다. 임시 로컬 credentials, 테스트 JWT, synthetic consent/person image, tmpfs 저장소는 운영 설정으로 사용할 수 없다. 현재 서비스 외부 공개 없음.

새 Git clone의 비교 캡처에는 사용자 제공 패키지의 `references/card/T1_reference.png`~`T4_reference.png`가 동일 패키지 경로에 필요하다. contracts/·execution/·references/는 기존 미추적 인계 입력이다. Gate A는 원본별 문구 제거·좌표·레이어/접힘·명시 복원 영역을 확인하고, Gate B는 실제 선택 품목의 색상/재질/브랜드 식별과 원본의 접힘·가림 구조를 함께 확인한다. 픽셀 동일성이나 PNG 저장 성공으로 통과 처리하지 않으며 기존 카드 계약의 수동 시각 인수가 필요하다.

코드와 보고서는 로컬 Conventional Commit으로 보존한다. 커밋 해시는 `REMEDIATION_CHECKPOINT.md`에 기록한다. **전체 완료·배포 완료로 판정하지 않는다.**
