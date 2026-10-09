# Smart Wardrobe 구현 결정 및 미해결 사항

현재 요청 해석: 완료된 backend 계약 1.7을 기준으로 후속 프론트엔드를 설계·구현·검증하고 로컬 직접 QA에 인계한다. 선택 외부 연동과 유료 API 검증은 사용자 직접 QA 이후 진행한다. 당시 Sprint 7 백엔드 범위와 인수 결과는 해당 보고서에 보존한다.

| ID | 상태 | 내용 및 적용 범위 |
|---|---|---|
| D-001 | 적용 | 플랫폼은 08 문서의 Python 3.12, FastAPI/Pydantic v2, async SQLAlchemy/asyncpg, Alembic, PostgreSQL 16, Redis/Celery, MinIO를 따른다. 카드 렌더러는 Sprint 4에서 내부 서비스로 추가했다. |
| D-002 | 적용 | 과거 0001 SQL을 backend/alembic/baselines/0001_schema.sql로 동결하고 기존 SHA256 검증을 유지한다. 승인된 현재 DDL은 32개 테이블이며 0002_sprint1_contract가 공유·동의 이력과 보관 필드를, 0003_sprint5_history_care가 착용·케어 이력 필드를 추가한다. 기존 DB를 삭제하지 않으며 downgrade는 거부한다. |
| D-003 | 미확정 | Decart 모델·인증·endpoint·입출력·비동기 규격 및 계정 지원 범위가 확인되지 않았다. Sprint 0에서 DECART 선택은 구성 오류로 거부한다. Sprint 3에서 내부 Port와 Mock/Decart capability Adapter를 분리했다. 공식 영상/스트림 문서만으로 현재 정적 이미지 계약·계정 지원을 확정하지 않으며 실제 live 호출은 활성화하지 않는다. 미설정 live를 Mock 성공으로 대체하지 않는다. |
| D-004 | 해결 | Member.role은 OWNER/MEMBER/CHILD로 API·DB 일치. DEMO는 인증 모드이며 DB 역할을 바꾸지 않는다. 기존 두 프로필 allowlist 유지, CHILD도 자기 의류 관리 가능. 명시적 공유는 읽기 전용. |
| D-005 | Sprint 1 해결 / 후속 미확정 | Garment API는 DB의 7개 상태를 손실 없이 노출하며 WORN을 제거했다. IN_USE는 착용 확인이 아니며 관측은 wear_event를 생성하지 않는다. Card/Job은 Sprint 3~4, Care는 Sprint 5에서 해결했다. Storage는 Sprint 6에서 물리 ENUM을 그대로 노출하고 승인과 실제 위치 확인을 분리했다. |
| D-006 | Sprint 1 해결 / 후속 미확정 | care_label은 기존 JSONB scalar string/null로 저장하며 생략 시 보존한다. 동의/보관은 승인된 Sprint 1 계약으로 해결했다. Sprint 2 Context의 누락 시각은 추정하지 않고 provenance/missing_fields로 표시한다. 추천 기록은 recommendation outbox aggregate와 persisted 후보 outfit/context ID로 연결한다. Sprint 3 VTON 세션·revision 스냅샷·Mock 비동기를 구현하며 실 Decart 계약은 미확정이다. |
| D-007 | 검증 완료 | 2026-10-08 기존 직접 의존성 핀을 유지하고 pip-tools 7.5.2로 해시 포함 requirements.lock을 생성했다. Sprint 0 당시 Python 3.12.9 호스트/컨테이너의 직접 핀 17개가 모두 일치하며 Docker의 --require-hashes 설치와 이미지 빌드가 통과했다. backend의 한글 경로 BuildKit 오류는 임시 영문 경로에서 빌드했다. MinIO 복구 후 전체 서비스·readiness·smoke도 통과했다. 환경별 제한과 증적은 [Sprint 0 보고서](SPRINT_0_REPORT.md)에 기록한다. |
| D-008 | 적용 | /health/live와 /health/ready는 업무 계약 외 운영 경로이며 OpenAPI에서 제외한다. ready는 실제 PostgreSQL 현재 migration revision, Redis ping, private bucket 접근과 Chromium renderer 기동을 검사한다. 외부 서비스 실패를 healthy로 가장하지 않는다. |
| D-009 | 적용 | Sprint 1(COM-001)에 allowlisted 데모 로그인 발급을 구현했다. JWT 서명/만료/issuer/audience 검증 및 DB 주체 확인 dependency를 적용한다. 데모 인증은 private local/test에서만 허용하며 staging/production/public 설정은 부팅 거부한다. 별도 session revocation 계약은 미확정이다. |
| D-010 | 적용 | 테스트 DB는 별도 Compose profile과 휘발성 PostgreSQL 인스턴스로 분리한다. 통합 테스트는 그 안에 전용 UUID DB를 생성해 migration/seed/제약/rollback을 검사한다. 운영 DB/로컬 주 DB를 초기화하지 않는다. |
| D-011 | 로컬 적용 | MinIO RELEASE.2025-04-22T22-12-26Z를 유지한다. 공식 GitHub 바이너리의 고정 SHA-256과 공식 공개키의 Minisign 검증으로 자체 개발 이미지를 빌드하고 UID/GID 10001로 실행한다. 기존 S3 endpoint·bucket·credentials·volume 및 loopback binding을 유지한다. 해당 서버의 알려진 취약점은 미해결이며 운영 안전성을 승인하지 않는다. [Sprint 0 보고서](SPRINT_0_REPORT.md)에 배포 출처·서명·실제 CRUD·readiness·smoke 증적과 위험을 기록한다. |
| D-012 | 해결 | DELETE soft delete와 If-Match, location_id, care_label/location_label/stale, care_guide_available/url 및 locator status/fallback 계약을 추가했다. 케어 가이드는 Sprint 5에서 true와 실제 care-guide 경로로 제공하며 이전 Sprint의 false/null 응답을 실제 제공 상태로 갱신했다. |
| D-013 | 해결 | 업로드 동의 기본 false, consent_history 및 5분 PUT/60초 GET/15분 미완료/30일 완성 이미지 보관을 명세화했다. SHA256·MIME·크기·이미지 디코딩 검증 후 별도 최종 키에 저장한다. 철회는 즉시 접근 차단 및 삭제; 실패 503와 worker 정리 재시도. Sprint 2 STYLE에도 같은 동의·검증·보관 정책을 적용한다. Sprint 3 PERSON_VTON은 PERSON kind로 활성화하며 VTON_RESULT도 같은 동의·보관 정책을 적용한다. OTHER 목적은 후속 범위다. |
| D-014 | 해결 | garment_share는 같은 가구 복합 FK와 명시적 대상 지정으로만 허용한다. 소유자 및 공유 수신자만 읽기, 소유자만 수정/삭제/관측. OWNER 자동 열람은 없다. 철회 후 서명 URL은 최대 60초 유효할 수 있다. |
| D-015 | 적용 / 부분 구현 | Idempotency-Key는 물리 idempotency_key에 요청 hash·응답을 같은 트랜잭션으로 저장한다. 논리 identity의 transaction advisory lock으로 동시 재전송을 직렬화한다. 의류 수정과 관측 projection은 garment row lock 및 version으로 보호한다. outbox/audit는 상태와 함께 저장하며 dispatcher와 영구 소비 중복 방어는 Sprint 7에서 구현·검증했다. |
| D-016 | 해결 / Mock 경계 유지 | observation_id/tag_value 입력을 추가하고 garment_id 또는 tag 중 하나를 지정한다. ID 생략 시 기존 source/time UUID 유지. 동일 ID의 다른 payload는 409, 미매핑 태그는 404/no mutation. 늦거나 약한 관측은 기록만 보존, 동일 시각 위치 충돌은 UNKNOWN. MANUAL/MOCK만 동작하고 미검증 RFID/VISION은 503. |
| D-017 | 적용 | LLD 요청 제한은 실제 Redis의 atomic INCR/EXPIRE로 적용한다. API peer IP별 60초 window에서 로그인 30, 조회 600, 기타 명령 120회다. 서로 다른 API DB는 counter namespace를 분리하고 forwarded header를 신뢰하지 않는다. 초과 시 429/Retry-After, Redis 장애 시 503이며 성공으로 우회하지 않는다. |

관련 근거: [구현 순서](08_IMPLEMENTATION_PLAN.md), [API 계약](06_OPENAPI.yaml), [물리 DDL](07_DATABASE_SCHEMA.sql), [Seed](07_DATABASE_SEED.sql). 2026-10-08 사용자의 명시적 승인으로 원본 계약을 개정했다. Seed는 유지하며 과거 해시 증적은 보존한다. 상세 정책은 [Sprint 1 계약 결정](SPRINT_1_CONTRACT_DECISIONS.md)을 따른다.

프레임워크 구현 참고: [Alembic async migration](https://alembic.sqlalchemy.org/en/latest/cookbook.html#using-asyncio-with-alembic), [SQLAlchemy async session](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html), [FastAPI JWT](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/).

Sprint 2의 구체 정책과 검증은 [구현 기준](SPRINT_2_CONTRACT_DECISIONS.md), [보고서](SPRINT_2_REPORT.md), [개정 1.2 manifest](CONTRACT_REVISION_1_2.json)를 따른다. 이전 1.1 계약의 바이트는 docs/contracts/1.1에 보존한다.

Sprint 3 정책은 [구현 기준](SPRINT_3_CONTRACT_DECISIONS.md), 실제 완료 판정은 [보고서](SPRINT_3_REPORT.md)를 따른다. API 1.3.0 및 이전 1.2 계약은 [manifest](CONTRACT_REVISION_1_3.json)와 docs/contracts/1.2에 보존한다.

Sprint 4 정책은 [구현 기준](SPRINT_4_CONTRACT_DECISIONS.md), 검증과 완료 판정은 [보고서](SPRINT_4_REPORT.md)를 따른다. API 1.4와 이전 1.3의 7개 계약은 [manifest](CONTRACT_REVISION_1_4.json) 및 docs/contracts/1.3에 보존한다. DB/Seed 변경은 없다.


Sprint 5의 현재 정책은 [구현 기준](SPRINT_5_CONTRACT_DECISIONS.md), 완료 증적은 [보고서](SPRINT_5_REPORT.md)를 따른다. [1.5 manifest](CONTRACT_REVISION_1_5.json)는 이전 1.4의 7개 바이트를 contracts/1.4에 보존한다. 0003은 기존 테이블의 착용 snapshot/취소/version과 케어 반복·미수행·취소/version을 추가한다. 현재 DDL과 마이그레이션 카탈로그를 실DB에서 비교하며 HLD·Seed·0001/0002는 변경하지 않는다. CARE 상태는 SCHEDULED/COMPLETED/CANCELLED/계산된 OVERDUE로 통일했다.


Sprint 6 정책은 [구현 기준](SPRINT_6_CONTRACT_DECISIONS.md), 검증 증적은 [보고서](SPRINT_6_REPORT.md)를 따른다. [1.6 manifest](CONTRACT_REVISION_1_6.json)는 이전 1.5의 7개 바이트를 contracts/1.5에 보존한다. 기존 5개 Storage 경로의 DTO·Job 결과를 보완하며 HLD·DDL·Seed·기존 migration·Compose는 유지한다. reasoning JSONB 첫 객체에 판단 입력·item version을 고정한다. 승인 예약과 실제 점유의 용량 합산, household lock, 확인 시 재검증으로 오래된 계획·초과 배치를 거부한다. 자동 장비 이동·센서 검증·outbox dispatcher·위치/환경 설정 API는 범위 밖이다.


Sprint 7의 [구현 기준](SPRINT_7_CONTRACT_DECISIONS.md)과 [보고서](SPRINT_7_REPORT.md)가 현재 범위다. [1.7 manifest](CONTRACT_REVISION_1_7.json)는 이전 1.6 원본 7개를 contracts/1.6에 보존한다. 홈의 시간대·기준 시각·부분 집계를 명시적으로 보완했다. Outbox의 DEAD/processed_event 논리 상태를 새 테이블/ENUM으로 만들지 않고 기존 FAILED의 attempts>=5와 audit_log의 deterministic event receipt로 매핑했다. PUBLISHED는 소비 완료가 아니다. 읽음 API·외부 n8n·실센서·프론트엔드는 추가하지 않는다. HLD/DDL/Seed/기존 migration/Compose는 유지하며 실제 Decart 미구현을 Mock E2E 성공으로 대체하지 않는다.

## 후속 프론트엔드

사용자 지시에 따라 backend-first 단계 이후 화면을 구현한다. 기존 IA·API 1.7을 유지하고 원본 설계 7개·backend·Compose·Seed를 변경하지 않는다. 설계·지역 데모 프로필/위치 라벨·시간대·파일 중계·권한/작업 상태의 정책은 [프론트 설계](FRONTEND_DESIGN.md)와 [보고서](FRONTEND_REPORT.md)를 따른다. 현재 단계는 개발자 검증 후 사용자 직접 QA이며, 선택 외부 연동과 마지막 유료 API 검증은 직접 QA 이후다.
