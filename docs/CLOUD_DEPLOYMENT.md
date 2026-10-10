# 무료 클라우드 배포 및 의류 적재 기록

2026-10-10 기준. 원본 설계 문서 7개와 프론트 옷장·스마트미러 디자인은 변경하지 않았다. PostgreSQL을 유지하고, 클라우드 오브젝트 저장소만 승인된 Supabase Storage로 연결했다. 로컬 MinIO와 기존 실제 의류 6벌은 유지한다.

## 실제 서비스 상태

| 서비스 | 실제 확인 결과 |
| --- | --- |
| Frontend | https://lg-clos-it.vercel.app , Vercel Hobby active, GitHub main 연결 |
| Backend | https://wardrobe-api-5gd7.onrender.com , Render Web plan=free |
| Redis | Render `wardrobe-redis`, plan=free, Singapore private 연결 |
| PostgreSQL | Supabase Free 조직 `Smart-Wardrobe`, Singapore 프로젝트 `smart-wardrobe`, PostgreSQL 17.11 |
| Storage | 같은 프로젝트의 `wardrobe-assets`, Private, 이미지 MIME 허용, 10MiB 제한 |
| Migration | 기존 schema를 유지한 `0004_device_integration`, 업무 테이블 40개 |

API readiness에서 database/redis/storage/renderer/worker 모두 ok를 실제 확인했다. 의류 6벌과 READY 이미지 6개를 적재하고 Vercel 브라우저에서 개인 계정 로그인 및 사진 6개 표시를 확인했다. 사진 요청 실패 0건, Seed 표시 0건이다. GitHub Deploy Hook 자동 배포와 배포 smoke도 실제 성공했다. CI 실행 [37981174550](https://github.com/thdwlndjs/LG-CLOS-IT/actions/runs/37981174550)의 attempt 2 및 smoke [37981760776](https://github.com/thdwlndjs/LG-CLOS-IT/actions/runs/37981760776)가 성공했고, 검증한 commit은 `1d11f6a32b71a33747af01c3b6873d26d09dd58e`이다. 위 증적은 보고서 추가 전 구현 커밋의 검증이다. 보고서만 추가하는 main 커밋도 같은 경로로 실행하고, 그 마지막 실행 결과는 최종 응답에서 별도로 확인한다.

## 무료 실행 구성

`infra/cloud/Dockerfile`은 UID 10001 비루트 사용자로 FastAPI 1 worker, 기존 Chromium 카드 렌더러, 기존 DB 기반 작업 처리기를 함께 실행한다. 렌더러는 127.0.0.1:3000에서만 수신한다. MinIO, 유료 worker/private service, persistent disk, Render PostgreSQL은 클라우드에 생성하지 않았다. 기존 로컬 Celery 실행 방식은 유지한다.

`WORKER_EXECUTION=INLINE`은 기존 SQL 작업 테이블과 처리기를 재사용한다. API lifespan에서 시작·종료하며 작업 실패 또는 처리기 종료 시 readiness가 실패한다. QUEUED 카드 작업을 처리기 재시작 후 성공시키는 실DB 통합 테스트를 통과했다. 모든 RUNNING 작업을 자동 복구한다고 보장하지 않으며 기존 lease 만료·실패 계약을 유지한다.

공식 Supabase CA로 DB TLS 체인 및 hostname을 검증한다. `infra/cloud/supabase-ca.crt` 출처는 [공식 배포 인증서](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt)이며 SHA256은 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`이다. 시스템 보안 설정을 변경하지 않았다.

## 데이터 적재 결과

- 승인된 private 계획의 실제 보유 의류 6벌을 기존 등록 API로 적재했다. 상품 원본 이미지와 실제 보유 의류는 구분한다. 기존 승인 계획에서 상품 URL·전달 라벨 불일치, 공식 상품 본문 확인 불가, 같은 미확정 상품 재참조로 보류한 4건은 등록하지 않는다. 이는 승인된 6건 범위 밖의 미확정 적재 항목이다.
- 클라우드 사용자·기기를 새로 준비하고 로컬 journal·asset ID·MinIO key를 복사하지 않았다. 초기 적재는 클라우드 개인 계정 1개·기기 1개였고, 공개 시연용 MEMBER 계정 1개를 같은 기기에 별도로 연결했다.
- verified TLS pg_dump 백업 후 동의 설정 API → upload intent → S3 PUT → SHA256 finalize → 의류 등록 API를 실행했다.
- 모든 사진 다운로드 SHA256이 검증된 상품 이미지와 일치한다. 재실행 결과 verified=6, created_this_run=0, held=4이다.
- 독립 SQL 조회에서 garment=6, READY GARMENT assets=6, wear_event=0, care_event=0, garment_observation=0을 확인했다. 의류 상태 UNKNOWN, 위치·마지막 관측·confidence가 미확정 상태임을 API로 확인했다.
- private 실행 원장: `data/imports/cloud-owned.journal.json`. 백업과 브라우저 증적은 `test-results/`에만 보관하며 Git에 올리지 않는다.

재현 명령은 프로젝트 루트에서 실행한다. `--grant-image-consent`는 해당 클라우드 계정의 이미지 업로드 동의 설정을 API로 활성화한다. 기존 승인된 private 계획과 `.env.cloud`가 필요하며 tracked 변경이 commit/push되어 있어야 한다. 동일 원장을 유지해야 재실행 중복을 방지할 수 있다.

```powershell
$env:PYTHONPATH='backend'
.\.venv\Scripts\python.exe scripts/import_cloud_wardrobe.py --plan data/imports/owned-plan-20261009.json --journal data/imports/cloud-owned.journal.json --grant-image-consent
```

## 계정과 환경변수

클라우드는 `AUTH_MODE=JWT`, `DEMO_AUTH_ENABLED=false`를 유지한다. 공개 시연용 버튼은 별도 opt-in `PUBLIC_DEMO_LOGIN_ENABLED=true`와 지정된 `PUBLIC_DEMO_MEMBER_ID`로 활성화한다. 기존 개인 계정의 비밀번호나 OWNER 세션을 제공하지 않고, 기존 시연 옷장에 연결된 `public-demo` MEMBER의 개인 계정 JWT를 발급한다. 일반 계정은 화면의 마이 → 내 계정에서 로그인한다. 로그인 ID는 프로젝트 루트 `C:\Users\aicam\Desktop\2차프로젝트\.env.cloud`의 `CLOUD_IMPORT_LOGIN`, 비밀번호는 `CLOUD_IMPORT_PASSWORD`에서 확인한다. 비밀번호는 채팅·문서·프론트 코드에 기록하지 않는다.

공개 시연 계정 준비는 `scripts/provision_public_demo.py --env-file .env.cloud`로 수행한다. 기존 `CLOUD_IMPORT_LOGIN` 계정의 명시적 단일 기기를 확인하고 별도 MEMBER와 기기 연결만 추가한다. 의류 소유자·이미지·착용 이력을 복사하거나 변경하지 않으며 재실행 시 계정을 중복 생성하지 않는다. 출력된 member_id를 Render `PUBLIC_DEMO_MEMBER_ID`에 설정한다. 비밀번호 로그인은 불가능한 credential을 사용한다. 계정·기기 연결이 없거나 비활성/잘못된 역할이면 503으로 실패하며 다른 사용자로 대체하지 않는다.

공개 시연 사용자는 같은 시연 계정의 데이터를 공유하며, 연결된 옷장의 기존 의류 6벌을 조회할 수 있다. 기존 소유자의 의류 수정은 기존 소유권 검사로 차단된다. 시연 계정이 직접 생성한 데이터는 기존 MEMBER 권한으로 사용할 수 있다. 이 옷장에 이후 개인용 데이터나 추가 기기를 연결하면 공개 조회 범위에 포함될 수 있으므로 공개 시연 대상만 연결한다. 새 로그인 중단은 feature flag를 false로, 발급된 세션까지 중단하려면 account_credential.enabled를 false로 설정한다. 일반 JWT 검증·로그아웃 revocation·API rate limit과 저장소 Private 설정은 유지한다. 실제 유료 API는 활성화하지 않는다.

Render의 개별 환경변수만 [공식 Update Env Var API](https://api-docs.render.com/reference/update-env-var)로 설정한다. 전체 변수 목록을 덮어쓰지 않는다. 이 수정의 배포·실제 버튼 QA 결과는 통합 PROGRESS에 기록한다.

Vercel production에는 공개 설정 `VITE_API_BASE_URL`, `VITE_STORAGE_BASE_URL`만 입력했다. 프론트 API 클라이언트는 지정된 Supabase 프로젝트의 wardrobe-assets/assets 및 업로드 staging 경로만 허용한다. 다른 프로젝트·버킷·비HTTPS 주소는 거부한다. 화면 구조·크기·이미지·좌표는 변경하지 않았다.

서버의 DATABASE_URL, JWT_SECRET, S3 key pair, SUPABASE_SERVICE_ROLE_KEY는 `.env.cloud`와 Render 환경변수에만 둔다. `.env*`가 Git에 제외되고 이미 추적된 secret 파일이 없음을 확인했다. S3 키는 RLS를 우회하는 서버용 키이므로 프론트에 전달하지 않는다. 브라우저는 짧은 유효기간의 서명 URL만 사용한다.

## GitHub Actions와 main 반영

Vercel은 기존 Git 연결로 main push를 배포한다. Render는 공개 repository URL로 생성했으므로 [공식 문서](https://render.com/docs/deploys)에 따라 native Git 자동 배포가 지원되지 않았다. Render native auto deploy를 끄고, [공식 Deploy Hook 방식](https://render.com/docs/deploy-hooks)으로 GitHub Actions에서 배포한다.

`.github/workflows/ci.yml`의 frontend/backend/free-cloud-image 모두 성공한 main push만 deploy job을 실행한다. Hook에는 검증한 commit SHA를 ref로 전달한다. 사용자 제공 Hook이 해당 서비스의 것임을 확인하고 GitHub 공개키로 암호화하여 repository secret `RENDER_DEPLOY_HOOK_URL`에 등록했다. 임시 Render CLI 인증 토큰은 GitHub에 전달하지 않았다. DB/S3/JWT 비밀키도 Actions에 전달하지 않는다.

CI 성공 후 `deployment-smoke.yml`이 해당 backend commit, 의존성 readiness, frontend HTML을 확인한다. repository variables는 `PUBLIC_API_ORIGIN`, `PUBLIC_WEB_ORIGIN`이다. Hook이 없거나 HTTP 실패이면 deploy job을 실패시키고, 배포 SHA가 다르거나 readiness 실패이면 smoke도 실패한다.

## 실행한 검증과 실패 처리

| 검증 | 결과 |
| --- | --- |
| Supabase 실제 private bucket 및 PNG PUT/GET/DELETE, 삭제 후 404 | 통과 |
| Alembic 및 PostgreSQL verified TLS | 통과 |
| 512MB / 0.5 CPU / swap 없음의 combined container readiness | 5개 모두 통과, Redis는 이 검증에서 로컬 사용 |
| 같은 제한의 Chromium 카드 테스트 | 3개 통과 |
| 단위·계약 테스트 | 기존 무료 구성 149개 통과, Deploy Hook 추가 테스트 7개 통과 |
| 실제 PostgreSQL·Redis·MinIO·Chromium 전체 통합 | 105개 통과 |
| Frontend tests / production build | 16개 통과 / 성공 |
| OpenAPI Validator / Ruff / Render Blueprint 서버 검사 | 통과 |
| 실제 Render 의존성 readiness | 5개 모두 통과 |
| 클라우드 의류 적재·사진 SHA256·재실행 멱등성 | 6개 확인, 추가 등록 0개 |
| 실제 Vercel 브라우저 로그인·의류·사진 표시 | 6벌·6개 사진, 사진 오류 0개 |
| GitHub Actions CI → Hook 배포 → exact revision readiness smoke | 실제 성공 |

첫 GitHub CI는 backend 계약 SHA256 검사 1개가 실패했고 다른 148개와 frontend/free-cloud-image는 성공했다. Windows CRLF와 Linux LF 차이가 원인이었다. `.gitattributes`로 기존 원래 줄바꿈을 유지하고 혼합 줄바꿈인 1.1 archive만 기존 기록 SHA256에 맞는 원래 바이트로 보존했다. 원본 설계 7개 및 SHA256 값은 변경하지 않았다. 이후 전체 CI 테스트 3개 job이 실제 성공했다.

Hook 입력 전 deploy job 실패는 필수 secret 미설정 때문이었다. secret 등록 후 실패한 배포 job만 재실행하여 성공했고 기존 테스트 성공 결과를 유지했다. 테스트 실패를 skip하거나 success로 바꾸지 않았다. 로컬 배포 확인 명령의 SHA 오입력은 실제 git HEAD를 읽도록 바로잡아 정확한 revision/readiness 검사에 통과했다. 보고서 작성 중 PowerShell 인코딩 손상은 UTF-8로 재작성했다.

Supabase S3의 Vercel origin PUT preflight도 HTTP 200, 해당 origin 허용, content-type 허용을 확인했다. 이는 실제 브라우저 이미지 조회와 CLI/API 업로드 검증을 보완하지만 의류 등록 UI의 모든 사용자 플로우를 별도로 완료 검증했다는 의미는 아니다.

## 남은 운영 제약

무료 서비스의 idle sleep과 Supabase inactivity pause, Redis 비영속성 및 무료 용량·시간 제한이 남는다. 첫 접속에는 서버 준비 지연으로 재시도가 필요할 수 있다. 강제 keep-alive를 설치하지 않는다. 실제 유료 Decart, 쇼핑 실서비스 API, 물리 LED는 검증하지 않는다. Mock 기반 로컬 통합 테스트 성공과 유료 서비스·하드웨어 검증을 구분한다. 공개 서비스를 운영 환경 수준으로 안전하거나 무중단이라고 판정하지 않는다.

공식 요금·제약: [Render Free](https://render.com/docs/free), [Supabase Free](https://supabase.com/pricing), [Vercel Hobby](https://vercel.com/docs/plans/hobby).
