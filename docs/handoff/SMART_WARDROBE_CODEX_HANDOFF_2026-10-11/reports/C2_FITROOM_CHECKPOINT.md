# C-2 FitRoom 비용 통제 체크포인트

2026-10-12. 기준 HEAD d128e0b. 상태: 구현·무과금 검증 완료, 사용자 검수 및 실제 시착 승인 대기.

이해한 범위: 기존 C Mock 계약과 B-01 화면을 보존하며 정적 FitRoom 연결 준비를
구현한다. 이번 실제 공급자 호출 예산은 0회이며 입력 검사도 호출하지 않는다.
실제 시착 품질은 미검증, B-02는 DEFERRED, D~G·운영 DB·push·배포는 범위 밖이다.

## 구현

- 별도 reviews 경로에서 서버 입력 검증 및 불변 Snapshot 고정.
- 단일 생성 시도 권한과 감사 이력을 additive Migration 0006으로 영속화.
- 호출 직전 원자적 UPDATE를 별도 트랜잭션으로 commit한 후 전송.
- 기본 비활성화, local/test 실제 전송 금지, 서버 승인 없는 요청 차단.
- 권한을 웹에서 발급하지 않는다. 향후 명시적 승인 후 사용자/팀 담당자가
  오프라인 도구로 정확한 review ID와 fingerprint에 10분·1회 권한을 부여한다.
  이번 작업에서는 LIVE 승인 도구를 실행하지 않는다.
- 생성 자동 재시도 없음. 상태 조회도 과금 검증 설정 전 차단하며 수동 실행만 제공.
- 합성 Fixture는 실제 공급자 출력이 아니다. 기존 C Mock receipt와 구별해 표시.
- 최초 실제 호출은 사용자가 직접 수행해야 한다. Codex 대행 금지.

## 최종 검증

- C-2 단위·DB·C 회귀 31 PASS, 추가 단위/계약/legacy/Inline Worker 210 PASS. 중복 단위 건수를 합산하지 않는다.
- frontend 회귀 48 PASS, 타입·build·Ruff·문서 해시 PASS.
- 두 프로필 실제 브라우저: 전처리 입력·비용 확인, 연속 클릭 생성 1회, Fixture 결과 표시, LIVE 차단 PASS.
- 실제 서버 프로세스 교체 후 두 소비 요청 재제출 409, 동일 결과 에셋 유지 PASS.
- 로컬 DB LIVE approved/consumed/provider_job_id 모두 0. 실제 공급자 호출 0회.
- 기존 보유 의류 104벌 유지, Scene/CSS/에셋 변경 없음. B-02 DEFERRED 유지.
- 초기 환경·StrictMode·JPEG 오류를 수정하고 최종 증적을 재생성했다.
- 전처리 PNG를 표시하고 checksum·전처리 버전을 승인 fingerprint에 포함한다.
- 상태 조회 비용 확인 전 생성·오프라인 승인도 차단한다.
- HTTP envelope 검사는 MockTransport에 한정하며 가짜 키만 사용한다.

## 재개 명령

```powershell
.\.venv\Scripts\python.exe scripts/stage_c_tests.py backend/tests/unit/test_fitroom.py backend/tests/integration/test_fitroom_budget.py -q --tb=short
.\.venv\Scripts\python.exe scripts/c2_local.py migrate
.\.venv\Scripts\python.exe scripts/c2_local.py serve
```

위 migration은 고정된 로컬 wardrobe_test_remediation에만 적용하고 기존 데이터는
수정하지 않는다. LIVE 승인·키·과금 설정은 넣지 않는다.

[최종 보고서](C2_FITROOM_IMPLEMENTATION_REPORT.md)의 로컬 UI 실행 및 QA 명령을 사용한다.
사용자 검수 전 유료 호출 금지이며 승인 이후 최초 실제 호출도 사용자가 직접 수행한다.
D~G·push·배포는 금지 상태를 유지한다.
