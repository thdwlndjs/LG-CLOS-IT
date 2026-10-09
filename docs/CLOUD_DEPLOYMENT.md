# Render + Vercel 배포 기록

## 현재 상태

2026-10-09: 로컬 연결 검증과 배포 설정 준비 단계다. **클라우드 배포 완료가 아니다.** Render 및 Vercel CLI 인증과 대상 계정/팀 선택을 기다린다. Render Blueprint 서버 검증도 인증·워크스페이스 미설정으로 실행되지 않았다. 실제 배포 URL은 아직 없다.

변경은 기능 단위 Conventional Commit으로 기록하고 원격 저장소에 푸시한다. `.env`, CLI 인증정보, DB 덤프, 개인 상품 URL·사진·적재 저널은 Git 제외를 유지한다. DB 상태 변경은 Git으로 복원되지 않으므로 별도 백업과 비공개 실행 저널로 기록한다.

## 구성

- Vercel: `web/`의 기존 Vite 화면. 좌우 옷장·중앙 미러 디자인 유지.
- Render Web Service: 기존 FastAPI. 공개 HTTPS API, 개인 계정 JWT 인증.
- Render Background Worker: 기존 Celery + Beat. Mock VTON·쇼핑·LED 유지. 유료 Decart 호출 없음.
- Render Private Services: MinIO와 이미지 카드 renderer. 공용 MinIO·관리 콘솔 URL을 만들지 않는다.
- Render Postgres 및 Key Value: 외부 IP 허용 목록 `[]`, 동일 Singapore 지역.
- MinIO `/data`에 영구 디스크. 로컬 DB와 클라우드 DB는 별개다. 배포만으로 개인 의류가 이전되지 않는다. Seed도 자동 적재하지 않는다.

`render.yaml`은 유료 리소스를 포함한 검토용 Blueprint다. API·worker·MinIO는 `0.5c-512mb`, renderer는 `1c-2g`, Key Value는 `256mb`, Postgres는 `0.1c-256mb`, MinIO 디스크는 10GB다. 계정에서 표시되는 합계 비용·디스크 요금·가용 플랜을 확인한 뒤 적용한다. 실제 리소스 생성 및 비용 발생은 아직 없다.

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
- 클라우드 미검증: Blueprint 서버 validation, 디스크의 비루트 쓰기 권한, private DNS 및 포트, DB migration, worker 작업, renderer 메모리, 공개 HTTPS CORS, 실제 브라우저 로그인·이미지·코디카드 E2E.
- 기존 MinIO 바이너리는 로컬 개발용 구버전이다. private prototype에서도 업데이트·취약점·AGPL 배포 의무 검토가 남는다. 운영 환경에 안전한 버전으로 판정하지 않는다.
- 실제 클라우드 사용은 staging prototype으로 제한한다. 운영 전환은 MinIO 버전·취약점 검토 후 별도 판단한다. 배포 설정을 추가한 사실이 운영 안전성 검증을 의미하지 않는다.
- 개인 상품 사진 적재는 이미지 업로드 동의 응답을 기다린다. 준비된 이미지와 적재 계획은 비공개 폴더에 있고, 실제 적재 및 Seed 정리는 아직 실행하지 않았다.

## 배포 재현 순서

1. CLI 계정 연결 및 대상 워크스페이스/팀 선택.
2. `render blueprints validate render.yaml`로 서버 검증. Render Dashboard에서 이 저장소 Blueprint를 연결하고 비용과 입력값을 검토한 뒤 적용.
3. 각 backend 서비스에 실제 `API_PUBLIC_ORIGIN`, `CORS_ALLOWED_ORIGINS` 입력. readiness와 worker 상태 확인. 실패하면 완료 처리하지 않는다.
4. `cd web`, `npx vercel@63.1.0 link`. Vercel 프로젝트 root를 `web/`로 지정.
5. `npx vercel@63.1.0 env add VITE_API_BASE_URL production`으로 Render origin 입력 후 `npx vercel@63.1.0 --prod`.
6. Vercel이 발급한 최종 production origin을 기록하고 Render API·worker의 CORS를 갱신한다. Render readiness를 다시 확인한 뒤 실제 HTTPS 브라우저 E2E 검증.
7. 클라우드에는 최초 회원·기기가 없으므로 로그인 가능한 상태까지 별도 데이터 준비가 필요하다. 기존 `scripts/provision_integration.py`는 로컬 전용이며 클라우드에서 그대로 실행할 수 없다. 승인된 비공개 DB 이전 또는 명시적인 클라우드 관리자 provisioning 중 사용할 경로를 정하고 구현·검증한다. 배포 설정만으로 정상 로그인이 된다고 주장하지 않는다. 개인 의류 DB·사진을 자동 공개 이전하지 않는다.

공식 기준: [Render Blueprint](https://render.com/docs/blueprint-spec), [Compute plans](https://render.com/docs/compute-plans), [Private services](https://render.com/docs/private-services), [CLI](https://render.com/docs/cli), [Vercel project configuration](https://vercel.com/docs/project-configuration), [CLI login](https://vercel.com/docs/cli/login).
