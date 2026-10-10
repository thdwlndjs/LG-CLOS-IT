# IMPLEMENTATION_WBS

검사일: 2026-10-11 (KST)  
검사 저장소/브랜치: LG-CLOS-IT / main / c17e5e6  
실행 범위: P0 저장소 읽기, P1 공식 제품 조사, P2 설계·CSV 작성만  
신뢰 수준: verified=파일/공식 페이지 확인, proposed=미승인 설계, blocked=근거·권한 부족  
미확인 사항: 실행 DB 현황, 배포 상태, 실기기, 유료 VTON, 신규 화면 E2E, 이미지 재사용 허가.  
DB 연결·적재·마이그레이션·제품 코드/운영 에셋 수정·원격 push·배포 없음.

## 단계/게이트

현재 P0–P2 문서·조사 수행. **G1 사용자 승인 대기**, P3 이후 미착수. P1은 전체 51개나 카드의 모든 SKU 확보 완료가 아니라 근거 있는 핵심 후보 조사 및 부족 목록 산출 상태.

| 작업 | 선행 | 난도 | 산출/인수조건 |
|---|---|---|---|
| P3a-01 원본/권리/좌표 | G1, 이미지 승인 | 높음 | clean plate·거울 반사 보존·부위별 마스크, A–G 실측 |
| P3b-01 provenance/namespace | G1, 후보·소유 승인 | 중간 | 현행 DB 호환 매핑 및 로컬 dry-run·rollback 구현 |
| P3b-02 최소 로컬 적재 | P3b-01, 해당 이미지 READY | 중간 | 재실행 diff=0, 기존 사용자 0변경, FK/hash 통과 |
| P3a-02 파생/카드 원본복원 | 권리/원본 승인 | 높음 | 별도 Gate A; 가림 재구성 표기, T1–T4 독립 geometry |
| P4 digital twin/search LED | P3b-02, clean plate/slot | 높음 | 렌더 DB1:1, unknown 외부 미점등, auto-off Mock |
| P5 home/AI entry IA | P3b-02 | 중간 | 2–3 carousel, origin/person/scroll 보존, wear 자동생성 없음 |
| P6 Decart support | G1 및 인증/비용 별도 승인 | 높음 | 공식 static/realtime 범위 확인, Mock와 실제 분리; 유료 검증은 최종 승인 후 |
| P7 card Gate B/C | Gate A, 승인 보유 assets | 높음 | 사용자가 요청한 owned-only 카드, PNG 저장/조회/공유; 배포 gate 별도 |
| P8 storage agent | GAP-08 충돌 해소, P3b-02 | 높음 | 여름 우선/간절기 유지, 승인 무예약, 완료만 위치갱신, 동시성/부분실패 |
| P9 mom-son E2E | P4/P5/P7/P8, P6 조건부 | 높음 | scenario_trace 모든 real/mock 명확; 미검증 항목 별도 |

독립 병렬 가능: 승인 후 카드 Gate A 복원과 최소 DB seed 개발, 슬롯 측정과 provenance 설계. P3 전체 assets 완료를 기다릴 필요는 없으나 미완성 이미지로 완성 판정할 수 없다. 실서비스 VTON/HA/hardware 미검증은 독립 게이트.

## 첫 구현 마일스톤의 구체 범위(proposed)

이 마일스톤의 아들 1룩은 아직 승인되지 않았다. 후보별 권리/variant/필수값과 슬롯 실측을 확보한 뒤 사용자가 CSV 행 ID와 구현 범위를 명시 승인해야 착수한다. PC01–05는 여름3/겨울2 시연 목적을 충족하는 최소 후보라는 이유로 제안했으며 확정 목록이 아니다. seed 단계와 기존 완료 확인 API 테스트는 카드 Gate B와 독립 진행 가능하지만, 새 정책의 승인/이동 테스트는 GAP-08 동시성 변경 완료가 선행 조건이다.

엄마·아들 전용 로컬 데모 namespace를 만들고 PC01–05 + 승인된 아들1룩을 최소셋으로 승인한다. 이미지 허가/variant/필수값을 확인하고 manifest hash를 고정한다. FK/owner/device/slot 매핑, dry-run/seed/rollback 스크립트를 구현한 다음 로컬 transaction과 2회 재실행 diff=0을 검증한다. clean plate와 내부1벌/외부1벌 렌더를 연결하고 등록/이동/삭제/unknown/Mock LED를 실제 API로 검증한다. 카드는 Gate A까지 별도 진행. 현재 이 작업들 실행 전이다.

## 검증 명령(proposed, 이번 실행 아님)

실제 package.json에 존재하는 무해한 정적 검사: `cd web; npm run typecheck` 및 `npm run format:check`. 단위 테스트 `npm test`는 DB/외부 호출 없는 파일 범위를 먼저 확인한 뒤 수행. renderer: `cd renderer; npm test`. DB 통합 스크립트 scripts/verify_sprint7.py는 쓰기를 포함할 수 있으므로 승인된 격리 DB 준비 후에만. 신규 seed/rollback 명령은 아직 구현하지 않았으며 존재하는 명령인 것처럼 제시하지 않는다.

각 게이트는 근거 PNG/DB diff/job ID/로그 및 실패 항목을 제출한다. 명령 실행 성공과 사용자 시각 품질 승인은 다른 조건이다. 이번 작업의 CSV 참조 검사·hash 검사는 문서 검증이며 제품 E2E 통과가 아니다.
