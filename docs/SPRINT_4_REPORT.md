# Sprint 4 검증 보고서

2026-10-08 20:57 KST 기준, 기존 계획 §7의 **CARD-001~003 완료 조건을 실제로 충족했다. Sprint 4 완료**로 판정한다. 화면 프론트엔드와 Sprint 5 이후는 구현하지 않았다. Decart 유료 실제 호출 검증은 사용자 요청에 따라 모든 Sprint 종료 후 수행한다. 현재 Decart 어댑터는 capability 거부 상태이므로 실제 연동 구현·검증 완료를 주장하지 않는다.

기존 계획의 완료 조건인 **1080×1350 이미지 생성, job polling, 실패 재시도**를 모두 확인했다. 아래 Python 130개는 최종 Linux 전체 테스트이며 Windows 73개는 그 중 단위·계약의 호스트 재실행이다. 렌더러 3개는 별도 Node 테스트이고 HTTP 19개 묶음은 별도 시나리오 검증이다. 서로 합산한 총 테스트 수를 주장하지 않는다.

## 구현 결과

| 기능 | 결과 |
|---|---|
| CARD-001 | 본인 Outfit의 제목·태그·전체 슬롯·불변 이미지 참조를 카드 payload로 고정. 명시된 Context만 날짜·날씨를 포함하며 일정·위치·인물 사진은 제외. 이미지 부재는 placeholder, 권한/동의/만료 오류는 실패 |
| CARD-002 | React/CSS `minimal-v1` + 실제 Playwright Chromium. 1080×1350 PNG 및 worker의 lossless WebP 변환. DB job/outbox 원자적 등록, Celery durable poll, lease, 최대 3회 시도, backoff, 취소·늦은 결과 차단, 출력 asset 추적·정리 |
| CARD-003 | 비공개 저장·개인 목록 제목·연결 Outfit ID 재사용. SHAREABLE에만 24시간 링크, 재발급/PRIVATE/재렌더 시 기존 링크 폐기. 공유 GET은 현재 입력 권한·동의·만료를 검사해 이미지 바이트만 반환. 저장/재사용은 착용 기록을 생성하지 않음 |

렌더러는 `pwuser`로 실행하며 호스트 포트 없이 internal network에만 연결한다. 검증된 data URL만 받으며 외부 URL 요청·페이지 스크립트를 차단한다. readiness는 DB/Redis/private bucket 및 실제 Chromium 기동을 검사한다. 공유 토큰은 HMAC의 용도 구분된 입력으로 멱등하게 생성하고 카드 DB에는 SHA256만 저장한다. 멱등 캐시에 공유 bearer 문자열을 저장하지 않는 것을 실DB에서 확인했다. 토큰 만료는 재전송으로 갱신하지 않는다.

## 검증 및 증적

최종 감사: **2026-10-08T11:57:19.303426+00:00**. [최종 증적](../test-results/sprint4-final-evidence.json)에 실제 상태·명령 종료 코드·소스 해시·버전·DB catalog를 기록했다.

| 검증 | 결과 / 증적 |
|---|---|
| Python 단위·계약·실DB/S3 통합 | **130 passed, 0 failed, 0 skipped**. JWT, 공식 OpenAPI validator, Sprint 0~3 회귀 포함. [JUnit](../test-results/sprint4-tests-final.xml), [로그](../test-results/sprint4-tests-final.log) |
| 렌더러 테스트 | **3 passed, 0 failed**. 한글 및 6개 슬롯의 viewport 내 배치, 동일 payload의 동일 PNG 바이트, 외부 요청 없음, React escaping·잘못된 URL/템플릿 거부. [로그](../test-results/sprint4-renderer-tests-final.log), [6개 슬롯 PNG](../test-results/sprint4-six-slot-preview.png) |
| 실제 TCP HTTP + Celery | **19개 검증 묶음 통과**. 독립 UUID DB/API/큐/worker에서 Sprint 1~4, 실제 이미지 렌더·S3 읽기·저장·공유·폐기·재사용. [증적](../test-results/sprint4-live-evidence.json), [로그](../test-results/sprint4-live-final.log), [PNG](../test-results/sprint4-card-preview.png), [WebP](../test-results/sprint4-card-preview.webp) |
| 실패·취소·복구 | 렌더러 장애/timeout의 3회 소진, 잘못된 이미지, lease 만료, 동의 철회는 성공으로 처리되지 않음. RUNNING 취소 후 늦은 출력은 연결되지 않고 실제 S3 cleanup 후 404. 새 요청의 실제 Chromium 렌더 복구 통과 |
| 공유·권한 | 다른 member의 카드/Job 404, 미완료 공유 409, 공유 만료/PRIVATE/재발급 차단, 익명 S3 거부, 동의 철회 후 결과 객체 404, wear_event 0 |
| 빌드·배포·readiness | 고정 이미지 빌드, api/renderer/postgres/redis/minio healthy, worker running, storage-init exit 0. [빌드](../test-results/sprint4-build-final.log), [기동](../test-results/sprint4-up-final.log), [smoke](../test-results/sprint4-smoke-final.log) |
| 품질·의존성 | Ruff 및 pip check 통과. Windows 단위·계약 73개 통과. Python 3.12.9/직접 핀 18개 일치. Node v24.21.0, React/react-dom 19.3.0, Playwright 1.64.0. npm registry audit 보고 취약점 0. [audit](../test-results/sprint4-npm-audit-final.log) |
| 독립 소스 감사 | API/worker/tests 이미지와 workspace의 **97개 코드·설정 파일 집합 및 SHA256 일치**. renderer의 src/test/package/lock도 집합·해시 일치. 검증용 컨테이너·DB·S3 객체 정리 완료 |
| 기존 DB 보존 | 0002_sprint1_contract, 32 tables/10 enums, Seed member 2/garment 3. 주 DB에 카드/Job/VTON session/feedback/wear 추가 없음. Migration·Seed 원본 변경 없음 |

PNG/WebP 예제의 파란 사각형은 검증용 합성 의류 이미지다. 실제 의류 표현이나 Decart 결과의 품질을 검증한 증적이 아니다. Python의 451개 dependency deprecation warning은 실패가 아니지만 추후 의존성 갱신에서 검토해야 한다.

## 계약 보완과 변경 파일

기존 DTO가 전체 의류 슬롯·공유/재사용 응답을 표현하지 못하고 공통 Job에 VTON session이 필수인 충돌을 [구현 기준](SPRINT_4_CONTRACT_DECISIONS.md)으로 해결했다. 기존 계획 §7.1/§12의 최소 계약 개정 규칙에 따라 API **1.4.0 / 업무 operation 36개**로 보완했다. 1.3 계약의 원본 7개 파일을 바이트 그대로 `docs/contracts/1.3`에 보존하고 [개정 manifest](CONTRACT_REVISION_1_4.json)에서 이전·현재 해시를 검증했다. HLD·DDL·Seed는 변경하지 않았다. 기존 Sprint 보고서와 과거 증적은 유지한다.

- 새 구현: `backend/app/schemas/sprint4.py`, `backend/app/api/v1/sprint4.py`, `backend/app/application/sprint4.py`, `backend/app/application/card_worker.py`, `backend/app/workers/cards.py`.
- 새 렌더러: `renderer/Dockerfile`, `renderer/package.json`, `renderer/package-lock.json`, `renderer/src/{template,server}.mjs`, `renderer/test/{template,browser}.test.mjs`.
- 새 검증: `backend/tests/unit/test_card_renderer_contract.py`, `backend/tests/integration/test_sprint4_api.py`, `scripts/{smoke_sprint4,verify_sprint4}.py`.
- 연결 변경: `backend/app/{main.py,schemas/sprint3.py,api/v1/sprint3.py,workers/celery_app.py,infrastructure/resources.py}`, `infra/compose.yaml`, `scripts/tasks.py`, `Makefile`.
- 현재 계약/회귀 갱신: `docs/{04_FSD.md,05_BACKEND_LLD.md,06_OPENAPI.yaml,08_IMPLEMENTATION_PLAN.md}`, 계약·health 테스트, 기존 `scripts/verify_sprint1~3.py` 및 `smoke_sprint2~3.py`.
- 보고/추적: 이 보고서, Sprint 4 구현 기준·manifest, `README.md`, `docs/DECISIONS.md`, `docs/IMPLEMENTATION_TRACEABILITY.md`. 준비/감사 helper 및 실행 증적은 `test-results`에 보관한다.

## 검증 경계와 남은 위험

- **코드 결함:** 최종 필수 검증의 미해결 실패 없음. 최초 테스트 helper 오류는 수정 후 전체 재검증했다.
- **환경 제약:** 한글 경로 BuildKit context 문제는 기존 영문 임시 context로 빌드했다. 내부 renderer의 npm audit 외부 접근 거부는 네트워크 격리의 결과이며, 호스트에서 동일 lockfile의 registry audit를 수행했다. 시스템 권한·보안 설정은 변경하지 않았다.
- **설계 충돌:** 위 DTO/상태/공유 정책을 보완하고 과거 계약을 보존했다. renderer React는 내부 이미지 생성용이며 사용자 화면 구현이 아니다.
- **보안:** 기존 MinIO의 알려진 취약점은 해결되지 않았으며 개발 전용이다. Playwright 공식 이미지는 개발/테스트 용도이고 Chromium sandbox 기본값에 의존한다. 비루트·내부망·data-only·CSP·스크립트/네트워크 차단을 적용했지만 운영 보안 승인으로 해석하지 않는다. npm audit 0은 OS/Chromium 전체 취약점 부재의 증명이 아니다. 다운로드받은 공유 이미지는 서버에서 회수할 수 없고 이미 발급된 S3 URL은 최대 60초 유효할 수 있다. HMAC 키는 현재 JWT secret을 용도 구분해서 사용하므로 운영 시 별도 키/회전 정책이 필요하다.
- **보류:** Decart 실제 연동 구현·유료 호출 검증, Sprint 5~7 및 화면 프론트엔드의 완료를 주장하지 않는다. 유료 실제 VTON 호출은 이번에 수행하지 않았다.

공유 GET은 S3 URL을 제공하지 않으며 매번 권한을 확인하고 이미지 바이트를 반환한다. 60초 S3 URL은 인증된 카드/Job 조회에 포함된 private 이미지 URL의 잔존 한계다. 공유 링크도 개발용 loopback API에서만 접근 가능하며 인터넷 공유 서비스를 공개하지 않았다. Context는 draft 요청에 context_snapshot_id가 명시된 경우만 포함한다. 카드 payload의 이미지 ID와 불변 asset 최종 키를 유지하고 저장 제목 변경·재렌더링으로 입력을 바꾸지 않는다. is_saved는 렌더 상태와 독립이고 READY에서만 SAVED로 표시한다. lease 만료는 Job TIMED_OUT/카드 FAILED로 처리한다.

구현 참고: [Playwright 공식 Docker 지침](https://playwright.dev/docs/docker), [React static markup](https://react.dev/reference/react-dom/server/renderToStaticMarkup), [Node 릴리스 정책](https://nodejs.org/en/about/previous-releases). 검증 독립성 검토는 생성 DTO만으로 성공을 주장하지 않고 실제 Chromium/Pillow 디코딩, HTTP/S3/DB 결과, 독립 소스·해시·JUnit 감사로 보완했다. 문서 cold read에서 발견한 상태 우선순위·공유 응답·불변 이미지·토큰/lease 정책의 모호함은 구현 기준에 반영했다. SSOT는 현재 OpenAPI/구현 기준/최종 증적을 read-only 감사했으며 별도 통합·재구성은 하지 않았다.
