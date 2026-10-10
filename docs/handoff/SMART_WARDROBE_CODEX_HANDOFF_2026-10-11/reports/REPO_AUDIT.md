# REPO_AUDIT

검사일: 2026-10-11 (KST)  
검사 저장소/브랜치: LG-CLOS-IT / main / c17e5e6  
실행 범위: P0 저장소 읽기, P1 공식 제품 조사, P2 설계·CSV 작성만  
신뢰 수준: verified=파일/공식 페이지 확인, proposed=미승인 설계, blocked=근거·권한 부족  
미확인 사항: 실행 DB 현황, 배포 상태, 실기기, 유료 VTON, 신규 화면 E2E, 이미지 재사용 허가.  
DB 연결·적재·마이그레이션·제품 코드/운영 에셋 수정·원격 push·배포 없음.

## 실제 저장소

시작 시 tracked 변경 없음. main과 dev 브랜치 존재. `docs/handoff/` 및 `docs/integration_sources/SmartCloset_Team_20261010_004919_72054c8/`는 기존 untracked 입력이다. 덮어쓰기/reset/stash 없이 유지했다. 입력 패키지는 최신 H1.0 정책이지만 실제 스키마를 미리 확인해 만든 문서가 아님(contracts/00_MASTER_CONTRACT.md:7).

| 영역 | 실제 근거 | 판정 및 보존할 구조 |
|---|---|---|
| 계약 | docs/04_FSD.md:540, docs/06_OPENAPI.yaml, docs/contracts/1.6/ | API 1.6의 보관 부분 확인·예약 점유가 명시됨. 새 H1.0의 예약 금지와 충돌 보고 필요 |
| DB | docs/07_DATABASE_SCHEMA.sql:40, backend/alembic/versions/0004_device_integration.py:13 | PostgreSQL wardrobe 스키마 + Alembic. device/member/owner를 재사용 |
| ORM | backend/app/infrastructure/db/models.py:40 | partial metadata. create_all/autogenerate 금지 주석. DDL과 실제 migrations가 기준 |
| 의류/이미지 | docs/07_DATABASE_SCHEMA.sql:48,56,72 | garment, asset, garment_state 분리. Signed URL 영속 저장 대신 asset_key/image_asset_id 유지 |
| URL | backend/app/application/assets.py:29,283 | 백엔드 발급 read_url TTL 60초. Blob 캐시는 web/src/mirror/source/imageBlobCache.js 재사용 |
| 화면 | web/src/mirror/source/MirrorHome.tsx:124, MirrorOutfitWorkspace.tsx:469,915 | 홈 추천·관리 영역 존재, AI 입어보기 통합 명칭/2–3 카드 캐러셀과 차이 |
| 옷장 | web/src/mirror/source/PhotoWardrobeStage.tsx:80, photoSceneMapping.ts:118 | 고정 사진 배경 + 영역 매핑. DB 아이템별 clean plate 레이어가 아님 |
| 카드 | renderer/src/template.mjs:6,45, web/src/mirror/source/secondHandoffActions.ts:151 | React PNG 렌더 경로 존재, 단일 minimal-v1. T1–T4 복원은 미구현 |
| VTON | backend/app/infrastructure/adapters/vton.py:23, web/src/mirror/source/integrations/decartRealtime.ts:61 | 서버 DecartAdapter는 capability unavailable. 별도 SDK realtime lucy-vton-3.6 경로는 존재. 따라서 '전부 미연결'도 '실제 VTON 완료'도 부정확 |
| LED | backend/app/api/v1/integration.py:154,220 | 명령·만료 상태/API 존재. 실제 LED 하드웨어 성공 검증은 없음 |
| 보관 | backend/app/application/sprint6.py:89,395,437,502 | 승인/완료 분리, USER 확인 후 위치 갱신. 승인 단계 예약은 새 정책과 충돌 |
| 팀원 카드 자료 | docs/integration_sources/SmartCloset_Team_20261010_004919_72054c8/src/OutfitReviewCard.tsx 및 outfitCardPresentation.ts | 별도 UI 인계 자료 존재. 이 자료의 Supabase migrations를 기존 백엔드에 그대로 실행하지 않음 |

## 필수 탐지

`rg`로 web/src, scripts, backend 및 현재 FSD에서 `21벌`, `21개`, `slice(0,21)`, `length ===21` 유형을 검색했고 일치 없음. 모든 가능한 숫자 표현/동적 런타임을 증명한 것은 아니다. 과거 history의 21벌은 실행 지시가 아니다.

트렌치 fixture는 core/seed.ts:42, demoReviewSelection.ts:17, photoSceneMapping.ts:118에 존재하지만 존재만으로 자동 반출 결함은 아니다. 실제 위험은 backend/app/domain/storage.py:157의 일반 season_tags/count 분류가 기본 유지 품목 예외를 명시하지 않는다는 점이다. 틀린 반출을 재현한 테스트는 실행하지 않았다.

카드 생성은 secondHandoffActions.ts의 명시적 요청 경로이고 추천 자동 생성 근거를 발견하지 못했다. MockVtonProvider는 결과에 MOCK 문자를 넣으며 ServerMockFitting.tsx:115는 Mock를 표기한다. 전체 화면의 Mock 표기 일관성은 브라우저 미검증.

## 수행 증적과 한계

읽기: git status/branch, rg 파일·심볼 검색, Get-Content FSD/DDL/migration/핵심 코드, 제공 PNG 육안 확인, 공식 URL web 검색·open·find·image link 확인. 보고서/CSV 자체 일관성 검사를 수행했다. DB/서비스 통합 테스트는 실행하지 않았다(쓰기 위험). 이전 Sprint 보고서 통과 기록을 이번 실행 통과로 재기재하지 않았다.

## 산출물 검토 증적

수정 범위: 이 패키지 reports의 지정 7개 MD와 templates의 기존 6개 CSV만. 원본 입력 계약/참조 이미지/제품 파일은 수정하지 않았다. 독립 cold-read는 WBS/상태 요약 발췌만 검토했으며 전체 패키지를 독립 검증했다고 주장하지 않는다. 발견한 '아들 룩 승인 여부/승인 선행조건' 모호함을 WBS에 명시했다.

factchk: 공식 출처 대조에서 URL query와 실제 표시 variant 불일치를 확인하여 PC03/09는 본문 색만 기록, PC13은 미검증으로 유지. ssotize 읽기 전용 감사: 새 계약은 contracts/00_MASTER_CONTRACT.md, 현 API 예약 정책은 docs/04_FSD.md:540와 sprint6.py:89, 제품 facts의 조사 원장은 product_candidates.csv다. 동의 없이 기존 원본을 통합·수정하지 않았다.

mandela 검토: 자체 CSV 검사만으로 제품 E2E 성공을 주장하면 verifier=designer/tautology 위험이 생긴다. 그래서 통과 범위를 CSV 구조·참조로 제한하고, 실제 DB diff/API 결과·사용자 시각 승인·권리 증빙을 별도 인수 근거로 요구했다. re0 정리: 상품 보고서를 한국어로 정리하고 후보/승인/권리의 상태 구분을 일치시켰다. detool은 구체 저장소 운영 감사이며 이식성을 주장하지 않으므로 적용하지 않았다.
