# Sprint 0 결과

상태: **Sprint 0 완료 — private local 개발 환경의 플랫폼 필수 검증 기준**. 기존 MinIO 서버 버전을 유지한 자체 이미지에서 공식 SHA-256·Minisign 검증, 비루트 기동, 버킷 초기화, 실제 S3 업로드·다운로드·삭제, readiness 및 smoke가 모두 통과했다. 업무 API·Sprint 1·프론트엔드는 구현하지 않았다. **이 판정은 운영 배포의 보안 승인이 아니다. 기존 MinIO에는 알려진 취약점이 남는다.**

## 범위와 환경

2026-10-08 요청 해석: 기존 설계의 MinIO·S3 인터페이스·버킷을 유지하고, 공식 레거시 바이너리를 검증한 로컬 이미지로 pull 장애를 해결한다. 실제 검증 실패를 숨기지 않으며, 원본 설계 문서 7개를 변경하지 않는다.

현재 세션은 `danger-full-access`, approval policy는 `never`다. Docker·네트워크 접근이 가능해 별도 승인 요청은 사용하지 않았다. 호스트 ACL·방화벽·서비스·보안 설정은 변경하지 않았다. MinIO 포트 9000/9001은 모두 `127.0.0.1`에만 publish하며 외부 인터넷 공개 설정을 추가하지 않았다.

Sprint 0 구현 범위는 FastAPI 플랫폼, 설정·로그·오류·JWT dependency, async DB·UnitOfWork, 원본 SQL baseline·Seed, PostgreSQL·Redis·MinIO·Celery Compose다. [추적표](IMPLEMENTATION_TRACEABILITY.md)는 FSD 28개/API 45개 operation을 후속 Sprint와 연결한다.

판정 기준은 [구현 계획의 Sprint 0](08_IMPLEMENTATION_PLAN.md)의 boot → migration → seed → health와 이번 요청의 필수 검증이다. 고정 의존성 설치·버전, 이미지 빌드·기동, 실제 PostgreSQL Migration·Seed 멱등성, JWT·OpenAPI·Ruff·실DB 통합, MinIO 출처·hash·서명·비루트·CRUD, API readiness·smoke가 모두 통과했다. Git 저장소가 없으므로 실제 clean clone 검증은 수행하지 않았으며, 완료 판정은 아래 재현 절차와 환경 제약을 가진 이 로컬 개발 환경에 한정한다.

## MinIO 바이너리와 이미지

서버는 `RELEASE.2025-04-22T22-12-26Z`, commit `0d7408fc9969caf07de6a8c3a84f9fbb10a6739e`를 유지했다. Linux amd64에서 실제 빌드·실행했다. arm64용 hash도 recipe에 포함하지만 arm64 실행은 검증하지 않았다.

- 바이너리 출처: [공식 GitHub 릴리스](https://github.com/minio/minio/releases/tag/RELEASE.2025-04-22T22-12-26Z)의 `minio.linux-amd64.RELEASE.2025-04-22T22-12-26Z`.
- SHA-256: `53e2a2cb16c5366ea6fbbc479c19ddb4c6a0948273e752f740fb1fbf27bb817c`. Dockerfile의 고정값, 공식 checksum 파일, 실제 바이너리가 모두 일치했다.
- 공개키 출처: 해당 공식 릴리스의 [Dockerfile.release](https://github.com/minio/minio/blob/0d7408fc9969caf07de6a8c3a84f9fbb10a6739e/Dockerfile.release). 공개키 `RWTx5Zr1tiHQLwG9keckT0c45M3AGeHD6IvimQHpyRywVWGbP1aVSGav`를 recipe에 고정했다.
- Minisign 0.12-r0으로 바이너리 서명과 trusted comment 서명을 검증했다. no-cache 빌드 로그에 `Signature and comment signature verified`가 기록돼 있다. hash·서명 실패 시 빌드가 중단된다.
- 원본 바이너리는 검증에 성공하고, 1바이트를 추가한 복사본은 서명 검증 실패 및 hash 불일치로 거부되는 음성 검증도 통과했다.
- 기반 이미지는 Alpine 3.22.2의 digest `sha256:4b7ce07002c69e8f3d704a9c5d6fd3053be500b7f1c69fc0d80990c2ad8dd412`에 고정했다. 직접 설치하는 curl·CA certificates·빌드용 Minisign 버전도 고정했다.
- 최종 이미지는 `USER 10001:10001`이고 실제 MinIO 프로세스 UID도 10001이다. /data를 해당 사용자 소유로 만들었으며 기존 named volume에서 실제 쓰기가 성공했다. root 실행이나 권한 우회는 하지 않았다.
- 이미지명은 `smart-wardrobe-minio:RELEASE.2025-04-22T22-12-26Z-local`이다. 이는 공식 바이너리를 로컬에서 포장한 자체 이미지이며 공식 배포 컨테이너로 표시하지 않는다.
- 실행 중 이미지 ID는 `sha256:51a6d74d73e1dae101c3bd90fb034396f092b8e04c4265f500ca9f2113c3ebd4`다. 공식 라이선스와 checksum·서명·검증 확인 파일은 이미지의 /usr/share/minio에 포함했다.

Compose 변경은 MinIO의 이미지 이름과 build 정의뿐이다. `STORAGE_ENDPOINT=http://minio:9000`, `wardrobe-assets` 버킷, 기존 credentials, path-style S3 client, /data volume, console port, healthcheck를 유지했다. .env와 backend Storage adapter는 변경하지 않았다.

## 실제 검증 결과와 증적

증적은 저장소 루트의 `test-results/`에 있다. 실행 로그의 짝인 JSON은 명령과 종료 코드를 기록한다. 아래의 새 검증은 기존 실패 로그를 성공 근거로 대체하지 않고 별도 이름으로 남겼다.

| 검사 | 결과 | 증적 |
|---|---|---|
| 공식 hash·서명 / no-cache 이미지 빌드 | 통과, exit 0 | `sprint0-minio-build.log/.json` |
| 원래 workspace에서 MinIO Compose build | 통과, exit 0 | `sprint0-minio-workspace-build.log/.json` |
| 비루트 실제 사용자·서버 버전·binary hash | UID 10001, 버전/hash 일치 | `sprint0-minio-runtime.log/.json` |
| 변조 바이너리 거부 | hash·서명 모두 거부 | `sprint0-minio-tamper.log`, `sprint0-minio-evidence.json` |
| 전체 개발 서비스 기동 | PostgreSQL·Redis·MinIO·API·worker 실행 | `sprint0-storage-final-up.log/.json`, `sprint0-storage-services.log` |
| MinIO health | HTTP 200, healthy | `sprint0-minio-health.log/.json` |
| storage-init | Exited (0), 기존 private bucket 확인 | `sprint0-storage-init-log.log`, `sprint0-minio-evidence.json` |
| storage-init 재실행 | 통과, exit 0 | `sprint0-storage-init-replay.log/.json` |
| 실제 S3 업로드 | 기존 버킷에 고유 임시 key·65,536바이트 저장 | `sprint0-storage-crud.log/.json` |
| 실제 다운로드·익명 접근 거부 | 전체 bytes 일치, 익명 GET 403 | 동일 CRUD 증적 |
| 실제 삭제 | 삭제 뒤 head_object HTTP 404 | 동일 CRUD 증적. 검증 key만 제거 |
| 실제 API readiness | HTTP 200, database/redis/storage 모두 ok | `sprint0-minio-evidence.json` |
| Sprint 0 smoke | live/ready/openapi/docs 모두 HTTP 200, exit 0 | `sprint0-storage-smoke.log/.json` |
| 단위·계약·실DB 통합 | **51 passed, 0 failed, 0 skipped**, exit 0 | `sprint0-storage-tests.log/.xml/.json` |
| JWT·OpenAPI Validator | 고정 버전으로 전체 테스트에 포함, 통과 | PyJWT 2.10.1, openapi-spec-validator 0.7.2 |
| Ruff·pip check | 고정 Ruff 0.11.13 / broken requirements 없음 | `sprint0-storage-lint.log`, `sprint0-storage-pip-check.log` |
| 호스트 port bindings | MinIO의 9000/9001 모두 127.0.0.1 | `sprint0-minio-evidence.json` |
| 원본 설계 7개 보존 | 기존 baseline과 SHA-256 일치 | `sprint0-minio-evidence.json`, `sprint0-completion.json` |

pytest 증적에서 JWT는 `tests/unit/test_authorization.py`의 roundtrip·변조·만료/claims 거부 검사, OpenAPI는 `tests/contract/test_design_contracts.py::test_openapi_31_with_official_validator`, 실DB는 `tests/integration/test_postgres_platform.py::test_real_postgres_baseline_and_seed`에 대응한다. 이 경로들은 컨테이너 기준이며 호스트에서는 `backend/` 아래에 있다. 실제 S3 검증은 pytest 51개와 별도로 CRUD 스크립트 및 runtime 감사 증적을 사용한다.

원본 보존 비교는 이번 변경 전에 작성된 `test-results/design-hashes.json`을 사용했다(파일 LastWriteTime: 2026-10-08 14:17:50 KST). 대상은 `03_ARCHITECTURE_HLD_v1.1.md`, `04_FSD.md`, `05_BACKEND_LLD.md`, `06_OPENAPI.yaml`, `07_DATABASE_SCHEMA.sql`, `07_DATABASE_SEED.sql`, `08_IMPLEMENTATION_PLAN.md`의 7개다. 최종 검사에서 모두 기존 SHA-256과 일치했다.

직접 의존성 17개의 호스트/컨테이너 버전 일치와 해시 포함 Python lock 설치는 앞선 검증의 `sprint0-versions.json`, `sprint0-compose-locked-build.log`에 기록돼 있다. 이번에도 동일 lock 기반 backend 이미지를 빌드해 전체 테스트와 lint·pip check를 통과했다: `sprint0-storage-backend-build.log/.json`.

실제 주 DB Migration 두 번·Seed 재실행은 앞선 `sprint0-migration.log`, `sprint0-migration-replay.log`, `sprint0-seed-first.log`, `sprint0-seed-second.log`에서 통과했다. `sprint0-db-catalog.log`는 30개 테이블·10개 ENUM을 확인하며, `sprint0-seed-idempotency.json`은 30개 테이블 전체 행 snapshot의 재실행 전후 동일성을 기록한다. 이번 실DB 통합 테스트도 독립 UUID DB에서 Migration·Seed를 각각 두 번 실행하고 catalog·tenant FK·confidence CHECK·UnitOfWork rollback을 검증한 뒤 그 임시 DB만 삭제했다. 주 DB를 초기화하지 않았다.

Seed는 household 1, member 2, garment 3, storage_location 2, outfit_item 3이며 wear_event는 0이다. 저장 코디를 실제 착용으로 처리하지 않는다. 최종 pytest에는 기존 Starlette/httpx 및 Alembic path_separator deprecation warning 3건이 남았으며 실패나 skip은 아니다.

## 해결한 장애와 검증 한계

- 기존 공식 컨테이너 pull 거부는 제품·서버 버전을 바꾸지 않고 공식 GitHub 바이너리 기반 자체 이미지로 해결했다. `dl.min.io`의 종료된 다운로드 경로에는 의존하지 않는다.
- backend BuildKit의 한글 경로 오류는 기존처럼 임시 영문 빌드 경로에서 동일 소스와 Dockerfile로 빌드했다. MinIO의 좁은 build context는 원래 workspace에서도 성공했다. 원래 한글 경로에서 backend 직접 build가 성공했다고 주장하지 않는다.
- 테스트 DB의 Windows 포트 55432 바인딩 제한은 기존 검증용 override로 호스트 port만 제거하고 Compose 내부망에서 테스트했다. 시스템 포트·보안 설정을 변경하지 않았다.
- 마지막 runtime 증적 도구는 Windows CP949 decoding 및 일회성 컨테이너 삭제 경합으로 한 번 실패했다. 도구에 UTF-8을 명시하고 one-off 컨테이너를 제외한 뒤 실제 검사 전체를 재실행해 exit 0을 확인했다. 서비스 실패를 건너뛰거나 readiness를 mock으로 대체하지 않았다.
- 기존 D-004~006의 API/DB 역할·상태·care_label 충돌은 후속 업무 구현 전에 검토할 미확정 사항이다. 이번 플랫폼 검증의 실패 원인은 아니며 임의로 매핑을 확정하지 않았다.

## 남은 보안 위험

**동일 버전 유지로 기존 서버의 취약점은 해결되지 않았다.** 공식 [GHSA-hv4r-mvr4-25vw](https://github.com/minio/minio/security/advisories/GHSA-hv4r-mvr4-25vw)는 이 버전을 포함한 커뮤니티 릴리스의 unsigned-trailer 인증 우회와 객체 쓰기 위험을 설명한다. [공식 저장소](https://github.com/minio/minio)는 커뮤니티 유지보수 종료를 안내한다.

비루트 실행·loopback publish·private bucket·서명 검증은 서버 취약점의 패치가 아니다. 현재 이미지는 개발자와 로컬 Docker 컨테이너를 신뢰하는 환경에서 합성·데모·테스트 데이터에만 사용한다. TLS 없는 HTTP와 기존 관리자 credentials 공유도 유지되므로 인터넷 공개·민감한 운영 데이터·공유 운영 서비스에 사용하지 않는다. 운영 배포에는 별도의 패치된 배포판/지원 경로 선정과 검증이 필요하다.

전체 OS/서버 CVE 스캔 및 이미지의 바이트 단위 재빌드 동일성은 검증하지 않았다. 기반 digest와 직접 APK 버전은 고정했으나 전이 APK 저장소의 장기 보존까지 보장하지 않는다. 실제 설치 패키지 목록과 실행 이미지 ID를 증적으로 남겼다. amd64 이외 환경의 성공은 주장하지 않는다.

## 이번 변경 파일

| 파일 | 변경 |
|---|---|
| `infra/minio/Dockerfile` | 공식 binary hash·Minisign 검증, pinned base, non-root runtime, 라이선스·검증 파일 |
| `infra/compose.yaml` | MinIO 자체 이미지 이름과 좁은 build context 추가 |
| `scripts/check_storage.py` | private local/test용 실제 S3 CRUD·익명 읽기 거부·임시 key 정리 |
| `README.md` | 로컬 완료 상태·MinIO 개발 전용 위험·검증 명령 |
| `docs/DECISIONS.md`, 이 보고서 | MinIO 배포 결정과 실제 최종 증적 |
| `test-results/run_check.py` | 명령·종료 코드 기록 도구의 UTF-8 출력 수정 |
| `test-results/check_minio_evidence.py` | 비밀값을 제외한 runtime·port·readiness·버킷 정책·서명 변조·원본 보존 감사 |
| `test-results/`의 증적 파일 | 실행 로그·JSON/XML·최종 완료 조건 검사 결과. gitignore 대상 |

원본 설계 7개·.env·S3 설정·버킷 이름·DB schema·업무 API는 변경하지 않았다. Sprint 1·프론트엔드는 진행하지 않았다. Git 저장소가 없어 commit은 생성하지 않았다.

## 재현과 실행 상태

현재 workspace에서 MinIO 자체 빌드와 검증을 재현하는 명령이다. 기존 .env와 준비된 DB/Redis가 필요하며, 새로운 환경은 README의 bootstrap·Migration·Seed 순서를 먼저 따른다.

```powershell
docker compose --env-file .env -f infra/compose.yaml build --no-cache minio
# 새 backend 이미지가 필요하면 아래 영문 경로 절차로 api worker storage-init tests를 먼저 빌드
docker compose --env-file .env -f infra/compose.yaml up -d --no-build postgres redis minio storage-init api worker
docker compose --env-file .env -f infra/compose.yaml exec -T api python /workspace/scripts/check_storage.py
.venv/Scripts/python.exe scripts/smoke.py
```

backend의 한글 경로 BuildKit 오류가 재현되면 기존 .env와 변경된 소스를 포함한 동일 프로젝트 복사본을 영문 경로에 준비하고, 그 경로에서 `docker compose --env-file .env -f infra/compose.yaml --profile test build api worker storage-init tests`를 실행한다. 이번 backend 빌드 경로는 `$env:TEMP/wardrobe-sprint0-build`이고 정확한 인자는 `sprint0-storage-backend-build.json`에 있다. Compose의 `name: smart-wardrobe`가 같아 원래 경로에서 동일 이미지·서비스를 기동한다. 외부 공개를 위해 포트 바인딩을 확장하지 않는다.

실DB 통합 검증의 `test-results/compose.verify.yaml`은 다음과 같다. 이 디렉터리는 gitignore 대상이므로 다른 환경에서 해당 검증을 재현하려면 별도로 생성한다.

```yaml
services:
  postgres-test:
    ports: !reset []
```

```powershell
docker compose --env-file .env -f infra/compose.yaml -f test-results/compose.verify.yaml --profile test up -d --no-build --wait postgres-test
docker compose --env-file .env -f infra/compose.yaml -f test-results/compose.verify.yaml --profile test run --rm --no-deps tests python -m pytest tests/unit tests/contract tests/integration -q -p no:cacheprovider
```

2026-10-08 최종 검사 시점에 MinIO·PostgreSQL·Redis·API·worker·postgres-test는 실행 상태이며 storage-init은 정상 종료 상태였다(`sprint0-minio-evidence.json`). 기존 volume은 보존했다. CRUD 검증은 자신이 생성한 고유 key만 삭제했다. **필수 플랫폼 검증이 실제 통과했으므로 로컬 개발 범위의 Sprint 0를 완료로 판정하며, Sprint 1 착수나 운영 배포 승인을 의미하지 않는다.**
