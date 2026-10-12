# main 반영·클라우드 배포 체크포인트

## 검증된 Git 반영 경로

- 원격 main 기준: `c17e5e6`. 작업 브랜치 `feat/handoff-p3-p10`과 비교 시 원격에만 있는 커밋 0개, 로컬 선행 54개.
- 기존 로컬 main은 별도 `test-results/main-release` worktree에서 작업 브랜치를 fast-forward했다. 원래 작업 폴더의 미추적 팀원 자료는 포함하지 않았다.
- 검증: backend unit/contract 204 PASS 및 공개 프로필 제한 추가 2 PASS, frontend 49 PASS·타입 검사·build PASS, Ruff PASS. `.env`·복구 runtime·덤프는 Git 제외이며 현재 환경의 실제 secret 값이 변경 추적 파일에 포함되지 않음을 검사했다.
- force push·history rewrite 없이 main의 검증된 커밋만 push한다. 최신 원격 main을 push 직전 확인한다.

## 기존 클라우드 및 데이터 보호

- Render: `https://wardrobe-api-5gd7.onrender.com` — 기존 무료 web/Redis 구성 유지.
- Vercel: `https://lg-clos-it.vercel.app`, 프로젝트 `prj_G7jiUWMFsJHBC7X509o3EvWEDp3D`, 팀 `team_wu1C2iIBd66xPpRsyC0lRdYg`.
- Supabase 관리형 PostgreSQL 17 및 private `wardrobe-assets` 재사용. 신규 유료 서비스나 플랜 변경 없음.
- 운영 이전 상태: 의류 6벌·사용자 2명·에셋 6개·revision 0004. 운영 DB app schema archive와 객체 6개를 `test-results/cloud-release/20261013-v1`의 제한된 접근 폴더에 백업했다.
- 실제 PostgreSQL 17 복사본에 백업을 복원하고 기존 40개 테이블 전체 행 해시 일치를 확인했다. 복사본 migration 0006 및 시연104 추가 적재도 기존 행 불변 검증을 통과했다.
- 운영 DB에는 검증된 additive migration 0005/0006만 적용했다. 기존 40개 테이블의 데이터 불변 및 revision 0006을 검증했다.
- `release_demo_transfer.py`는 승인 시연 household만 추가한다. 기존 PK 충돌 또는 다른 객체 SHA 발견 시 중단하며 기존 DB 행·객체를 갱신/삭제하지 않는다. 기존 household 생성 시 bootstrap된 신규 device/member settings만 해당 신규 범위에서 원래 데이터로 맞춘다.
- 운영 시연 적재와 객체 이전은 진행 중이다. 실행 상태는 private `cloud-transfer.json`, `transferred-objects.json`을 따른다. 로컬 idempotency cache·실행 job·감사·outbox·FitRoom 실행 권한은 시연 데이터로 복제하지 않는다.

## 공개 프로필 및 배포 게이트

- 기존 단일 public demo 동작을 유지한다. 선택적으로 `PUBLIC_DEMO_MOTHER_MEMBER_ID`를 명시하면 두 public demo 프로필이 활성화된다. local profile 환경변수로 public 권한을 얻지 않는다.
- 신규 public 프로필의 일반 credential 이름 허용은 승인 합성 household namespace로 제한된다. 어머니의 DB OWNER 관계는 유지하되 공개 세션의 JWT·반환 role은 MEMBER로 제한하고 HOME station claim을 발급하지 않는다.
- 복사본의 실제 SQL 조회·JWT 검사에서 두 프로필 로그인, MEMBER 역할·station 없음 PASS. 추가 unit test도 공개/로컬 경계를 검사한다.
- Vercel MCP는 프로젝트 scope 접근 403이다. 별도 기존 CLI 인증으로 정확한 팀/프로젝트 확인과 production 환경변수 목록 조회는 성공했다.
- Render deploy hook은 있지만 환경변수 수정 권한은 아직 없다. `.env.cloud`에 `RENDER_API_KEY` 입력을 사용자에게 요청했다. 키 없이 권한을 우회하지 않는다.
- 필요한 Render 공개 설정: PUBLIC_DEMO_LOGIN_ENABLED=true, PUBLIC_DEMO_MEMBER_ID=55328e5c-6a05-5ac7-af55-77ece0a86dd8, PUBLIC_DEMO_MOTHER_MEMBER_ID=0b43d34d-0ae6-53cd-8f37-f95b32a01451, VTON_PROVIDER=MOCK, FITROOM_LIVE_ENABLED=false.
- 프론트 production Scene은 `VITE_HANDOFF_SCENE=on`이 필요하다. 백엔드 프로필 설정과 함께 적용·검증한다. 유료 VTON 호출·실물 LED·운영 기존 데이터 덮어쓰기는 하지 않는다.
- 데이터 롤백은 기존 행을 덮어쓰는 restore가 아니다. 먼저 이전 배포 커밋/alias로 코드 롤백하고 추가된 시연 household를 비노출로 둔다. 신규 schema는 backward compatible이므로 데이터가 추가된 뒤 임의 downgrade/drop을 하지 않는다. 재해 복원은 보호된 archive/객체 파일을 새 격리 DB/버킷에 복원 후 연결 전환한다.

공식 동작 근거: [Supabase S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility), [Render deploy hooks](https://render.com/docs/deploy-hooks), [Render environment variables](https://render.com/docs/configure-environment-variables).

## 실제 반영 및 CI 시정

- `a3117c2`를 원격 main에 일반 push 완료. Vercel production 새 deployment `dpl_9P2bDyE5iG92zoM5jDZwRDHdAJBm` READY 확인.
- 운영 DB 시연104 추가 적재 commit 완료. 기존6 포함 총110벌, 기존 행 불변, 사용자별 합성 착용54/LIKED3 및 선반66 연결. READY 에셋155개를 Supabase private bucket에 추가하고 GET SHA256 일치 확인(42,074,632 bytes). source/target PK 및 파일 키 유지. 실제 local job/감사/권한 이력을 시연 이력으로 생성하지 않았다.
- 첫 CI의 free-cloud-image는 renderer/assets 복사 누락으로 ENOENT 발생. Dockerfile에 승인 배경파일 디렉터리만 추가한 이미지 build 및 무료 환경 512MiB/0.5CPU renderer 테스트6 PASS.
- backend 실제 통합 CI는 134 PASS/5 FAIL. 카드4건은 정상 PNG 생성 후 root-owned 소스 문서에 증적 쓰기를 시도해 PermissionError 발생했으므로 tmp_path 증적으로 변경했다. 나머지1건은 baseline 검사에 추가된 FitRoom 두 테이블 및 revision0006 반영이 누락되어 명시 목록을 갱신했다. 실패 자체를 숨기거나 검사/권한을 비활성화하지 않았다.
- 독립 PG17/MinIO/Redis 시험 환경에서 수정 baseline 포함4건 PASS, 최신 renderer 이미지에 카드4건 실DB·PNG 저장/재조회/save PASS. 로컬 기존 renderer3301은 오래된 이미지여서 카드 요청 retry가 발생했으며 최신 3302 시험 이미지에서는 PASS다.
- Render 환경변수 설정 권한은 아직 사용자 입력 대기이다. CI 시정 후 일반 push와 자동 배포 결과를 확인한다. production 핵심 E2E는 여전히 미완료다.

## 이어서 실행할 작업

1. 진행 중 객체/DB 추가 적재 완료와 기존 6벌 불변 확인.
2. 검증한 release commit을 main에 fast-forward 반영하고 일반 push.
3. Render 기존 환경변수 갱신 권한 확보 후 지정 commit 배포, Vercel Scene build 설정 적용.
4. 실제 production URL에서 두 프로필 로그인·옷장104·Scene87·사진·Mock 코디 흐름 검사. 이 게이트는 현재 미완료이며 로컬 PASS로 대체하지 않는다.

## 후속 체크포인트

- `8f4f160` main push 완료. 새 CI에서 backend 전체 실제 통합과 free-cloud-image 성공을 확인했다. 무료 이미지의 실제 renderer 테스트6 PASS이며 별도 PG17/MinIO/최신 renderer에서 T1~T4 PNG 저장·재조회·save4 PASS를 확인했다.
- frontend CI는 새 profile-state 테스트가 Playwright를 사용하지만 browser 설치 단계가 없었다. executable 없는 경로로 독립 재현했으며 launch 실패 시 Vite 서버가 정리되지 않는 결함도 확인했다. CI에 잠긴 Playwright 버전의 Chromium 설치를 추가하고 테스트의 launch도 finally 정리 범위로 옮겼다. 없는 browser는 오류 종료, 정상 browser는 profile-state 테스트 PASS이다. 테스트를 생략하거나 보안 옵션을 해제하지 않았다.
- 실제 `https://lg-clos-it.vercel.app`의 browser admission 검사에서 두 시연 프로필은 표시되지 않았다. Render demo-profiles 요청이 45초 내 완료되지 않아 검사 FAIL이다. 이 실패는 필요한 Render 설정 권한 미확보와 별도 관측 사항이며 API timeout의 직접 원인을 아직 단정하지 않는다. 증적: private `browser/production-profile-gate.json` 및 PNG.
- 운영 DB 최종 독립 조회: 총110벌, scene66, wear108, LIKED6. 김수진·최휘재 각각 wear54/LIKED3. 원래 운영6벌 및 사용자 데이터 불변을 추가 적재 트랜잭션에서 확인했다. source job/idempotency/audit/유료 요청 권한은 복제하지 않았다.
- Render API 키는 아직 입력되지 않았다. 배포 hook은 보존되어 있으나 환경변수를 수정할 수는 없다. 키 입력 후 기존 무료 서비스의 비밀값을 유지하면서 `desired-render-env.json`의 공개 프로필/Mock 설정만 갱신해야 한다. Vercel Scene flag도 이 시점에 활성화하고 production 핵심 E2E를 재실행한다.
