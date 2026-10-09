# Render + Vercel 배포 기록

## 현재 상태

2026-10-10 재확인: 사용자 요청에 따라 클라우드 의류·사진 적재 가능 여부를 확인했다. 인증된 Render CLI의 `blueprints validate render.yaml --output json`은 여전히 6개 리소스 모두 `need_payment_info`, `valid=false`를 반환했다. 동일 워크스페이스의 서비스 목록에는 기존 `ASC`만 있고 Smart Wardrobe용 DB·API는 없다. 클라우드 적재는 실행하지 않았으며 로컬 6벌·사진 6개를 유지한다. 결제수단 등록 후 배포·계정/기기 준비·기존 등록/업로드 계약 기반 적재·중복 및 실제 사진 조회 검증이 남아 있다. 이번 확인에서 기존 서비스와 새로 전달된 팀원 소스는 변경하지 않았다.

2026-10-09: **Vercel 프론트 배포 완료, Render 백엔드 배포 차단** 상태다. 프론트 URL은 https://lg-clos-it.vercel.app 이다. Render·Vercel CLI 로그인과 Render 워크스페이스 선택은 완료했다. Render Blueprint 서버 검증은 6개 리소스에 `need_payment_info`를 반환해 실패했다. 결제수단 등록과 유료 구성 진행 확인을 기다린다. 백엔드 리소스는 생성하지 않았다. 전체 E2E 배포 완료로 판정하지 않는다.

변경은 기능 단위 Conventional Commit으로 기록하고 원격 저장소에 푸시한다. `.env`, CLI 인증정보, DB 덤프, 개인 상품 URL·사진·적재 저널은 Git 제외를 유지한다. DB 상태 변경은 Git으로 복원되지 않으므로 별도 백업과 비공개 실행 저널로 기록한다.

## 구성

- Vercel: `web/`의 기존 Vite 화면. 좌우 옷장·중앙 미러 디자인 유지.
- Render Web Service: 기존 FastAPI. 공개 HTTPS API, 개인 계정 JWT 인증.
- Render Background Worker: 기존 Celery + Beat. Mock VTON·쇼핑·LED 유지. 유료 Decart 호출 없음.
- Render Private Services: MinIO와 이미지 카드 renderer. 공용 MinIO·관리 콘솔 URL을 만들지 않는다.
- Render Postgres 및 Key Value: 외부 IP 허용 목록 `[]`, 동일 Singapore 지역.
- MinIO `/data`에 영구 디스크. 로컬 DB와 클라우드 DB는 별개다. 배포만으로 개인 의류가 이전되지 않는다. Seed도 자동 적재하지 않는다.

`render.yaml`은 유료 리소스를 포함한 검토용 Blueprint다. API·worker·MinIO는 `0.5c-512mb`, renderer는 `1c-2g`, Key Value는 `256mb`, Postgres는 `0.1c-256mb`, MinIO 디스크는 10GB다. 기본 추정은 3×$7 + $25 + $10 + $6 + 10GB×$0.25 = **월 $64.50 + PostgreSQL 저장소·추가 사용량 요금**이다. 계정에서 표시되는 합계 비용과 가용 플랜을 확인한 뒤 적용한다. Render 리소스 생성 및 유료 요금 발생은 아직 없다. 가격 근거: [공식 compute 비용 예시](https://render.com/articles/production-rails-hosting-guide), [가격표](https://render.com/pricing).

## 연결 계약

`VITE_API_BASE_URL`에는 Render API의 **HTTPS origin만** 지정한다. 경로·쿼리·인증정보를 넣지 않는다. 미설정 로컬 실행은 기존 Vite 프록시를 사용한다.

Render API와 worker의 `API_PUBLIC_ORIGIN`은 동일한 공개 API origin, `CORS_ALLOWED_ORIGINS`는 실제 Vercel origin으로 지정한다. Preview origin도 사용할 경우 정확한 origin을 개별 추가하고 `*`는 사용하지 않는다. Blueprint의 `sync: false` 값은 서비스마다 입력해야 한다.

`scripts/start_cloud.py`는 Render의 Postgres URL을 asyncpg 형식으로 변환하고, Redis 및 private service 주소를 기존 환경변수에 매핑한다. API 시작 시 비공개 버킷을 준비하고 Alembic을 실행한다. 기존 공개 버킷 정책이 있으면 중단하며 임의 삭제하지 않는다. 클라우드에서는 `APP_ENV=staging`, `PUBLIC_DEPLOYMENT=true`, `AUTH_MODE=JWT`, `DEMO_AUTH_ENABLED=false`를 강제한다. 로컬 시연 로그인 버튼은 클라우드에서 인증 수단으로 사용할 수 없다. 실제 계정·기기 연결은 기존 provisioning 절차로 별도 준비한다.

MinIO를 외부에 노출하지 않기 위해 FastAPI의 `/wardrobe-assets/{key}`가 기존 S3 서명 요청을 전달한다. 업로드는 `staging/…`의 PUT, 조회는 `assets/…`의 GET만 허용한다. MinIO가 서명과 만료를 검증하고, API는 최대 300초 서명·10MB 제한·기존 Redis 요청 제한을 적용한다. 버킷 목록·관리·삭제 요청은 전달하지 않는다. 서명된 URL을 로그나 문서에 저장하지 않는다. 이 경로는 운영 경로로서 기존 business OpenAPI에 추가하지 않는다.

## 검증 및 남은 항목

- 프론트 TypeScript/Vite 빌드 통과, Node 테스트 15개 통과(기존 13개 + cloud origin 검증 2개).
- 새 relay 허용·차단 조건 테스트 9개 통과.
- backend 단위·계약 테스트 총 129개 통과. 최초 실행의 Windows 기본 임시 폴더 접근 오류 7건은 저장소 내 별도 임시 경로로 재실행해 해소했다. 시스템 권한은 변경하지 않았다.
- 실제 로컬 MinIO로 서명 PUT → GET → 바이트 SHA256 일치 확인. 임의 테스트 오브젝트는 삭제했다. 실제 의류 DB는 변경하지 않았다.
- 서명 변형·버킷 목록 접근·10MB 초과 요청 차단 확인. 이 결과는 로컬 실제 MinIO 검증이며 Render 네트워크 검증을 대체하지 않는다.
- 로컬 Compose의 MinIO·Redis가 실행 중인 상태에서 `python scripts/check_storage_relay.py`로 재현한다. 생성한 테스트 객체는 finally에서 삭제한다.
- Render CLI 2.28.0 공식 릴리스 ZIP의 공식 SHA256SUMS 대조 통과. CLI 인증정보는 사용자 디렉터리에 보관하며 저장소에 넣지 않는다.
- Render 서버 validation 실패: `need_payment_info`. 디스크의 비루트 쓰기 권한, private DNS 및 포트, DB migration, worker 작업, renderer 메모리, 공개 HTTPS CORS, 실제 브라우저 로그인·이미지·코디카드 E2E는 미검증이다.
- 기존 MinIO 바이너리는 로컬 개발용 구버전이다. private prototype에서도 업데이트·취약점·AGPL 배포 의무 검토가 남는다. 운영 환경에 안전한 버전으로 판정하지 않는다.
- 실제 클라우드 사용은 staging prototype으로 제한한다. 운영 전환은 MinIO 버전·취약점 검토 후 별도 판단한다. 배포 설정을 추가한 사실이 운영 안전성 검증을 의미하지 않는다.
- 로컬 실제 의류 6벌과 사진 6개는 적재·조회 검증했고 Seed는 retired 처리했다. [로컬 적재 결과](OWNED_GARMENT_IMPORT_RESULT.md)를 따른다. 클라우드 DB에는 이전하지 않았다.

## 배포 재현 순서

1. CLI 계정 연결 및 대상 워크스페이스/팀 선택.
2. `render blueprints validate render.yaml`로 서버 검증. Render Dashboard에서 이 저장소 Blueprint를 연결하고 비용과 입력값을 검토한 뒤 적용.
3. 각 backend 서비스에 실제 `API_PUBLIC_ORIGIN`, `CORS_ALLOWED_ORIGINS` 입력. readiness와 worker 상태 확인. 실패하면 완료 처리하지 않는다.
4. 저장소 루트에서 `vercel link --project lg-clos-it --scope thdwldnjs`. Vercel 프로젝트 root를 `web/`로 지정한다. CLI에 제출하는 디렉터리는 저장소 루트여야 한다.
5. `vercel env add VITE_API_BASE_URL production`으로 Render origin 입력 후 `vercel --prod`.
6. Vercel이 발급한 최종 production origin을 기록하고 Render API·worker의 CORS를 갱신한다. Render readiness를 다시 확인한 뒤 실제 HTTPS 브라우저 E2E 검증.
7. 클라우드에는 최초 회원·기기가 없으므로 로그인 가능한 상태까지 별도 데이터 준비가 필요하다. 기존 `scripts/provision_integration.py`는 로컬 전용이며 클라우드에서 그대로 실행할 수 없다. 승인된 비공개 DB 이전 또는 명시적인 클라우드 관리자 provisioning 중 사용할 경로를 정하고 구현·검증한다. 배포 설정만으로 정상 로그인이 된다고 주장하지 않는다. 개인 의류 DB·사진을 자동 공개 이전하지 않는다.

공식 기준: [Render Blueprint](https://render.com/docs/blueprint-spec), [Compute plans](https://render.com/docs/compute-plans), [Private services](https://render.com/docs/private-services), [CLI](https://render.com/docs/cli), [Vercel project configuration](https://vercel.com/docs/project-configuration), [CLI login](https://vercel.com/docs/cli/login).

## Vercel 에이전트 설정 — 2026-10-09

사용자가 지정한 [공식 설정 지침](https://vercel.com/get-started.md)을 내려받아 수행했다. 이 절차는 전역 도구 설정이며 프로젝트 배포와 구분한다.

| 항목 | 확인된 상태 |
| --- | --- |
| CLI | `npm install --global vercel@latest` 완료. `vercel --version` 63.1.0, `vercel whoami` 인증 성공 |
| 가이드 | `vercel@openai-curated` 플러그인 0.21.3, revision `11c74d6b`, 사용자 범위 설치·활성화 확인. standalone skills는 중복 설치하지 않음 |
| 설치 경로 | `%USERPROFILE%/.codex/plugins/cache/openai-curated/vercel/11c74d6b` |
| 명령 파일 | 설치된 `commands/status.md` 등 확인. 현재 대화에서 slash command 로딩 여부는 미검증 |
| MCP | `codex mcp add vercel --url https://mcp.vercel.com` 완료. 공유 endpoint, enabled, OAuth 로그인 확인 |
| MCP 설정 | `%USERPROFILE%/.codex/config.toml`에 사용자 공통 설정. 기존 unrelated 설정·승인 정책 유지 |
| 인증 읽기 확인 | CLI `vercel teams ls` 및 teams API 조회 성공. **MCP `list_teams` 호출 성공을 의미하지 않음** |
| 남은 확인 | 현재 대화에 새 MCP tools를 로드하는 기능이 없어 documentation search·MCP `list_teams` 미검증. Codex 새 세션에서 도구를 로드한 뒤 두 read-only 호출 필요 |

`npx plugins add vercel/vercel-plugin`은 Windows의 Codex 실행 파일 자동 감지에 실패했다. `--target codex --scope user --yes` 재시도도 내부 `spawnSync codex ENOENT`로 실패했다. 설치 도구가 선택한 동일 대상에 `codex plugin add vercel@openai-curated --json`을 직접 실행해 성공했고, marketplace별 plugin list에서 installed/enabled를 확인했다.

MCP 변경 작업은 사용자 확인을 유지한다. 현재 절차에서는 MCP를 통한 리소스 변경을 실행하지 않았다. 인증정보·일회성 승인 URL은 저장소에 기록하지 않는다. 전역 설정 단계에서는 프로젝트를 생성하지 않았고, 이후 사용자의 배포 지시에 따라 아래 배포를 수행했다.

## 실제 Vercel 배포 — 2026-10-09

- 프로젝트: `thdwldnjs/lg-clos-it`, 기존 다른 프로젝트는 변경하지 않았다.
- GitHub `thdwlndjs/LG-CLOS-IT` 연결. Git 빌드의 root directory를 `web`으로 설정했다.
- 최초 CLI production deployment: `dpl_Ajj8sp1AwpB22ZXmoZQsBENRxch7`, 상태 `READY`.
- 고정 URL: https://lg-clos-it.vercel.app
- Vercel 원격 TypeScript·Vite 빌드 성공. 500kB 번들 경고는 남아 있다.
- 익명 HTTP 조회 200. 실제 Chromium 1920×1080에서 렌더링 확인, page error 0, 관찰한 자산 요청 6개 중 실패 0. 좌우 옷장과 중앙 미러 화면을 스크린샷으로 직접 확인했다.
- 비공개 증적: `test-results/vercel-frontend-20261009.json`, `test-results/vercel-frontend-20261009.png`.
- 현재 `VITE_API_BASE_URL`은 미설정이다. Render API가 아직 없으므로 API 요청·계정 로그인·실제 의류·이미지·VTON·코디카드·LED는 작동 완료로 보고하지 않는다. 이 배포는 **프론트 화면 공개 단계**다.
- Render 결제수단 등록 후 서버 validation → 실제 backend 리소스 생성 → HTTPS API origin/CORS 설정 → Vercel 재배포 → 통합 브라우저 E2E 순서로 이어간다.
