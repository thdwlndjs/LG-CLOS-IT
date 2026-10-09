# Sprint 1 결과: 승인 계약 1.1

판정: **승인 계약 1.1의 Sprint 1 완료**. 사용자 승인으로 네 충돌을 결정하고 원본 계약을 개정했다. COM-001, GAR-001~004, STO-001, SET-001의 업무 API 13개를 구현했다. Sprint 2 이후와 프론트엔드는 진행하지 않았다. 최종 증적 감사에서 모든 검증과 sprint1_complete=true를 확인했다. 검증 시각은 2026-10-08 17:01:40 KST이며 75 passed, 0 failed, 0 skipped, 업무 operation 13개, 소스/이미지 코드 68개 파일의 정확한 목록·SHA256 및 개정 계약 7개 해시가 일치했다. Python 3.12.9 및 직접 의존성 18개 핀도 일치했다.

이전 67개 검증의 부분 완료 보고서는 [개정 전 증적](../test-results/sprint1-pre-contract-report.md)에 보존한다. Sprint 0의 과거 검증과 원본 해시는 유지한다. 이번 원본 변경은 사용자의 명시적 승인에 따른다.

## 네 충돌의 결정

| 충돌 | 결정·구현 |
|---|---|
| 역할·상태 | OWNER/MEMBER/CHILD와 DB의 의류 7개 상태를 API에 손실 없이 사용. DEMO는 인증 모드이며 WORN 제거. IN_USE 및 센서 관측은 착용 확인이 아니다. |
| 삭제·위치·상세 | If-Match soft delete, 명시적 수동 location_id, care_label/location_label/stale(24시간), locator FOUND/STALE/UNKNOWN 및 fallback. 케어 가이드는 Sprint 5 전까지 available=false/url=null. |
| 동의·보관·공유 | 이미지 동의 기본 false와 이력, 같은 가구 명시적 읽기 공유, 검증 업로드, 철회·만료 객체 삭제. 공유 수신자는 쓰기 권한을 얻지 않는다. |
| 관측 ID·태그 | observation_id/tag_value 입력 추가. ID 생략 시 기존 source/time UUID 호환. 같은 ID/내용은 재사용, 다른 내용 409. 미매핑 태그는 404/no mutation으로 계약 개정. |

정책의 기준은 [계약 결정](SPRINT_1_CONTRACT_DECISIONS.md), [DECISIONS](DECISIONS.md), [OpenAPI 1.1.0](06_OPENAPI.yaml), [DDL 1.1](07_DATABASE_SCHEMA.sql)이다. [개정 manifest](CONTRACT_REVISION_1_1.json)에 원본/현재 7개 문서 해시를 구분했다. 과거 0001 SQL은 backend/alembic/baselines/0001_schema.sql에 원본 바이트·SHA256로 동결했고 0002 전진 migration이 기존 데이터를 보존하며 현재 32개 테이블을 구성한다. 07_DATABASE_SEED.sql의 SQL과 데이터는 변경하지 않았으며 seed.py의 현재 리비전 검사만 수정했다.

## 구현과 검증

| FSD | 실제 구현 |
|---|---|
| COM-001 | 기존 두 UUID allowlist의 private demo 로그인, JWT 서명/만료/issuer/audience 및 DB 주체 확인. CHILD 응답 검증. |
| GAR-001 | 자기 소유·명시적 공유 범위, 속성/상태 필터, 일관된 count/page 및 tenant 격리. |
| GAR-002 | 상세/케어라벨/위치/시각/stale, private 이미지 GET 서명, 사실에 따른 케어 가이드 가용성. |
| GAR-003 | 등록/PATCH/soft delete/version, 수동 위치, 태그, 공유 지정·철회, 검증 이미지 업로드와 연결. |
| GAR-004 | 실제 MANUAL/MOCK 관측 저장과 ID/태그 멱등성, 늦거나 약한 관측의 덮어쓰기 방지, 동일 시각 위치 충돌 UNKNOWN. |
| STO-001 | 구조화 locator, 0건·미확인·오래된 위치와 fallback. 위치를 추측하지 않는다. |
| SET-001 | 본인 설정, 동의·철회·이력, MOCK_ONLY 연결 상태. 서버 정책과 다른 provider 403, 미연동 LIVE weather/calendar 503. |

13개 업무 operation은 `/api/v1` 아래 `POST sessions`, `GET/POST garments`, `GET/PATCH/DELETE garments/{id}`, `POST garment-observations`, `POST garments/locate`, `GET/PUT settings`, `GET settings/consent-history`, `POST assets/upload-intents`, `POST assets/{id}/finalize`다. RFID/VISION의 실제 ingress와 PERSON_VTON/STYLE/OTHER 업로드는 미구현 외부/후속 범위로 503이다. CARE-001 본문과 전체 FSD E2E-01~09를 완료했다고 주장하지 않는다.

다른 가구·공유받지 않은 의류는 404, 본인과 다른 설정/member_id·등록 owner_id는 403이다. 같은 가구 다른 소유자 필터는 허용된 공유 행만 반환한다. OWNER도 자동으로 타인의 의류를 열람하지 않는다. 공유 의류 수정·삭제·관측은 소유자만 허용한다.

등록·관측의 멱등 key 수명은 24시간, 세션 JWT TTL, upload-intent 5분, finalize 60초다. 동일 key/body는 동일 응답이며 변경 payload·만료 key는 409. 서명 URL이 포함된 멱등 응답은 재시도로 갱신되지 않으므로 새 상세 GET 또는 새 finalize key로 유효 URL을 받는다. 상태·멱등 응답·audit·outbox는 같은 트랜잭션이며 dispatcher는 기존 Sprint 7 범위다. 관측은 wear_event를 생성하지 않는다.

## 이미지 정책

PNG/JPEG/WebP, 단일 프레임, 10MiB 이하, 4096×4096 이하만 허용한다. MIME/실제 형식·길이·필수 SHA256 및 실제 디코딩을 검사한다. PUT은 staging 키에 5분, GET은 60초, 미완료 업로드는 15분, 완성 이미지는 30일이다. finalize는 검증 바이트를 별도 최종 키에 저장하므로 재사용된 업로드 URL이 최종 이미지를 변경하지 못한다. upload-intent가 최종 키를 미리 정해 asset 행에 커밋한다. 따라서 finalize 트랜잭션 rollback 후 남은 최종 객체도 그 기존 행의 키로 추적해 만료 정리한다.

동의 철회는 API의 신규 이미지 접근을 즉시 차단하고 객체를 삭제한다. 삭제 실패는 503으로 알리고 false 동의/DELETED 상태를 유지하며 재시도한다. expired/DELETED asset은 응답 이미지에서 제외한다. 의류 soft delete는 다른 의류에서 재사용하는 asset을 바로 지우지 않고 기존 동의·보관 정책을 따른다. 단일 로컬 worker의 beat가 60초마다 정리한다. 서비스 정지 시 물리 삭제는 지연되며 재기동 후 재시도한다. Seed는 자동 동의하지 않는다.

[Pillow 공식 문서](https://pillow.readthedocs.io/en/stable/reference/Image.html)와 [공식 PyPI 12.3.0](https://pypi.org/project/pillow/12.3.0/)을 확인해 디코딩 검증 의존성을 추가했다. 기존 핀을 유지하고 pip-tools 7.5.2로 해시 lock을 갱신했으며 Docker는 `--require-hashes`로 설치한다.

## 증적

| 검증 | 결과·증적 |
|---|---|
| 최종 이미지 build/해시 설치 | [build](../test-results/sprint1-v11-build-final.log) |
| Unit/JWT/OpenAPI Validator/wire/실DB·실MinIO 통합 | 75 passed, 0 failed, 0 skipped: [JUnit](../test-results/sprint1-v11-tests-final.xml), [log](../test-results/sprint1-v11-tests-final.log) |
| 실제 TCP HTTP E2E | 로그인·멱등·CRUD·관측·locator·설정·signed PUT/finalize/GET·비인증 403·공유 권한·동의 철회 후 객체 404: [JSON](../test-results/sprint1-v11-live-evidence.json) |
| 주 DB 전진 migration | 0002_sprint1_contract, 32 tables/10 ENUM와 Seed 보존: [migration](../test-results/sprint1-v11-migrate-final.log), 최종 감사의 catalog |
| 실제 Celery cleanup | 만료 staging/final 객체 삭제 후 자기 UUID fixture 제거: [log](../test-results/sprint1-v11-worker-final.log) |
| Ruff / dependencies | [Ruff](../test-results/sprint1-v11-lint-final.log), [pip check](../test-results/sprint1-v11-pip-final.log) |
| Compose/readiness/smoke | [기동](../test-results/sprint1-v11-up-final.log), [플랫폼](../test-results/sprint1-v11-platform-smoke-final.log), [Sprint 1](../test-results/sprint1-v11-login-smoke-final.log) |
| 최종 감사 | [JSON](../test-results/sprint1-v11-final-evidence.json): 실행 시각, 완료 플래그, 소스/이미지/계약 해시, 서비스 상태와 loopback, 임시 DB/API 제거 |

통합 테스트는 전용 PostgreSQL 인스턴스 안의 UUID DB에서 migration/Seed를 실행한다. ASGI도 실제 DB/Redis/MinIO를 사용하고 별도 API 컨테이너의 TCP HTTP 검증으로 실행 경로를 확인한다. 주 DB를 초기화하지 않는다. 기존 MinIO 서명/바이너리 출처 증적은 [Sprint 0 보고서](SPRINT_0_REPORT.md)를 따른다.

수정한 코드 결함은 Seed의 이전 리비전 고정 검사다. 계약 변경에 따른 기존 테스트 기대값과 새 fixture 연결도 수정했다. 실행 위치에 따라 Ruff import 분류가 달라져 app/tests를 first-party, alembic를 third-party로 명시해 일치시켰다. Windows 비ASCII BuildKit 경로와 55432 제한은 환경 제약으로 영문 staging 및 테스트 포트 reset을 사용했다. 시스템 권한·보안 설정을 변경하지 않았다. 네 설계 충돌은 승인 계약으로 해결했고 Context/케어/카드 등 후속 Sprint의 충돌은 해당 단계까지 보류한다.

## 재현 명령

Docker CLI가 가능한 호스트에 Python 3.12와 해시 lock 의존성 및 `.env`가 필요하다. BuildKit이 한글 경로를 거부하면 Sprint 0 보고서의 영문 staging 절차로 동일 파일을 빌드한다. 저장소 루트에서 실행한다.

```powershell
python -m pip install --require-hashes -r backend/requirements.lock
docker compose --env-file .env -f infra/compose.yaml --profile test build api worker storage-init tests
docker compose --env-file .env -f infra/compose.yaml up -d --no-build postgres redis minio storage-init api worker
python scripts/tasks.py migrate
python scripts/tasks.py seed
# 테스트 DB host 포트 55432를 사용하지 않는 override
docker compose --env-file .env -f infra/compose.yaml -f test-results/compose.verify.yaml --profile test up -d postgres-test
docker compose --env-file .env -f infra/compose.yaml -f test-results/compose.verify.yaml --profile test run --rm --no-deps tests python -m pytest tests/unit tests/contract tests/integration -q
python scripts/tasks.py test-e2e-sprint1
python scripts/tasks.py smoke
python scripts/tasks.py smoke-sprint1
python scripts/tasks.py lint
docker compose --env-file .env -f infra/compose.yaml exec -T api python /workspace/scripts/check_storage_cleanup.py
```

`test-e2e-sprint1`은 postgres-test를 전제로 자기 테스트 DB/API/객체만 만들고 제거한다. 전체 `test-e2e-mock`은 후속 Sprint가 없어 명시적으로 실패하는 상태를 유지한다.

## 변경 파일·남은 위험

원본 변경: HLD, FSD, LLD, OpenAPI, physical schema, 구현 계획서. 원본 Seed는 유지. 구현 변경: Sprint 1 schema/application/repository/router, assets application, object_storage/resources, 동결 baseline과 0002 migration, celery_app/storage_cleanup, 의존성/해시 lock/Ruff 설정, Compose worker beat. 검증/실행: seed/tasks/verify_sprint1/check_storage_cleanup, Makefile, unit/contract/integration 테스트. README·DECISIONS·추적표·계약 결정·이 보고서를 갱신했다. MinIO 이미지·바이너리·endpoint·버킷·loopback 포트는 유지했다.

- 기존 MinIO의 알려진 취약점은 남는다. private local 개발 검증이며 운영 안전 버전으로 승인하지 않는다. MinIO 9000/9001과 API 8000은 loopback만 사용한다.
- 공유 철회 후 기존 GET 서명은 최대 60초 유효하다. 동의 철회·보관 만료 시 삭제 실패/worker 정지로 객체가 남으면 기존 서명이 잔여 시간 동안 유효할 수 있고 물리 삭제도 지연된다.
- 개발 서버는 MinIO root 자격 증명을 사용한다. 최소 권한 S3 계정, TLS, 운영 인증/세션 철회 및 강화된 속도 제한은 운영 배포 전 검토한다.
- 이미지 디코딩은 전체 악성 파일 탐지나 개인정보 제거를 보장하지 않는다. EXIF를 제거하지 않으며 사람 사진/VTON 업로드는 지원하지 않는다.
- 33개 deprecation warning은 테스트 실패가 아니며 Starlette/httpx·Alembic 설정·botocore UTC API의 호환성 검토 사항이다. 실제 하드웨어/외부 live provider를 검증한 것으로 해석하지 않는다.

보고서의 최종 문구는 감사 후 갱신했다. 실행 이미지와의 일치 검증 범위는 업무 코드·실행 스크립트·dependency lock·역사 migration 및 원본 계약 7개이며, 보고서 자체의 이미지 내 사본은 감사 전 문서 snapshot이다. 완료 근거는 위 최종 JSON 및 현재 보고서다.
