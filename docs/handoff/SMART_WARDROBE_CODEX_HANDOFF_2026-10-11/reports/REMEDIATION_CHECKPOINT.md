# 시정 작업 체크포인트

2026-10-11 · `feat/handoff-p3-p10` · 시작 HEAD `1fffbeb`.

최우선 `execution/05_P3_P10_REMEDIATION.md`. 최종 보고서 `P3_P10_REMEDIATION_REPORT.md`. 전체 PARTIAL: 실제 데이터/Mock 기능 경로 통과, 카드 시각 Gate A/B 미완료, 기존 계약 문서 검사2건 실패. 운영 DB/remote push/merge/deploy/유료 API 금지 유지.

## 완료 증적

- 공식 실제 사진52개: Worn Wear51+Dr. Martens PC11. 초기 내부35/외부8/소품9. 엄마18/아들25/아빠5/딸4. 소재·케어 미확인 null. 소유/계절/위치/환경은 합성.
- `templates/remediation_products.json` frozen 원본 URL/SHA256/MIME/SVG mask. 원본 래스터는 gitignore된 test-results/remediation/source-images, public에서 제거.
- DB wardrobe_test_remediation: 52개 READY 사진, 새 signed 다운로드52/52 해시 일치, 가족4명, 착용0, 용량 초과 없음. 현재 내부33/방10/소품8/신발1; 반복 QA 이동을 초기화하지 않는다.
- 동적 scene와 동일 슬롯 Mock LED/10초 자동 소등, 실제 AVAILABLE 가족 의류 추천3개, carousel/VTON/복귀, LIKED 보유 미등록, 보관 승인≠완료 및 회수 후 DB/scene 갱신.
- 엄마·아들 각각 T1~T4 신규 카드 PNG 생성→private MinIO→DB 저장→재조회/다운로드. browser.json 최종17 그룹 PASS, page error/HTTP 실패0. 카드 시각 품질과 분리.
- backend279 PASS; web35 PASS; renderer5 PASS; OpenAPI validator/Ruff/TS/build PASS. contract8PASS/2FAIL, baseline1fffbeb 같은2FAIL(7PASS). 로그 reports/evidence/remediation/.
- 카드4종 비교 PNG/HTML 및 generated-assets/card/layout manifests. 개별 접힘·레이어/occlusion·광원 retargeting 부족, Gate A/B PARTIAL/C local PASS.

## 실행 상태와 재개

API18081(session49432), Vite5193(session4048), renderer3300(session62813)는 루프백 실행 중. PostgreSQL56433/MinIO19000/Redis16379는 별도 데모 컨테이너. 자격정보는 ignored test-results/handoff/runtime.json. 기존 사용자 DB/서비스와 이전11개 검증 DB 보존.

API는 시연 로그인 수정 후 session48410으로 재기동했다(동일18081). DB·MinIO·Redis는 재시작하지 않았다.

정확한 명령/입력은 최종 보고서 로컬 실행 절을 따른다. API serve는 JWT가 없으면 로컬 runtime에 새 secret 생성. prepare/verify는 기존 이동 상태 보존. tmpfs DB를 중단·재시작하면 데이터가 사라질 수 있으므로 검수 중 임의 재시작 금지.

다음 작업: 카드 참조별 접힘/레이어 복원과 실제 선택 의류의 형태 치환 수정 후 비교 캡처로 수동 Gate A/B 인수. 기존 FSD operation 추적/문서1.7 revision 불일치는 별도 정합성 작업. 실제 Decart/실물 LED/사진 재배포 권리는 별도 인수 게이트. 외부 장애로 카드 구현 미완료를 숨기지 않는다.

shower cold read는 판정/재개 발췌문을 읽었으며 전체 보고서 검사는 아니다. renderer 환경변수/실행 위치, 서버 상태, 필수 참조 파일, 시각 통과 기준을 최종 보고서에 보강했다. mandela 관점으로 기존 카드 ID가 성공 판정에 섞이지 않도록 신규 ID를 대조했고, 실제 다운로드 해시를 원본/DB와 독립 대조했다. 계약 원본 해시를 임의 재작성해 실패를 숨기지 않았다.

로컬 커밋 해시는 아래에 기록한다. 기존 미추적 인계 입력/팀원 자료는 보존하며 stage/push하지 않는다.

- 구현 커밋: `6f5b667` — verified photos/격리 DB/scene/추천/Mock E2E 연결.
- 보고서·증적 커밋: HEAD에서 `docs: record remediation evidence and incomplete visual gates` 메시지로 식별한다. 원격 push 없음.

## 사용자 QA 후 배경 수정

로그인 전/scene frame 미확보 시 동적 stage가 원본 이미지를 숨겨 임시 배경만 남던 결함을 수정했다. PhotoWardrobeStage는 동적 모드에서도 생성된 빈 옷장 이미지를 항상 기본으로 표시하고 서버 frame/의류를 위에 표시한다. photo-db-scene의 임시 갈색 gradient를 제거했다. Playwright 새 비로그인 세션에서 clean plate decode 및 overlay backgroundImage=none 확인, TypeScript/Vite build PASS. 캡처는 ignored test-results/remediation/background-fallback-fixed.png. 카드 Gate A/B 및 전체 PARTIAL 판정 유지.

## 시연용 로그인 QA

사용자 지시로 카드 후속 작업 중단(카드 변경 없음). 브라우저 버튼 POST /integration/demo-login이503 Demo account is not provisioned를 반환했다. 시정 DB의 4인 계정과 기존 고정 demo UUID/login이 달라 발생했다.

선택적 LOCAL_DEMO_MEMBER_ID를 추가하고 격리 서버에서 아들 MEMBER를 지정했다. 해당 설정은 local/test, 비공개, DEMO auth 및 demo_auth_enabled일 때만 적용한다. enabled credential·MEMBER·기기 연결을 확인하며 기존 계정명/비밀번호·4인 DB 구조를 변경하지 않는다. 공개 demo 경로와 기본 고정 demo 동작은 보존한다. 운영에서는 이 로컬 설정만으로 로그인할 수 없다.

실DB demo-login/config20 tests PASS, Ruff PASS. 실제 브라우저 시연 버튼200→가족4인/52개/사진52개→동적 scene→로그아웃200 및 버튼 재진입 PASS. 재현: web에서 `node test/demo-login-remediation.mjs`. 캡처 ignored test-results/remediation/demo-login-fixed.png. API18081 재기동, 운영 DB/원격push/배포 없음.
