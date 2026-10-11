# B단계 체크포인트

2026-10-12 · 작업 시작 전 기준 `6895603` · 브랜치 `feat/handoff-p3-p10`

**상태: PARTIAL, B 완료 아님. C~G 실행 금지.** 최신 사용자 지시는 B 구현만 승인했다. 운영 DB, 원격 push/배포, 유료 API, 실물 LED는 승인되지 않았고 실행하지 않았다.

이해한 범위: 원본76과 승인 행거21을 보존하며 오른쪽 선반·개인별 관심·합성 생활 데이터만 구현하고 실제 DB·브라우저로 검사한다. 상세 결과의 기준 문서는 [STAGE_B_IMPLEMENTATION_REPORT](STAGE_B_IMPLEMENTATION_REPORT.md), 추적표는 [STAGE_B_REQUIREMENTS.csv](STAGE_B_REQUIREMENTS.csv)이다.

완료한 B 데이터/기술 검사:
- 기존76개 전체 garment 행과 기존 위치/상태·asset 행 해시 보존. 왼쪽21의 승인 bounds 및 파일 불변.
- 오른쪽 기존38+신규28=66벌,11칸×6벌. 총 보유104벌, 실제 표시87벌, 표시 ID 중복0.
- 김수진/최휘재 관심 각3건, 상대 상세404. 착용·Context 각54건, 현재 합성 Context 각1개, 미래 일정 각2개. 합성 출처를 DB와 Context API에서 구분.
- 동일 시드2회 재실행 전후13개 테이블의 전체 행 해시 불변. Mock 동일 칸 anchor 중복 제거 검증.
- 기존 백엔드 회귀297건 통과, 신규 B fixture2건 실패는 수정 후 집중8건 모두 통과. fixture 수정 후 전 스위트를 다시 돌리지는 않았고 집중8건을 재실행했다. 프론트 빌드·39개 단위 테스트·Ruff 통과. 두 프로필 브라우저 오류0.

남은 B 항목:
1. POC-D02 시각 FAIL: 기존35개 파생 에셋의 정면 접힘/세로 여백 때문에 원본 측면 접힘·크기·밀도를 재현하지 못함. 승인 행거와 원본 상품 사진을 건드리지 않고 해당 제품의 측면 파생 표시를 해결해야 한다. 원본의 11칸 각각 좌우2묶음×3벌, 측면 형태·크기·묶음 간격·선반 바닥 접점을 실제 브라우저 캡처와 비교한다. 현재 스크린샷으로 합격 처리하지 않는다.
2. POC-D02 위치 PARTIAL: Scene/LED는 물리 칸을 쓰지만 일반 상세/위치/수용량 조회는 기존 source 슬롯을 유지한다. 원본 state를 보존하는 호환 바인딩을 일관된 조회로 연결해야 한다.
3. 위 두 항목 해결 후 B 검증 증적을 갱신하고 사용자 검수를 받아야 한다. C~G를 먼저 구현하지 않는다.

초기 범주 필터 오류로 신규36개를 만들었다가 AVAILABLE OUTER8도 재사용할 수 있음을 확인했다. 이번 작업에서 만든 참조 없는 복제8개만 트랜잭션으로 회수했고, 기존76개 삭제는0이다. 이후104개 상태로 시드·멱등성·DB/API·브라우저를 재검사했다. 회수 ID와 사유는 evidence/stage-b/excess-fixture-rollback.json에 있다.

재개 환경: 격리 로컬 PostgreSQL `wardrobe_test_remediation`, API18081, Vite5193, MinIO19000, Redis16379, renderer3300. 프로젝트 루트에서 `scripts/remediation_local.py serve`; 적재 `scripts/stage_b_seed.py`; 검사 `scripts/stage_b_verify.py`, `stage_b_idempotence.py`; web에서 `node test/stage-b-browser.mjs`. 실행 환경변수와 자세한 명령은 결과 보고서에 있다. `stage_b_compartments.py`만 기존 MOCK LED 명령을 만든다.

산출물: Migration0005, 개인 관심 DB/API, Scene 물리 칸 바인딩, 시드·검사4개 스크립트, 독립 DB/브라우저 검사, 보고서·추적표·증적. 로컬 커밋 메시지는 `feat(poc): add stage B demo data and compartment bindings`이며 해시는 Git log와 최종 보고 메시지에서 확인한다. 원격에는 보내지 않는다.

## Local commit checkpoint

Implementation and evidence: `6f108ba` (`feat(poc): add stage B demo data and compartment bindings`). Base contract commit: `6895603`. Status remains **PARTIAL**. No remote push. Test log encoding and trailing whitespace were normalized without changing recorded outcomes.
