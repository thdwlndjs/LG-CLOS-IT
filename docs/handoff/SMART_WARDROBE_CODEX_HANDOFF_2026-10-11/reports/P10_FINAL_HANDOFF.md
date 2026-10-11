# P3~P10 최종 인계

현재 정본은 [P3_P10_REMEDIATION_REPORT.md](P3_P10_REMEDIATION_REPORT.md)와 [REMEDIATION_CHECKPOINT.md](REMEDIATION_CHECKPOINT.md)다. 승인 에셋24개/총76개를 연결했고 계약 검사는 통과했지만 카드 Gate A/B와 기존 회수 의류의 화면 매핑은 미완료다. 아래는 최초 실행의 과거 증적이며 현재 수량·잔여 목록으로 사용하지 않는다.

## 최초 실행 기록

2026-10-11 · 브랜치 `feat/handoff-p3-p10` · 기준 `c17e5e6`, 조사 커밋 `6db17b4`.

**전체 완료로 판정하지 않는다.** 독립적으로 가능한 서버·프론트 연결, 격리 DB 적재, 카드 렌더링과 로컬 검증을 수행했다. 실제 상품 이미지·승인된 clean plate·측정 슬롯·카드 복원 기준본·실제 Decart/하드웨어 검증이 남아 있다. 운영/클라우드 DB 변경, 원격 push/merge/deploy, 유료 호출은 하지 않았다. 팀원 원본과 기존 사용자 데이터는 보존했다.

실제 지시 파일명은 [04_P3_P10_AUTONOMOUS_EXCUTION.md](../execution/04_P3_P10_AUTONOMOUS_EXCUTION.md)다. 이름의 오타를 수정하지 않았으며 G1 D01~D09를 적용했다.

## 단계별 판정

| 단계 | 상태 | 수행한 범위 | 남은 인수조건 |
|---|---|---|---|
| P3 | 부분완료 | 격리 PostgreSQL migration, 확인된 상품 11개, 엄마·아들 합성 계정, 공통 기기, 중복 방지, rollback | 실제 상품 사진/권리, cutout/hanger/folded, clean plate, 위치·환경 시연 입력 |
| P4 | 부분완료 | device scene API/UI, 승인 geometry·캐시 이미지 기반 레이어, 불확실 항목 차단, 기존 Mock LED 유지 | 실배경·위치·LED 영역의 시각 정합성 및 실장비 |
| P5 | 부분완료 | 최대 3개 고유 보유 조합 캐러셀, AI CTA, 홈 mount/복귀 유지, 카드 선택 UI | 실상품·동의 인물 사진으로 캐러셀→VTON→복귀 전체 브라우저 흐름 |
| P6 | 부분완료 / 실제 호출 차단 | 공식 지원 조사, capability API, 기존 owned·LIKED Mock 경로 | 서버 단기 token 및 영상 결과 계약, 인증/비용 승인, 실제 품질 검증 |
| P7 | 부분완료 | T1~T4 독립 React scaffold, prepare→job→PNG→MinIO→save | 원본 유래 마스크/좌표/가림 복원, 실제 치환, Gate A/B 승인. 현재 결과는 복원본이 아님 |
| P8 | 부분완료 | 승인 무예약, 완료 배치 용량 재검증, 가족 관리자, 간절기 보존, 수동 완료 UI | seed 상품의 위치/용량/환경 미확정으로 전체 가족 이동 시연 미완료 |
| P9 | 부분완료 | 실DB 회귀, 계정별 공유조회, desktop/mobile 브라우저 캡처 | 실상품 사진·복원 카드·실서비스·센서까지 포함한 전체 시나리오 |
| P10 | 보고·검수 수행 | 계약 대조, 실패·증적·재현·잔여 작업 문서화 및 로컬 커밋 | 앞 단계의 미충족 조건 때문에 통합 전체 완료 선언 보류 |

## 계약과 구현 대조

최신 실행 지시는 이전 H1.0의 owned-only VTON보다 우선한다. **보유 의류와 LIKED 모두 VTON 입력을 지원**하고 LIKED에서 garment·wear·저장 코디·카드를 자동 생성하지 않는다. 기존 external VTON worker를 재사용했으며 정적 Decart adapter는 fail-closed 상태다.

기존 Sprint 6의 승인 입고 예약은 G1와 충돌해 제거했다. 현재 위치의 실점유만 계산하며 완료 시 가구 advisory lock 안에서 이번 배치를 포함해 용량을 검증한다. 승인만으로 위치는 바뀌지 않는다. 취소는 남은 품목을 취소하며 이미 완료한 이동을 되돌리지 않는다. UI는 `AWAITING_CONFIRMATION` 품목의 남은 이동도 계속 확인한다.

가구 OWNER 개인 계정은 접근 가능한 기기의 가족 의류를 관리하되 `owner_id`를 바꾸지 않는다. 일반 구성원 쓰기는 기존 소유 범위다. API는 DB 현재 역할/활성 계정을 확인하고 worker도 역할을 다시 읽는다. 다른 기기/가구 접근 경계를 유지했다. 간절기 보존은 명시 `attributes.seasonal_role`만 사용하고 상품명에서 추정하지 않는다.

Scene은 승인 READY `OTHER` clean-plate 에셋, 명시 승인 슬롯 geometry, 최근 신뢰 가능한 위치, 단일 슬롯 점유, READY 이미지를 확인한다. 누락 항목은 이유별 blocked 목록으로 반환한다. 옷장 이름에서 좌표를 만들지 않는다. 기존 고정 배경 기본 동작은 유지하고 로컬 `VITE_HANDOFF_SCENE=on`에서 동적 scene을 활성화한다. 에셋 미확보 갈색 차단 화면을 완성된 디자인으로 승인하지 않았다. 기존 중앙 미러·모바일 구조를 유지했다.

## 주요 변경 파일·API·DB

| 범위 | 주요 파일 | 변경 |
|---|---|---|
| 격리 실행 | `scripts/handoff_local.py`, `scripts/handoff_checks.py` | loopback 서비스, Alembic, namespace seed/검증/rollback, 비밀값 제거 로그 |
| Scene | `backend/app/application/wardrobe_scene.py`, `backend/app/schemas/handoff.py`, `backend/app/api/v1/integration.py`, `backend/app/infrastructure/db/sprint1_repository.py` | 승인 geometry/기기 범위 및 scene·capability API |
| 카드 | `backend/app/schemas/sprint4.py`, `backend/app/application/{sprint4,card_worker}.py`, `renderer/src/{card-layouts,template}.mjs` | additive template enum, React scaffold, PNG 저장, 품질 metadata |
| 보관 | `backend/app/domain/storage.py`, `backend/app/application/{sprint6,storage_worker}.py` | 무예약·완료 용량·가족 관리자·간절기 역할 |
| 프론트 | `web/src/mirror/source/{MirrorHome,MirrorExperience,MirrorCompare,MirrorOutfitWorkspace,PhotoWardrobeStage,StorageMovePanel,WardrobeSceneLayers}.tsx` | 추천/복귀/템플릿/완료 확인/scene 연결 |
| 지원·검증 | `homeRecommendations.ts`, `homeServerActions.ts`, `secondHandoffActions.ts`, `mirror-panels.css`, `test_handoff.py`, `test_wardrobe_scene.py`, 기존 보관/워커 테스트, web/renderer 테스트 | 입력 전달·캐시·실DB·권한·PNG·브라우저 검증 |
| 계약 | `docs/04_FSD.md`, `docs/06_OPENAPI.yaml`, `docs/SPRINT_6_CONTRACT_DECISIONS.md` | G1 우선 적용·schema·무예약 일치 |

새 migration은 필요하지 않았다. 기존 JSONB와 device 연결을 사용했으며 필수 brand·size나 신규 DB 필드는 추가하지 않았다. 추가 API는 GET `/api/v1/integration/devices/{device_id}/scene`, GET `/api/v1/integration/vton-capabilities`다. 카드 prepare의 선택 `template_id`에 `T1-v1`~`T4-v1`을 추가하고 기본 `minimal-v1` 및 기존 호출을 유지한다. 서버는 이미지 URL을 60초로 발급하고 DB는 영속 asset 참조를 저장한다. T계열 metadata의 품질은 `manual-review-required`다.

## DB 적재·멱등성·rollback

적재 대상은 **새 loopback DB `wardrobe_test_handoff`만**이다. 이번 상품은 기존 로컬/클라우드 사용자 옷장에 넣지 않았다. DB 56433, MinIO 19000, Redis 16379는 전용 컨테이너이며 기존 5432/9000/6379 서비스를 변경하지 않았다.

PC01~PC11을 1개씩 합성 데모 소유 인스턴스로 적재했다. [로컬 seed manifest](../templates/local_seed_manifest.json)를 남겼다. 공식 사실은 `attributes.product_reference`, 합성 인스턴스는 `is_demo`·`seed_namespace`·`instance_id`로 구분했다. 엄마 OWNER, 아들 MEMBER와 공통 device_member를 생성했다. 구매·실소유 증빙으로 간주하지 않는다. PC12/PC13은 자료 불확실성으로 제외했다. 상품 이미지, 실제 위치 관측, 착용·세탁·케어 이력을 임의 생성하지 않았다.

`verify`: 사용자 2, 기기 1, 의류 11, 위치 3, 위치 연결 0. 재적재 신규 0이며 savepoint 안에서 namespace rollback 후 의류 0을 확인하고 원래 11개로 복원했다. 후속 수정/종속 outfit·storage·asset·wear가 있으면 rollback을 거절한다. 전역 초기화가 아니다. 회귀 fixture는 별도 일회용 DB이며 MinIO tmpfs의 합성 이미지는 재기동 시 사라진다.

의류 version/관측 변경과 위치 용량/attributes 변경을 거절하도록 rollback 가드를 보강했다. savepoint에서 의류 version과 위치 용량을 각각 변경한 음성 검증이 통과했고 원래 11개를 보존했다. [가드 증적](evidence/rollback-guards.json). 검증 중 위치 용량 필드명을 잘못 사용한 SQL 오류는 실제 `capacity_units`로 수정 후 재통과했다.

## T1~T4 PNG와 원본 비교

아래는 실제 React→Playwright Chromium→PNG→MinIO→card save로 검증한 **8×8 파란색 합성 업로드 fixture**다. 상품 사진/패션 플랫레이/픽셀 복원본이 아니다. 독립 scaffold 좌표를 원본 추출 좌표라고 주장하지 않는다. 실제 복원은 원본 유래 RGBA·마스크·변환·가림 manifest로 scaffold를 교체해야 한다.

| ID | 결과 PNG | 원본 | 판정 |
|---|---|---|---|
| T1 | [PNG](evidence/T1-v1-synthetic-test.png) | [원본](../references/card/T1_reference.png) | PNG 경로 PASS, Gate A/B 미통과 |
| T2 | [PNG](evidence/T2-v1-synthetic-test.png) | [원본](../references/card/T2_reference.png) | 동일 |
| T3 | [PNG](evidence/T3-v1-synthetic-test.png) | [원본](../references/card/T3_reference.png) | 동일 |
| T4 | [PNG](evidence/T4-v1-synthetic-test.png) | [원본](../references/card/T4_reference.png) | 동일 |

[좌우 비교 HTML](evidence/card-comparison.html), [해상도·SHA256 JSON](evidence/card-comparison.json)을 제공한다. 원본은 수정하지 않았다. 오버레이 제거 승인본/레이어가 없으므로 SSIM·픽셀 diff 합격 수치를 임의 만들지 않았다. blue fixture와 원본의 차이를 시각적으로 확인했으며 복원 성공으로 보고하지 않는다.

## 검증 결과

| 명령/검증 | 결과 | 한계 |
|---|---|---|
| `.\.venv\Scripts\python.exe scripts/handoff_local.py prepare` | PASS | Alembic head·전용 DB |
| `.\.venv\Scripts\python.exe scripts/handoff_local.py verify` | PASS | 11개 멱등성·savepoint rollback |
| `.\.venv\Scripts\python.exe scripts/handoff_checks.py` | 최종 전체 279 PASS | 123.08초, exit 0. [최종 로그](evidence/backend-final-full-redacted.log) |
| venv `python -m ruff check backend/app backend/tests scripts/handoff_local.py scripts/handoff_checks.py` | PASS | Python lint |
| `openapi_spec_validator.validate` on `docs/06_OPENAPI.yaml` | PASS | additive schema 포함 |
| renderer `npm test` | 4 PASS | 실제 Chromium·deterministic/no arbitrary network |
| web `npm run build` | PASS | TypeScript·build, 큰 chunk 경고 남음 |
| web `npm test` | 34 PASS | 캐러셀·cache-first·세션/asset 교체·client 검증 |
| `node web/test/handoff-browser.mjs` | PASS | web→FastAPI→PostgreSQL, 합성 Signed PNG relay/decode, 엄마/아들 각 11개·2소유자, UNKNOWN, 차단 scene, desktop/mobile, uncaught error 0 |

첫 전체 실패는 [redacted log](evidence/backend-first-full-redacted.log)에 보존했다. 신규 fixture SQL의 JSON 파라미터 text cast가 누락됐고 기존 worker 테스트가 job 완료 직후 첫 전체 cycle 전에 readiness를 검사했다. SQL cast와 cycle 대기를 수정했으며 실제 fail-closed probe는 유지했다. 초기 Windows 제외 포트/MinIO tmpfs 권한 문제는 신규 컨테이너만 수정해 해결했고 시스템 보안 설정은 변경하지 않았다.

두 번째 전체 결과는 [278 PASS/1 FAIL 로그](evidence/backend-second-full-redacted.log), 수정 후 [8 PASS 로그](evidence/backend-targeted-final-redacted.log)다. 남은 실패는 fixture JSON 리터럴의 콜론을 SQLAlchemy가 바인딩으로 해석한 문제여서 JSON 전체를 파라미터로 바꿨다. 대상 재검증 명령은 아래와 같다.

```powershell
.\.venv\Scripts\python.exe scripts/handoff_checks.py backend/tests/integration/test_handoff.py backend/tests/integration/test_inline_worker.py -q -p no:cacheprovider --basetemp test-results/handoff/pytest-targeted
```

8개는 합성 승인 frame/slot positive scene, cross-device 차단, 가족 이동, 4종 카드, 워커 재시작을 포함한다. 이 대상 실행은 종료 코드 0이지만 teardown async 연결 종료 Future 경고가 있었다. 최종 전체 재실행은 279개 통과했고 같은 Future 경고는 재발하지 않았다. Alembic/botocore/TestClient의 기존 deprecation 경고는 남았다.

격리 MinIO 포트가 기존 프론트 relay 계약과 달라 추가 운송 검증을 했다. 최초 relay가 Host를 바꿔 `SignatureDoesNotMatch` 403이 났고 `WEB_STORAGE_TARGET`과 서명 Host 보존으로 수정했다. 실제 브라우저에서 합성 PNG 8×8 decode를 확인하고 probe 객체를 삭제했다. 실제 상품 사진 검증으로 취급하지 않는다.

브라우저 테스트도 최초 한국어 selector 및 비동기 상태 대기 오류가 있어 수정 후 통과했다. 데이터 준비 완료를 `page.evaluate`로 기다린다. 실제 데이터 누락을 성공으로 우회하지 않았다.

증적: [JSON](evidence/handoff-browser.json), [엄마 홈](evidence/mom-home-blocked-assets.png), [엄마 의류](evidence/mom-wardrobe-metadata.png), [아들 홈](evidence/son-home-blocked-assets.png), [아들 의류](evidence/son-wardrobe-metadata.png), [모바일](evidence/mobile-mirror-handoff.png). 사진 부재/위치 불명 안내가 보이며 사진 품질 합격 증적이 아니다.

## 실제 연동과 Mock

PostgreSQL 연결/migration/조회, 로컬 MinIO 이미지 업로드·다운로드/카드 저장, Redis, renderer/Chromium을 실행했다. LED·센서·날씨·계절 맥락과 VTON 결과는 Mock이며 카드 입력은 합성 fixture다. 실제 착용·센서·LED는 미검증이다.

Decart 공식 문서에서 `lucy-vton-3.6`은 실시간/녹화 영상 VTON의 720p 지원 모델이고 fast mode 미지원으로 확인했다. 현재 정적 다중 의류 이미지 계약의 호환성은 검증되지 않았다. [공식 VTON 문서](https://docs.platform.decart.ai/models/realtime/virtual-try-on).

Lucy Image 2 이미지 편집 경로가 있다는 사실은 현재 static VTON adapter의 정확한 호환성·품질을 증명하지 않는다. 서버 live는 비활성이고 영구 키를 브라우저에 넣지 않았다. 서버 단기 token 발급과 영상 결과 저장·동의·만료 계약을 연결한 뒤 별도 비용 승인으로 실제 호출해야 한다. [공식 Image 2 문서](https://docs.platform.decart.ai/api-reference/lucy-image-2).

## 로컬 실행과 QA

Docker Desktop, workspace `.venv`, 설치된 npm 의존성이 필요하다. 각 서버를 별도 PowerShell 창에서 실행한다. 새 서비스는 loopback 전용이다.

```powershell
# 프로젝트 루트
.\.venv\Scripts\python.exe scripts/handoff_local.py prepare
.\.venv\Scripts\python.exe scripts/handoff_local.py verify
.\.venv\Scripts\python.exe scripts/handoff_local.py serve
```

```powershell
cd renderer
$env:RENDERER_PORT='3300'
$env:RENDERER_BIND_HOST='127.0.0.1'
npm start
```

```powershell
cd web
$env:WEB_PORT='5192'
$env:WEB_API_TARGET='http://127.0.0.1:18080'
$env:WEB_STORAGE_TARGET='http://127.0.0.1:19000'
$env:VITE_HANDOFF_SCENE='on'
npm run dev
```

`http://127.0.0.1:5192`에서 마이→내 계정→`handoff-mom`/`handoff-son`. 비밀번호는 Git ignore된 `test-results/handoff/runtime.json`의 `demo_password`를 로컬에서만 확인한다. 공개 시연 로그인 버튼은 이 namespace 계정용이 아니므로 이번 QA는 계정 로그인으로 수행한다. 비밀번호를 공유 문서에 붙이지 않는다.

먼저 `prepare`→`verify`를 순서대로 실행하고 renderer, API `serve`, web을 각각 시작한다. 루트에서 아래 순서로 합성 S3 이미지 브라우저 decode와 계정별 조회를 재현한다. Signed URL probe는 60초라 생성 직후 실행한다.

```powershell
.\.venv\Scripts\python.exe scripts/handoff_storage_probe.py
node web/test/handoff-browser.mjs
.\.venv\Scripts\python.exe scripts/handoff_storage_probe.py cleanup
.\.venv\Scripts\python.exe scripts/handoff_checks.py
```

두 계정은 **같은 전체 11개**를 조회하며 총 22개가 아니다. 불확실 위치의 scene/LED는 차단한다. 사진 없는 상태에서 실상품 추천·VTON 성공을 기대하지 않는다. 개발 relay만 `WEB_STORAGE_TARGET`을 받으며 loopback 주소를 검증하고 Signed URL의 기존 `localhost:9000` Host를 보존한다. 운영 API/스토리지 allowlist를 넓히지 않았다.

## 남은 문제와 최소 사용자 입력

1. **P0 에셋:** 사용 가능한 상품/개인 의류 이미지와 사용 권리, 빈 옷장 원본, 측정 슬롯/anchor를 확보한다. 출처·해시·파생 이력 및 동의 계약으로 적재한다. 현재 UNKNOWN을 실제 위치로 추정하지 않는다.
2. **P0 카드:** 무자막/오버레이 제거 기준본 또는 복원 영역 검토를 확보한다. 원본 픽셀/마스크/가림/변환 manifest로 scaffold를 교체하고 Gate A/B를 검수한다. 현재 PNG를 최종 시연 카드로 취급하지 않는다.
3. **P1 전체 QA:** 위치·용량·환경·사진 확정 후 엄마/아들 계절 이동, 캐러셀→VTON→복귀, 완료→scene/LED 정합성을 실제 브라우저에서 검증한다.
4. **P1 외부 검증:** 실제 Decart/하드웨어는 인증·비용 승인·결과 계약 검토 후 진행한다. 기존 오래된 개발용 MinIO 바이너리를 운영에 안전한 버전으로 간주하지 않는다.
5. **P2 성능:** 필요 시 큰 web chunk를 분리하되 캐시·권한 계약을 약화시키지 않는다.

## 로컬 커밋·재개

`c17e5e6` 다음 조사 커밋 `6db17b4`를 기준으로 작업 브랜치를 만들었다. 로컬 커밋은 다음과 같다. 원격 작업은 하지 않는다. 기존 untracked 입력과 팀원 폴더는 추가/삭제/덮어쓰기하지 않고 변경 코드와 생성 증적만 선택해 커밋했다.

- `0f4f5af` — `feat: integrate gated handoff scenes cards and storage flows`
- `c72dce9` — `fix: refuse local seed rollback after inventory changes`
- 최종 인계·증적 커밋 — `docs: record verified handoff evidence and remaining gates` (`git log -1`로 SHA 확인)

[P3_P10_PROGRESS.md](P3_P10_PROGRESS.md)가 재개 체크포인트다. 원본 패키지는 기존 untracked 입력 상태로 보존되어 있으므로 Git만 새로 clone하면 참조 이미지/계약 입력을 별도로 가져와야 한다.

## 인수 게이트·검토 기록

Gate A는 원본 유래 레이어를 재조합해 승인된 무자막/복원 기준본의 좌표·마스크·가림·광원에 맞는지 검수하는 단계다. Gate B는 실제 등록 의류로 치환 후 누락/잘림/경계/로고/색상/자연스러움을 검수한다. 상세 기준은 [카드 계약](../references/card/CARD_TEMPLATE_CONTRACT.md)을 따른다. 수치와 승인본 없이 합격 임계값을 임의 정하지 않는다.

이미지/권리/빈 옷장/실측 슬롯과 카드 기준본의 제공·시각 승인은 사용자 및 자료 소유 팀의 입력이 필요하다. 다음 구현 담당자는 manifest·동의 업로드·레이어 제작과 게이트 증적을 준비한다. 담당자를 임의로 지정하지 않았다. 엄마 소유 4개, 아들 소유 7개, 공통 기기 전체 11개다.

`sip`의 독립 cold-read에서 커밋 상태, 최종 회귀, Gate 정의, 입력 담당과 실행 순서가 불명확하다는 지적을 받았다. 전체 회귀를 재실행하고 위 정의/순서/공통 조회 설명을 보완했다. `factchk`는 Decart 공식 문서로 모델 지원을 확인했다. `mandela` 검토에서는 synthetic fixture 성공을 실제 의류/시각 품질로 일반화하는 위험을 분리했고 Gate A/B는 미통과로 유지했다. `ssotize`는 계약 감사만 수행하고 패키지의 과거 owned-only 문서를 삭제하지 않았다. 최신 FSD에 우선 계약을 명시했다. `re0`로 진행 문서를 현재 체크포인트로 갱신했다. 도구 독립성/이식성 주장을 하지 않으므로 `detool`은 적용하지 않았다.
