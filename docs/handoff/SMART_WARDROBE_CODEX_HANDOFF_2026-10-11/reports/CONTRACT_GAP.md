# CONTRACT_GAP

검사일: 2026-10-11 (KST)  
검사 저장소/브랜치: LG-CLOS-IT / main / c17e5e6  
실행 범위: P0 저장소 읽기, P1 공식 제품 조사, P2 설계·CSV 작성만  
신뢰 수준: verified=파일/공식 페이지 확인, proposed=미승인 설계, blocked=근거·권한 부족  
미확인 사항: 실행 DB 현황, 배포 상태, 실기기, 유료 VTON, 신규 화면 E2E, 이미지 재사용 허가.  
DB 연결·적재·마이그레이션·제품 코드/운영 에셋 수정·원격 push·배포 없음.

## 정책 대조

| ID | H1.0 요구 | 현행 근거/판정 | 최소 변경안(proposed) | 검증·의존 |
|---|---|---|---|---|
| GAP-01 | 가족 의류 공유, owner 유지 | 0004_device_integration.py:18,33 / 부분 충족 | household/member/device_member 재사용, 엄마·아들 데모 범위 격리; owner 변경 없이 같은 기기 조회 | 타 가구/비접근 기기 차단, 기존 계정 회귀 |
| GAP-02 | 실제 상품과 합성 보유 구분 | DDL:56 garment.attributes만 있고 product_reference 독립 테이블 없음 / 없음 | 우선 provenance JSONB 스냅샷+is_demo+manifest 논리 연결; 정규화 테이블은 별도 승인 | 출처·제품 variant·구매 instance 중복 구분 |
| GAP-03 | 보유 품목만 추천/VTON/카드 | ServerMockFitting.tsx:65, backendClient.ts:392 / 충돌 | 새 가족 시연에서 LIKED VTON 진입 제외. 기존 shopping 조회 계약 제거는 별도 호환 결정 | 미등록 상품 입력 거부, 실제 보유 공유 범위 검사 |
| GAP-04 | 홈 2–3 추천 캐러셀/AI 입어보기 | MirrorHome.tsx:124, MirrorOutfitWorkspace.tsx:469,915 / 부분·불일치 | 기존 레이아웃 유지하면서 추천 복수화 및 진입점 통합, 원점·스크롤·선택 복원 | 추천→진입→취소/실패/복귀 상태 검사 |
| GAP-05 | 확정≠착용≠카드 | secondHandoffActions.ts, DDL:137 wear_event / 분리 구조 보존 | 확정 LED와 별도 wear 기록 경로 유지; 새로운 자동 부작용 금지 | 확정 전후 wear_event diff=0 |
| GAP-06 | 빈 배경+DB별 레이어 | PhotoWardrobeStage.tsx:80 / 불일치 | clean plate + approved item/slot/version 매핑; 중앙 거울 반사 보존 | 등록/이동/삭제/unknown와 픽셀 1:1 |
| GAP-07 | T1–T4 독립 복원 | renderer/src/template.mjs:6,45 / 없음 | 기존 job/storage 재사용, 별도 versioned 4개 레이아웃·마스크·PNG | Gate A/B/C, 원본 권한 선행 |
| GAP-08 | 승인만으로 예약하지 않음 | sprint6.py:89–101,395 및 FSD:540 / 설계 충돌 | 승인 예약 제거 전 충돌·동시성 재설계; 완료 트랜잭션에서 용량 재검사, stale version 거부 | 2건 동시 승인/1칸, 부분 실패/취소 |
| GAP-09 | 간절기 기본 유지 | domain/storage.py:157 / 정책 부족 | 보관 후보 exclusion 근거+별도 계절 예외; 태그만으로 트렌치/긴팔 일괄 반출 금지 | 같은 조건에서 여름 후보 선택/간절기 유지 |
| GAP-10 | 수동 일괄 이동 완료 | sprint6.py:437,502 / 기반 충족 | USER items 부분 확인을 UI 배치 완료로 연결, 실패 품목은 현위치 유지 | 완료 전 렌더 유지/완료 후 갱신 |
| GAP-11 | 실제 static/realtime 지원 증명 | vton.py:23 및 decartRealtime.ts:61 / 미검증 | 서로 다른 지원 범위, 입력 개수, 인증, 비용 검증을 P6 gate로 분리 | 유료 호출 이번 단계 금지 |
| GAP-12 | 환경·사용 기록 근거 표시 | homeRecommendations.ts, DDL:90,137 / 부분 | 합성 로그는 is_demo와 고정 시각, 센서는 MOCK source 명시 | 시간 혼합·오래된 센서로 최적 보관 단정 금지 |

각 행은 제안이며 현재 코드 변경 없음. H1.0에서 확정된 owned-only/간절기 유지/확정과 착용 분리를 다시 제품 선택지로 열지 않는다. 필요한 것은 기존 계약 호환 방식과 구현 gate 승인이다.
