# C단계 구현 계획 — VTON 통합 조합과 결과 Snapshot

2026-10-12 · 실행 기준 `a1e439b` · **C1~C6 Mock 구현·검증 완료**, [결과 보고](STAGE_C_IMPLEMENTATION_REPORT.md) 참조

확정 제품 정책은 A1과 최신 사용자 지시다. 상세 DTO·상태·권한·검증은 [실행 계약 초안](../execution/STAGE_C_VTON_EXECUTION_DRAFT.md)에 있다. B-01은 `aed6b48` 시각 승인 완료, B-02는 DEFERRED다. 기존 옷장·DB·에셋을 변경하지 않는다.

## 현재 Gap

보유 outfit은 garment FK·6슬롯 검증을 갖지만 LIKED를 담을 수 없다. 기존 LIKED API는 고정 후보 검사와 단일 항목만 처리하며 외부 워커는 실제상품사진 대신 합성 이미지를 사용한다. 미러의 외부분기는 함께선택한 보유전체를 전달하지 않는다. 현재 생성중 selection revision 검사로 결과를 버릴 수 있어 requested/displayed를 별도 상태로 나눠야 한다. 서버 Decart는 capability unavailable, frontend realtime 입력은 별도영상·참조이미지1개 경로이며 이번 C의 실제 성공 기준이 아니다.

## 파일별 변경 책임 제안

다음은 승인 후 수정할 예상 목록이며 현재 변경된 구현 파일 목록이 아니다. 신규 모듈은 기존 선택/서비스/워커 안에서 책임을 분리하는 파일이며 별도 앱·백엔드 대체 파이프라인이 아니다.

| 파일 | 책임 |
|---|---|
| `web/src/mirror/source/core/types.ts`, `core/app.ts`, `core/selectionScenario.ts` | kind/id·슬롯교체·불변실행 snapshot·임시상태초기화. 기존6슬롯1개 정책 |
| `web/src/mirror/source/mirrorScene.ts`, `MirrorOutfitWorkspace.tsx` | 현재선택/pending/displayed 분리·결과요청설명·CTA 결과기준 handoff |
| `ServerMockFitting.tsx`, `FittingControls.tsx` | C Mock 버튼을 통합 API로 연결·중복latch·선택유지·poll/이탈generation. 실제 Decart 실행 경로는 확대하지 않음 |
| `mirrorFittingController.ts`, `mirrorFittingSession.ts`, `fittingResultRecovery.ts` | 새 Mock 결과 문맥에 필요한 최소 결과수락/복구 규칙. 기존 live gate 보존 |
| `integrations/backendClient.ts` | 요청/폴링/취소 DTO adapter·사용자LIKED ID·기존Blob캐시 재사용 |
| 신규 `backend/app/schemas/poc_vton.py` | 별도 integration DTO,strict kind/slot/id/총수·server Snapshot |
| 신규 `backend/app/api/v1/poc_vton.py` 및 기존router등록 | additive integration 경로·actor/멱등key·x-fsd-ids |
| 신규 `backend/app/application/poc_vton.py` | 권한·조합·이미지 검증·jobJSON Snapshot·중복lock·조회·취소 |
| `application/vton_worker.py`, `workers/vton.py` 및 필요시 신규 `application/poc_vton_worker.py` | tagged Job dispatch·기존lease/timeout·MinIO 원본검증·권한재검사·결과commit |
| `domain/vton.py`, `infrastructure/adapters/vton.py` | backwards-compatible 입력manifest 검증·Mock 식별/진단,고정출력≠실시착 명시 |
| `api/v1/shopping.py`, `workers/external_vton.py`, `application/sprint3.py`, `sprint6.py` | legacy 경로는보존. getter/timeout/cancel과신규Job충돌 여부 검사 및 필요한 최소태그guard만 변경 |
| `docs/06_OPENAPI.yaml`, `docs/CONTRACT_REVISION_1_7.json` | 구현 승인 후 실제 additive 경로와 contract hash 동기화 |
| 기존 backend/unit/integration/contract 및 web/browser 테스트 | 아래 단계별 독립 검증 추가 |

기존 Sprint1Repository READ_PERMISSION·asset 준비·동의·일반 storage 클라이언트를 재사용한다. 공통 위치resolver·선반매핑·가상데이터·PNG renderer는 C 수정 대상이 아니다. 위 backend schema/API 신규 경로의 이름은 승인할 기술 제안이다.

## 팀원 모듈 재사용

중첩 팀원패키지 `src/card-core.mjs`의 `itemKey`, deep freeze/clone/snapshot 구성 원리, `replaceSlot`의 원피스충돌 처리만 선택 사용한다. 팀 snapshot의 layout·cardtitle·background·PNG필드는VTON Snapshot에 불필요하므로 그대로 복사하지 않는다. `profileId`를 의류소유자와 동일하다고 강제하지 않고 시착사용자/가족소유를 분리한다. 현재 draft revision과다르면결과를폐기하는 `isCurrentRevision`을 VTON 결과판정에 그대로 사용하지 않는다. 모듈의 순수로직을 채택한 사실과 현제품 DTO에 맞춰변경한부분을 결과보고서에 기록한다.

## 구현 순서와 검증

| 순서 | 구현 | 통과 후 진행 조건 |
|---|---|---|
| C1 | DTO·권한/slot/manifest validator·legacy 기준 고정 | 3종조합·6슬롯·잘못된category/동의/가족/타LIKED 독립테스트 통과 |
| C2 | additive POST/GET/cancel·기존jobJSON/idempotency·leasedispatch | 동일key1job·다른payload409·타사용자404·legacyJobs 회귀통과 |
| C3 | actual입력asset 검증·Mock Provider·MinIO 결과저장 | 모든입력bytes/hash와독립manifest 일치·누락/변조실패·Mock식별 |
| C4 | 기존미러선택UI·busy선택유지·요청/표시Snapshot·이탈/프로필generation | 생성중변경/실패/재시도/이미지오류/늦은응답/중복race 통과 |
| C5 | 결과기준CTA guards·D/F handoff | 관심결과+보유draft 차단,역방향은보유결과대상,결과없음fallback0 |
| C6 | 두프로필실제브라우저·DB회귀·계약검사·인계 | POC-V01~06,C-AUTH/C-MOCK/C-SLOT/C-REGRESSION 증적 충족 |

C1~C6는 C 내부의 의존 순서다. 각 묶음 결과를 체크포인트에 기록하고 실패를 고친 뒤 다음 묶음으로 진행한다. C 내부 매 묶음의 중간승인을 요구하지 않지만 이 초안의 **최초 구현 승인**은 필요하다.

예정 테스트: 기존 test_stage_b/sprint3 및 Provider/세션 회귀,새통합request/worker PostgreSQL 테스트,frontend순수 snapshot/state 테스트,실제두프로필browser,OpenAPI/hash/x-fsd-ids 및Ruff/기존web체크. 명령·로그·runtime 상세는 구현 단계에서 실행 환경을 확인해 기록하며 현재 미실행을PASS로 적지 않는다. 현재 demo에 DRESS/LIKED DRESS가 없으므로 독립fixture 검증과실데이터검증의 차이를보고한다. 기존104의baseline/owner/이력,B-01 geometry와filehash를전후대조한다. 신규CJob/결과asset/outbox/idempotency행은예상부작용으로구분한다.

## 완료 및 중단 기준

C 완료는6슬롯/3종조합의 **Mock 입력·권한·비동기·요청/표시Snapshot 사용자 플로우**가 실제 API/DB/MinIO와 연결된 상태다. Mock가 실제착의영상/사진이라는 주장을하지 않는다. 유료Decart·실물LED·운영DB·원격push/배포0. B-02 위치 문제를 해결하거나D착용/LED·F카드 기능을 구현했다고 보고하지 않는다.

결과인계에는 요구ID별PASS/FAIL/미실행,변경파일/계약/API,실제입력manifest 및 두프로필화면,데이터/파일보존해시,기존경로회귀,Mock한계·B-02잔여·후속D/F payload를분리한다. 제안 DTO/경로/기존공개Mock제한과 충돌이 생기면새제품정책을 임의로만들지 않고기록한다. 사용자C최종승인전D~G를시작하지않는다.

## 계획 작성 당시 체크포인트

- 완료: 팀원 모듈 검토,DB/API/worker/슬롯 조사,사용자슬롯정책 확정,이번계획/실행초안 작성.
- 미착수: C1~C6 전체. 코드·DB·에셋·실행API 계약 변경 없음.
- 다음 입력: 사용자 **C 실행 계약 초안 및 구현 계획 승인**.
- 재개: A1→이실행초안→이계획→Git기준/기존데이터baseline을 확인하고C1부터시작.
- 문서커밋은Git log의 `docs(poc): draft C-stage VTON execution contract`로 식별한다. 원격push는하지않는다.


## 2026-10-12 실행 승인

사용자는 C1~C6 구현을 승인했다. 본문의 초안·승인 대기 표현은 작성 당시 상태이며,
이번 승인에 따라 C단계만 실행한다. A1, B-01 승인 화면, B-02 DEFERRED를 유지한다.

- C Mock PASS는 실제 VTON 시착 품질 PASS가 아니다.
- 최종 PoC의 실제 시착 시연은 별도 공급자 연동 및 품질 검증 게이트다.
- Mock 이미지는 실제 시착 이미지로 표현하지 않는다.
- 완료 보고에는 실제 시착 시연의 남은 의존성과 검증 항목을 별도 인계한다.
- 각 C1~C6 독립 테스트 통과 후 다음 단계로 진행하며 실패·미실행은 PASS 처리하지 않는다.
- D~G, 유료 호출, 실물 LED, 운영 DB, 원격 push·배포는 승인 범위 밖이다.
