# Codex에 이 텍스트를 통째로 붙여넣기

당신은 Smart Wardrobe 기존 저장소에서 **계약 통합 및 실제 제품 기반 시드 준비**를 수행한다.

1. 현재 작업 디렉터리·Git 브랜치·미커밋 변경·프로젝트 루트부터 확인하라. 기존 변경을 덮어쓰거나 reset/stash 하지 마라.
2. 패키지 `docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/`의 `00_README_START_HERE.md`, `contracts/00_MASTER_CONTRACT.md`, `contracts/01_DATA_AND_PRODUCT.md`, `contracts/02_ASSETS_WARDROBE.md`, `contracts/03_EXPERIENCE_VTON_CARD.md`, `contracts/04_STORAGE_AGENT.md`, `execution/00_PLAN_AND_GATES.md`, `execution/01_DISCOVERY_AND_REPORT.md`를 반드시 읽어라. 실제 위치가 다르면 검색해서 찾아라.
3. **실제 프로젝트** `docs/contracts/`, `docs/04_FSD.md`, API 명세·라우트, DB ORM/DDL/마이그레이션/시드, 프론트 IA/컴포넌트, 에셋 디렉터리를 대조하라. 추측으로 경로·스키마를 만들어내지 마라.
4. 이번 턴에는 **P0 + P1 + P2(읽기·조사·계획)** 를 중단 없이 수행한다. 기존 계약/코드/DB/운영 에셋을 수정하지 않는다. `reports/`의 리포트와 `templates/`의 조사 CSV는 새로 작성·갱신할 수 있다. 사용자가 자리를 비워도 승인 질문 때문에 멈추지 말고, 미결정 사항은 `reports/DECISIONS_REQUIRED.md`에 모아라.
5. P0: 실제 파일 근거를 들어 현행 DB/API/화면과 계약 갭을 조사하고, 충돌·보존해야 할 구조·변경 대상·의존성을 표로 보고한다. 특히 기존 21벌 고정값과 잘못된 계절 이동 예시가 코드/시드에 있는지 찾는다.
6. P1: 가족 단위 관리, 시연 배우 엄마/아들, 4인 가족 및 51개 아이템은 미승인 후보라는 전제로 품목/소유자/실제 공간 후보를 정리한다. 실재 브랜드·제품·품번·색상·소재·상품 URL·공식 이미지 출처를 근거 기반으로 찾아 `templates/product_candidates.csv`에 기재한다. 인터넷/이미지 접근이 제한되면 해당 행은 `unverified`로 남기고 근거를 조작하지 않는다. 진짜 제품 검증 이전에 데이터 적재하지 마라.
7. P2: 사용자 제공 옷장 스크린샷(의류·UI가 포함된 원본)과 카드 T1–T4 참조 이미지를 확인한다. 빈 옷장 배경/행거·접힘 파생/카드 복원에 필요한 에셋과 이미지 라이선스 위험을 분석하고, 논리 ID→현행 DB 스키마 매핑·마이그레이션 예상 영향·시드 적재 및 rollback 방안을 작성한다. **이미지 대량 생성과 DB 쓰기는 금지**.
8. 산출물: `reports/REPO_AUDIT.md`, `reports/CONTRACT_GAP.md`, `reports/PRODUCT_DISCOVERY.md`, `reports/ASSET_PLAN.md`, `reports/DB_MAPPING_AND_SEED_PLAN.md`, `reports/IMPLEMENTATION_WBS.md`, `reports/DECISIONS_REQUIRED.md`, 조사 CSV. 각 보고서에 상태(`verified/proposed/blocked`), 파일 경로·행 또는 URL, 시험/검증 여부를 남겨라.
9. 최종 답변은 (a) 발견한 사실 (b) 사용자 승인 필요 결정 (c) 첫 번째 구현 마일스톤의 상세 작업 (d) 코드/DB 미변경 확인 (e) 검증하지 못한 부분 순서로 요약하라.

**우선순위**: 본 패키지 `contracts/`의 최신 확정 정책 > 승인된 기존 저장소 계약(충돌은 보고) > 과거 제안서. `references/history/`의 21벌·트렌치/데님재킷 계절 반출 예시를 실행 명령으로 읽지 마라. `README` 밖의 기존 코드가 있다고 사용자 변경 사항을 조용히 무시하지 말고 차이를 제시하라.

**금지**: 운영 DB 쓰기·마이그레이션 실행·시드 적재·외부 자료 대량 다운로드·유료 API 호출·Decart 키 출력·비밀정보 커밋·원격 push/merge·운영 배포·확정되지 않은 51개를 확정 데이터로 채우기. `main` 동작 변경 금지. 탐색 목적의 읽기 전용 명령/무해한 테스트는 가능하나 테스트가 데이터를 변경할 위험이 있다면 실행하지 않는다.
