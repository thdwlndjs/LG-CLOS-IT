# C-2 FitRoom 연동 및 비용 통제 보고서

2026-10-12. 기준 d128e0b. 범위는 [비용 통제 실행 계약](../execution/C2_FITROOM_COST_CONTROL.md)이다. **실제 공급자 호출 0회·소비 크레딧 0. 실제 시착 품질 미검증.** D~G·운영 DB·원격 push·배포는 수행하지 않는다.

## 구현 결과

| 요구사항 | 구현·검증 | 근거 |
|---|---|---|
| 기본 비활성화·개발/테스트 LIVE 차단 | 기본 false, local/test에서 키·플래그가 있어도 전송 불가. 상태 조회 과금 확인 전 생성도 차단 | config.py, adapters/fitroom.py, test_fitroom.py |
| 사용자 실행 전 입력·비용 확인 | 두 프로필·전처리 인물/상품 PNG·출처·슬롯·모드·HD·예상 credit·1회 제한 표시 | FitroomReview.tsx, browser.json·프로필별 캡처 |
| 서버 승인·원자적 1회 제한 | 오프라인 권한, 동일 review/fingerprint, UPDATE…RETURNING 후 별도 commit. 웹에서 승인 발급 불가 | application/fitroom.py consume/execute, Migration 0006 |
| 동시·중복·타임아웃 | 8개 동시 stub 실행에서 submit 1회. MockTransport timeout 전송도 1회. 실패 후 권한 복구·재시도 없음 | test_fitroom_budget.py, test_fitroom.py |
| 미승인·다른 사용자 차단 | 실행 환경이 허용되어도 승인 없는 요청 차단. 다른 사용자 review 접근 404 | test_fitroom_budget.py |
| Snapshot 및 결과 저장 | 기존 kind+id·동의·READY·checksum·version 검증 재사용. 파생 PNG checksum·전처리 버전 고정. Fixture PNG MinIO/asset/job 저장 및 재조회 | application/fitroom.py, 테스트·브라우저 |
| 서버 재기동 후 소비 제한 | 실제 로컬 API 프로세스 교체 후 두 기존 Fixture 재제출 409 및 동일 result_asset 유지 | evidence/c2-fitroom/restart.json |
| 상태 조회·실패 기록 | GET은 DB/MinIO 전용. 별도 수동 상태 POST는 과금 확인·알려진 작업 ID 없으면 차단. 불명확 전송은 재생성 금지 | API/application/adapter, 감사 테이블 |

LIVE 작업은 기존 C Mock worker에 자동 dispatch하지 않는다. 사용자 execute 요청이 기존 Worker의 입력 검증 유틸리티와 Job·MinIO 구조를 재사용해 단일 시도를 수행한다. 서버 기동·CI·Worker 스캔으로 FitRoom 호출을 생성하는 경로는 없다. 프로세스가 소비 commit 이후 중단되면 권한은 소진된 채 남으며 재전송하지 않는다.

지원 조합은 TOP+BOTTOM combo 또는 DRESS full_set이다. 기존 C Mock 6슬롯은 유지하며 FitRoom에서 지원이 확인되지 않은 OUTER/SHOES/ACCESSORY는 자동 누락시키지 않는다. 상품 정면 원본이 입력이고 Scene 파생 에셋·행거/선반 배치는 변경하지 않았다.

## 변경 파일과 데이터

- backend: additive FitRoom API·DTO·서비스·Provider Adapter, 기본 비활성화 설정, readiness revision.
- Migration `0006_fitroom_budget`: `fitroom_request` 단일 시도 권한과 `fitroom_audit` 감사 기록 추가. 기존 garment/owner/location/wear/card/VTON 데이터 변경 없음.
- frontend: 기존 피팅 입력 안의 FitroomReview, 결과의 Fixture/실제 공급자 표시 구분. CSS·Scene·에셋·geometry 변경 없음.
- 계약: OpenAPI에 review/execute/detail/status 4개 경로 추가, 기존 경로 유지, CONTRACT_REVISION_1_7 해시·승인 amendment 갱신.
- 로컬 도구: c2_local.py, c2_verify_restart.py, fitroom_authorize.py. 마지막 도구는 이번 작업에서 실행하지 않았고 LIVE 권한도 발급하지 않았다.
- 테스트: 이미지 포맷·전송 차단·HTTP envelope·동시 실행·실패·권한 및 실제 브라우저 검증 추가.

Migration은 고정 로컬 `wardrobe_test_remediation`과 disposable 테스트 DB에만 적용했다. 재시드·초기화·운영 DB 연결은 하지 않았다. 로컬 보유 의류는 기존 104벌이다. B-02의 위치 중복 및 기존 화면의 표시 보류 7건은 그대로 유지되며 해결/PASS 처리하지 않는다.

두 실제 인물 원본은 이번에 DB 등록·교체하지 않았다. 브라우저는 기존 테스트 이미지 LOOK01_sweats.png를 PERSON 입력으로 사용했다. 전처리는 파일 형식·체크섬·EXIF·알파 합성·비율 유지 축소를 검증하며 실제 사람·착장 품질을 판정하지 않는다. 인물 윤곽의 색 번짐 정리와 김수진/최휘재 후보 이미지 등록은 남은 승인 게이트다.

## 무과금 검증과 증적

- C-2 단위·DB 및 기존 C 회귀: **31 PASS**.
- frontend 기존 회귀: **48 PASS**. TypeScript 및 production build PASS. 기존 큰 번들 경고는 남아 있다.
- 두 프로필 실제 브라우저: 전처리 이미지·비용 확인 → Fixture 실행 → Snapshot 결과 표시 → LIVE 확인·버튼 차단 PASS. 같은 버튼을 연속 호출해 생성 submit 1회 확인.
- 서버 프로세스 재시작 후 두 소진 Fixture 재제출 409 및 동일 결과 에셋 유지 PASS.
- 추가 단위/계약/legacy VTON/Inline Worker 회귀: **210 PASS**. 위 31건과 일부 단위 테스트가 중복되므로 합산하지 않는다.
- Ruff PASS. OpenAPI/문서 해시 계약 검사는 위 210건에 포함되어 PASS.

증적: [browser.json](evidence/c2-fitroom/browser.json), [restart.json](evidence/c2-fitroom/restart.json), 프로필별 `*-fixture-review.png`, `*-fixture-result.png`, `*-live-blocked.png`, `*-wardrobe.png`.

MockTransport는 실제 HTTP 전송을 대체하고 가짜 키만 사용했다. DB 동시성 테스트는 네트워크에 연결하지 않는 stub을 주입했다. 브라우저는 모든 비loopback 요청을 차단하고 공급자 요청 시도 수를 관측했다. LIVE 승인·소진·공급자 작업 ID는 로컬 DB에서 모두 0건이다. 공급자 청구 내역을 조회한 것은 아니며, 검증 중 계정·과금 API도 호출하지 않았다.

초기 브라우저에서 검증 서버의 원본 설정 미반영, React StrictMode 재마운트 guard 및 JPEG n_frames 오류를 발견·수정했다. 실제 상품 JPEG/WebP/PNG 검사를 추가했으며 실패 실행은 PASS 증적으로 사용하지 않는다.

## 남은 외부 게이트

1. FitRoom 계정의 실제 달러 단가·충전·실패 과금·상태 조회 과금·보존 조건 확인. 공개 1credit은 예상치이며 계정 조건을 대신하지 않는다.
2. 실제 인물과 정면 상품 입력·전처리 PNG를 사용자 검수. 동일 입력/전처리/HD로 정확한 review를 승인한다.
3. 사용자 별도 승인 뒤 담당자가 서버 환경과 오프라인 1회 권한을 준비한다. 승인 기간은 발급부터 10분이며 권한 재승인/자동 복구는 제공하지 않는다.
4. **사용자가 직접 최초 1회 실행한다. Codex 대행 금지.** 실제 요청 수용·품질·지연·결과 다운로드 계약은 그때 검증한다. 공급자 다운로드 호스트는 현재 문서 예시의 storage.googleapis.com만 허용하며 다른 호스트 응답은 차단한다.

TOP+BOTTOM+OUTER 순차 시착·SHOES/ACCESSORY 실모델 조합은 구현·품질 검증하지 않았다. 합성 Fixture receipt는 실제 VTON 성공이 아니며, 결과 저장 성공을 착장 품질 PASS로 선언하지 않는다. 전송 결과 불명확·작업 ID 미확보 시 담당자가 계정 내역을 확인하기 전까지 중단한다.

## 로컬 재현

```powershell
.\.venv\Scripts\python.exe scripts/c2_local.py migrate
.\.venv\Scripts\python.exe scripts/c2_local.py serve
```

별도 PowerShell:

```powershell
Set-Location web
$env:WEB_API_TARGET='http://127.0.0.1:18082'
$env:WEB_STORAGE_TARGET='http://127.0.0.1:19000'
$env:WEB_PORT='5195'
$env:VITE_HANDOFF_SCENE='on'
npm run dev
```

`http://127.0.0.1:5195` → 마이 → 프로필 선택 → 코디 → 코디 선택 → Mock 피팅 → 업로드 동의/테스트 이미지 → TOP+BOTTOM → 입력·예상 비용 확인. Fixture만 실행 가능하며 LIVE는 차단된다. 과금 확인·권한 발급은 이번 로컬 재현에 포함하지 않는다.

```powershell
.\.venv\Scripts\python.exe scripts/stage_c_tests.py backend/tests/unit/test_fitroom.py backend/tests/integration/test_fitroom_budget.py backend/tests/integration/test_stage_c.py -q --tb=short
Set-Location web
node test/fitroom-browser.mjs
```

검수 후 별도 사용자 승인 대기. 원격 실행과 D~G를 시작하지 않는다.

로컬 커밋은 현재 `feat/handoff-p3-p10` 브랜치의 `feat(vton): add guarded FitRoom integration without paid calls`로 기록한다. 커밋 ID는 최종 응답 및 `git log -1`에서 확인한다. 작업 전부터 있던 미추적 공유본·원본 자료는 커밋에 포함하지 않는다.
