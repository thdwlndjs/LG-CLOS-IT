# C단계 VTON 실행 계약 초안

2026-10-12 · 실행 기준 `a1e439b` · 상태 **C1~C6 Mock 완료 / 실제 시착 게이트 별도**

기준은 [POC_CONTRACT_A1](../POC_CONTRACT_A1.md)의 POC-V01~06 및 이후 사용자가 확정한 C 슬롯 정책이다. 사용자는 C1~C6 실행을 승인했다. 기존 [B~G 실행 계획](STAGE_B_G_EXECUTION_DRAFT.md)의 단계별 승인 게이트를 유지한다. B-01 시각 승인 완료, B-02 DEFERRED(외부10벌 중복·위치 정합성 미해결), D~G 미승인이다. 단계별 실제 결과는 [체크포인트](../reports/STAGE_C_CHECKPOINT.md)를 참조한다.

## 1. 확정 범위

- TOP/BOTTOM/OUTER/DRESS/SHOES/ACCESSORY, UI 슬롯당1개·최대6개. TOP+BOTTOM 또는 DRESS 필수. DRESS와 TOP/BOTTOM 동시 선택 금지. OUTER/SHOES/ACCESSORY는 선택 사항이다.
- BAG/HAT 신규 카테고리·DB 필드·필수 분류를 도입하지 않는다. 기존 ACCESSORY로 조회하며 상품명으로 역할을 확정하지 않는다. 기존 백엔드의 복수 ACCESSORY 허용을 제거하지 않되 신규 C UI/통합 요청은 슬롯당1개로 제한한다.
- 보유만/LIKED만/혼합 모두 동일 슬롯·권한·이미지 검사를 적용한다. `kind + id`로 구분하고 같은 상품 사진을 같은 실물 의류로 간주하지 않는다.
- 입어보기 실행만 요청을 생성한다. 선택 변경은 draft만 변경하고 자동 submit/자동 결과 갱신하지 않는다. 생성 중 선택 변경을 허용하며 추가 실행은 차단한다.
- 실행 순간 불변 요청 Snapshot을 생성한다. 완료 결과는 해당 요청에 연결한다. 후속 확정/카드 기준은 마지막으로 실제 표시된 결과의 Snapshot이다.
- 관심 포함 결과에서도 확정·카드 CTA를 표시하되 설명 후 종료한다. 현재 draft가 보유만이어도 관심 결과는 차단한다. 반대로 표시 결과가 보유만이면 현재 draft의 관심 포함 여부로 결과를 다시 분류하지 않는다.
- 프로필 전환·화면 이탈은 임시 draft/pending/displayed 상태와 폴링을 초기화하고 늦은 결과 유입을 차단한다. 영속 서버 Job/의류/기존 카드/착용 기록을 삭제하지 않는다.
- 실제 Decart 호출·다중 의류 시착 품질은 C 완료 조건이 아니다. Mock 성공은 입력·작업·상태 처리 성공으로만 표시한다.
- 팀원 card-core의 복합 키·불변 Snapshot·슬롯 교체 로직만 필요한 부분을 선택 재사용한다. 독립 UI/localStorage/가상 데이터/PNG 렌더러/공급자 참조 합성은 가져오지 않는다.

## 2. 현재 구현과 additive 변경안

기존 `/api/v1/vton-sessions`, `/vton-jobs`, `/jobs/{id}`, 단일 `/integration/shopping/liked/vton-jobs`의 계약과 워커를 보존한다. 보유 `OutfitItem.garment_id` FK에 LIKED ID를 넣거나 가상 garment를 생성하지 않는다.

사용자가 승인한 additive 경로는 다음이며, 실제 발행 DTO·검증 결과는 [C 완료 보고](../reports/STAGE_C_IMPLEMENTATION_REPORT.md) 및 OpenAPI를 참조한다. 원격 배포는 수행하지 않았다.

| 경로 | 책임 |
|---|---|
| POST `/api/v1/integration/vton-jobs` | 통합 품목 검증·Snapshot 고정·멱등 Job 생성,202 |
| GET `/api/v1/integration/vton-jobs/{job_id}` | 요청 actor의 상태·결과·서버 Snapshot 조회 |
| POST `/api/v1/integration/vton-jobs/{job_id}/cancel` | 요청 actor의 비종료 작업 취소·멱등 처리 |

별도 통합 경로를 선택한 이유는 기존 session/outfit이 보유 FK를 전제로 하고 기존 Job getter/worker도 vton_job join과 현재 outfit revision을 검사하기 때문이다. 통합 경로는 기존 `job(kind=VTON)`·asset·outbox·멱등 저장소를 재사용하고 `request_payload.contract_version='poc-vton-c1'`로 구분한다. 초기 설계는 **새 테이블·Migration 없음**이다. 기존 job/result_ref/JSON의 크기·검사·동시성으로 부족함이 증명될 때만 변경안과 근거를 추가 제출한다.

기존 워커에 태그별 dispatch를 추가해 새 통합 분기는 별도 application 서비스에서 실행한다. 기존 vton_job/external_vton_job 분기는 유지한다. 신규 통합 Job을 기존 generic getter가 동일하게 처리한다고 가정하지 않고 반환 status_url로 폴링한다. 취소·timeout 대상이 다른 워커와 중복 집행되지 않도록 kind뿐 아니라 contract tag와 기존 join을 검사한다.

신규 경로의 OpenAPI에 x-fsd-ids 및 A1 POC-V01~06 추적을 명시하고 구현 시 실제 OpenAPI 문서/계약 해시 revision을 함께 갱신한다. 이번 초안 작성으로 OpenAPI나 해시를 바꾸지 않는다. 기존 요청과 기존 응답에 새 필드를 강제하지 않는다.

## 3. 요청 DTO와 서버 Snapshot

아래 UUID 문자열은 타입 표기이며 예시 데이터/새 의류 ID가 아니다.

```typescript
type Slot = 'TOP'|'BOTTOM'|'OUTER'|'DRESS'|'SHOES'|'ACCESSORY';
type Kind = 'OWNED'|'LIKED';
type UnifiedVtonRequest = {
  client_context_id: string; // 화면 진입마다 새 UUID, 인증/권한 근거 아님
  draft_id: string;          // 기존 프론트 draft ID, 길이 제한 비어 있지 않은 문자열
  draft_revision: number;    // 0 이상, 서버 outfit revision과 별개
  person_asset_id: string;   // UUID
  provider: 'MOCK';
  items: Array<{
    kind: Kind;
    id: string;             // garment UUID 또는 liked_item UUID
    slot: Slot;
    position: 0;            // C 통합 경로는 슬롯당1개
    expected_asset_id: string; // 실제 조회한 입력 asset UUID
    expected_source_version?: number; // 보유 garment version; 없으면 서버 조회
  }>;
};
// Header: Idempotency-Key: UUID. 실제 actor는 인증 토큰에서 취득한다.
```

items는1~6개지만 실행은 TOP+BOTTOM 또는 DRESS 조건을 반드시 만족한다. kind/id 중복·슬롯 중복·category 불일치·UNKNOWN enum은422, 현재 이미지/명시 version 불일치는409, 접근 불가 항목은404로 처리한다. provider는MOCK만 허용하며 기존 private local/test 실행 제한을 유지한다.

요청 수락 전 서버는 실제 DB 정보를 해석하고 아래 Snapshot을 고정한다. 클라이언트가 보낸 owner/사진 URL/contains_liked는 신뢰하지 않는다. asset key는 서버 전용 조회에 사용하며 응답 Snapshot에 Signed URL·키·자격증명을 넣지 않는다.

```typescript
type RequestSnapshot = {
  schema_version: 'poc-vton-c1';
  request_id: string;        // Job UUID, 서버가 생성
  household_id: string;     // 인증 actor의 가구
  member_id: string;        // 시착 사용자, 의류 소유자와 별개
  client_context_id: string;
  draft_id: string;
  draft_revision: number;
  submitted_at: string;     // 서버 UTC
  provider: 'MOCK';
  person: { asset_id:string; checksum_sha256:string };
  items: Array<{
    kind:Kind; id:string; slot:Slot; position:0;
    owner_id:string;        // 보유 소유자 또는 LIKED 관계의 사용자
    source_version:number|null; // 보유 version / 현재 LIKED는 null
    asset_id:string; checksum_sha256:string;
    source_fingerprint:string;  // LIKED 등 버전 없는 소스의 canonical 내용 해시
  }>;
  contains_liked:boolean;   // 서버 items에서 계산
  input_fingerprint:string;// 서버 canonical SHA256, 멱등 권한의 대체물이 아님
};
```

현재 asset DTO에 믿을 수 있는 mutable version이 없고 frontend 어댑터가 version1을 사용하므로 이를 실제 갱신 버전으로 믿지 않는다. 서버 asset UUID+checksum 및 검증한 원본 source fingerprint를 사용한다. 보유 state 위치는 시착 이미지 식별의 기준이 아니며 B-02 위치를 내부로 재해석하지 않는다. worker 실행·게시 시 원본 권한/동의/READY/기한/이미지checksum과 source 변경을 재검사하고, 변경되면 INPUT_CHANGED 또는 ASSET_UNAVAILABLE로 종료한다. 다른 사진/현재 선택으로 몰래 치환하지 않는다.

서버 DTO 제안:

```typescript
type UnifiedVtonJob = {
  job_id:string;
  status:'QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'|'TIMED_OUT'|'CANCELLED';
  request_snapshot:RequestSnapshot;
  result_asset:object|null; // 기존 Asset DTO, 조회 때 Signed URL 발급
  is_mock:true;
  result_semantics:'MOCK_RECEIPT_NOT_REAL_TRY_ON';
  error:object|null;        // 기존 안전한 Error 형태
};
```

결과 Snapshot은 별도 선택 재계산 결과가 아니라 해당 Job의 `request_snapshot` 그대로다. 서버 SUCCEEDED만으로 화면 표시 완료가 되는 것은 아니다.

## 4. 프론트 상태와 비동기 전이

| 상태 | 내용·규칙 |
|---|---|
| selectionDraft | 사용자가 현재 고른 조합. 선택마다 revision 증가 |
| pendingRequest | 명시 실행 때 고정한 draft snapshot·intent key·화면 generation. 최대1개 |
| displayedResult | 마지막으로 검증/이미지 로딩을 마치고 실제 화면에 commit한 Job ID·서버 Snapshot·result asset |

직전 displayedResult가 A일 때 draft B 실행→대기 중 draft C 선택→B 완료라면 화면은 **B 요청 Snapshot**으로 결과를 표시하고 현재 draft C는 유지한다. draft revision이 달라졌다고 B 결과를 버리지 않는다. 새 결과 표시 전까지 후속 CTA의 대상은 A다. 새 요청 실패/timeout이면 A가 유효한 범위에서 남고 실패 안내를 표시한다. 결과가 없으면 현재 draft를 대신 사용하지 않는다.

상태 전이: UI 입력 → 실행 검증 → POST202/QUEUED → RUNNING → SUCCEEDED → 이미지 로드·정체성 확인 → displayedResult commit. FAILED/TIMED_OUT/CANCELLED 또는 결과 이미지 실패는 새 표시 commit이 아니다. decoder/CORS/만료 오류는 동일 Job의 GET으로 권한을 재검증하고 새 URL을 받아1회 이미지 재시도하며 VTON Job을 다시 생성하지 않는다. 기존 image_asset_id 기반 Blob 캐시·로그아웃 정리를 재사용한다.

폴링은 겹치지 않는 순차 요청과 상한 있는 backoff를 사용한다. 화면 전체가 아닌 선택 controls는 활성 유지한다. pending latch는 React state 갱신 전 동기적으로 설정한다. pending 동안 실행 버튼 비활성, 선택은 활성이다. 서버에서도 actor+client_context_id lock 아래 비종료 통합 Job 중복을 방지한다.

통신 불명확 실패는 같은 Idempotency-Key/동일 payload로 재시도해 같은 Job을 받는다. 같은 key+다른 payload는409. 종료된 Job을 사용자가 명시적으로 다시 실행할 때만 새 key/새 Job이며 현재 draft를 새로 snapshot한다. 자동 재시도로 새 intent를 생성하지 않는다. 제출 직후 응답 유실과 새 요청 payload 재계산을 구분한다.

멱등 payload 비교는 서버가 정규화한 제출 본문으로 수행하며 새 job UUID·submitted_at·현재 DB 재조회 결과를 섞지 않는다. 서버 입력 manifest의 fingerprint는 별도로 저장한다. 같은 key 재전송은 저장된 최초 Job/Snapshot을 재사용하되 접근 권한 철회 시 결과는 노출하지 않는다. terminal 상태가 확인되고 결과 로딩 또는 오류 표시가 끝나면 pending latch를 해제한다. 폴링 네트워크 지연만으로 서버 Job을 TIMED_OUT으로 간주하거나 새 intent를 자동 생성하지 않는다. 서버 TIMED_OUT은 terminal이며 이후 늦은 provider 완료가 덮어쓰지 못하도록 lease/status 조건을 검사한다.

프로필 전환/화면 이탈: generation 증가→poll/fetch abort→임시3상태 및 Object URL 사용 참조 정리. 알려진 pending Job은 best-effort 취소하되 취소 응답 실패에도 UI 유입은 차단한다. 제출 응답이 뒤늦게 와서 Job ID를 알게 된 경우 기존 context 토큰을 검사해 표시하지 않고 best-effort 취소한다. 백그라운드 작업은 timeout/lease로 종료될 수 있으며 페이지 이탈이 영속 Job 삭제를 뜻하지 않는다. 재진입은 빈 임시 상태에서 시작한다.

늦은 POST 응답은 반환된 Job ID만 추출해 원래 요청의 취소 대상으로 보관한 뒤 generation 불일치 시 화면 상태 갱신 없이 best-effort 취소한다. 새 프로필 자격증명으로 타 사용자 Job을 취소하지 않는다. 원래 자격이 더 이상 없으면 서버 lease 종료에 맡기고 취소 성공을 주장하지 않는다.

profile+client_context_id+generation+pending Job ID로 응답 귀속을 검사한다. selectionDraft revision과의 동일성은 요구하지 않는다. 구 helper isCurrentRevision을 VTON 결과 수락에 그대로 적용하지 않는다.

## 5. 권한과 후속 D/F 경계

- 보유: actor 가구+접근 가능한 device의 기존 READ_PERMISSION을 사용한다. 같은 device 가족 의류는 조회/시착 입력 가능하되 소유자를 actor로 바꾸거나 garment를 편집하지 않는다. 인물 asset은 현재 actor의 동의한 PERSON이며 가족 의류의 이미지 소유자 동의도 기존 계약대로 확인한다.
- LIKED: liked_item.member_id=actor.member_id 및 household 일치 필수. 가족의 관심 목록까지 공유하지 않는다. DB LIKED를 조회하고 고정 LIKED adapter 목록을 새 경로의 권한 근거로 쓰지 않는다.
- LIKED의 관계 소유자와 이미지 asset 소유자는 별도로 검증한다. asset도 같은 가구의 READY GARMENT이며 실제 asset.owner_id의 업로드 동의·보관 기한을 만족해야 한다. 개인 LIKED 관계만으로 이미지 소유자 동의를 우회하지 않는다. Snapshot의 owner_id는 품목 관계 소유자이고 asset 소유자는 서버 asset 조회로 판정한다. source_fingerprint는 관계ID/사용자/카테고리/image_asset_id와 관련 checksum 등 시착 입력에 필요한 정규화 필드로 계산한다.
- source 소유자/가구·READY·기한·checksum·동의 검사를 제출, worker 읽기, 결과 게시/조회 시 수행한다. job actor+household 권한을 함께 검사한다. 외부 URL fetch·무권한 공개화·동의 자동 변경 없음.
- displayedResult.contains_liked=true면 확정/카드 CTA는 visible+안내, API 호출/garment/outfit/wear/card/LED 부작용0. 차단 기준은 서버 Snapshot이다.
- 표시 결과 없음·결과 권한 취소·삭제·이미지 미표시는 현재 선택 fallback 없이 대상 없음 안내.
- 보유 결과의 후속 handoff는 Job ID와 서버 Snapshot 참조를 전달한다. D 착용/LED 및 F PNG/저장은 C에서 새로 구현하지 않는다. 기존 액션이 현재 draft를 사용해 잘못 실행될 수 있으면 C 진입점에서 이를 차단하고 후속 구현 대기 안내를 한다. D/F의 서버가 그 Job을 재조회하고 관심/actor/asset를 검증하는 실제 완료 조건은 해당 단계에 유지한다. C UI guard만으로 D/F 보안 검증 완료를 주장하지 않는다.
- B-02 외부 중복·위치 조회를 변경하지 않는다. 시착 사용 가능 상태 검사는 기존 AVAILABLE 정책을 유지하며 외부 위치를 내부로 승격하지 않는다.

## 6. Mock 계약

기존 Mock의 고정 안내 이미지로는 조합 입력을 증명할 수 없다. 새 경로에서는 모든 선택 원본 asset bytes를 읽어 타입·크기·checksum을 검증하고, 서버 입력 manifest(kind/id/slot/asset/checksum)를 Job/Provider 메타데이터와 대응시킨다. Provider 요청 검사는 인물1개·의류1~6개가 manifest 순서와 일치함을 spy/fixture로 검증한다. 기존 ProviderRequest는 bytes tuple이고 슬롯 metadata가 없으므로 새 typed wrapper로 manifest를 함께 검증하되 기존 호출 호환성을 보존한다.

표시 출력은 명확한 Mock 안내/요청 식별용 결과이며 실제 인물에 옷을 입힌 결과를 만들거나 가장하지 않는다. UI 성공 문구는 **“Mock 처리 완료 · 실제 시착 이미지가 아닙니다”**로 구분한다. 실제 색상·실루엣·핏·신발/액세서리/레이어 재현, 인물 동일성, Decart 호환성을 검증한 것으로 보고하지 않는다. Paid 호출0·실물 LED0·운영 DB0·push/deploy0을 유지한다.

## 7. 완료 검증과 승인 게이트

| 요구 ID | 독립 검증·완료 조건 |
|---|---|
| POC-V01 / T-V01 | 보유/LIKED/혼합3종 각각 모든입력 ID·원본asset hash·worker bytes가 제출 기대 manifest와 일치; 관심 보유전환0 |
| POC-V02 / T-V02 | 선택10회 submit0·결과commit0,명시실행1회 Job1·불변 Snapshot |
| POC-V03 / T-V03 | 연타/동일key재송신 Job1; 생성중 다른선택 허용; 완료는 요청Snapshot,현재draft는 유지 |
| POC-V04 / T-V04 | 양 프로필 전환/이탈/재진입/응답유실/완료race에서 이전 결과유입0·임시상태초기화 |
| POC-V05 / T-V05 | 관심결과+현재보유→CTA visible/설명/부작용0; 보유결과+현재관심→handoff대상은보유결과 |
| POC-V06 / T-V06 | A표시→B진행→C선택에서 완료전A/완료후B; B실패면A유지; 결과없음 fallback0; 서버Snapshot 변조/타사용자차단 |
| C-SLOT | 6슬롯·1개씩·총6·DRESS충돌·중복kind/id·category불일치; legacy 복수ACCESSORY 회귀 유지 |
| C-AUTH | 실제 같은device 가족입력허용/다른device·가구차단/상대LIKED404/본인인물·소유자동의취소차단 |
| C-MOCK | actualbytes spy·누락/extra/hash불일치실패; UI Mock 표시; 기존 외부워커 합성이미지 대신 DB원본 사용 |
| C-REGRESSION | 기존보유/단일관심API 회귀·기존Job조회·취소 유지; B-01 파일/geometry 및 기존76/신규28·이력 불변 |

DB 테스트·워커 테스트는 격리 PostgreSQL/MinIO,브라우저는 김수진·최휘재의 실제 API 요청으로 수행한다. 실패·미실행은 PASS 처리하지 않는다. 실제DRESS는0건이므로 독립 테스트용 격리 fixture로만 검증하고 시연DB에 무단 등록하지 않는다. 에러·취소·timeout·중복·한입력동의철회·중간프로필전환을 반드시 포함한다. 결과가 진짜시착이 아닌 사실과 B-02 잔여를 인계 보고에 남긴다.

구현 순서는 [STAGE_C_IMPLEMENTATION_PLAN](../reports/STAGE_C_IMPLEMENTATION_PLAN.md)이며 C 결과 보고·사용자 승인 전 D~G로 진행하지 않는다. 실제 공개배포 Mock 허용, 공급자 유료 호출, 외부 장치/운영 데이터 정책은 이번 초안에서 확대하지 않는다.

## 8. 충돌·추가 승인 항목

확정 C 제품 정책 질문은 남아 있지 않다. 신규 경로/DTO·Snapshot 저장·worker dispatch·현재 표시 결과 handoff·C 전용1슬롯 제한은 사용자가 **C1~C6 구현 승인**으로 확정했다. 실제 구현에서 기존 계약을 바꾸는 필요가 발견되면 근거와 최소 수정안을 기록하고 해당 변경을 승인 전 실행하지 않는다. B-02는 미해결 후순위이며 C 통과가 위치/LED 정합성 통과를 뜻하지 않는다. 공개배포나 실제 Decart의 입력 수·지원 품질을 확정된 것으로 표시하지 않는다.


## 2026-10-12 실행 승인

사용자는 C1~C6 구현을 승인했다. 본문의 초안·승인 대기 표현은 작성 당시 상태이며,
이번 승인에 따라 C단계만 실행한다. A1, B-01 승인 화면, B-02 DEFERRED를 유지한다.

- C Mock PASS는 실제 VTON 시착 품질 PASS가 아니다.
- 최종 PoC의 실제 시착 시연은 별도 공급자 연동 및 품질 검증 게이트다.
- Mock 이미지는 실제 시착 이미지로 표현하지 않는다.
- 완료 보고에는 실제 시착 시연의 남은 의존성과 검증 항목을 별도 인계한다.
- 각 C1~C6 독립 테스트 통과 후 다음 단계로 진행하며 실패·미실행은 PASS 처리하지 않는다.
- D~G, 유료 호출, 실물 LED, 운영 DB, 원격 push·배포는 승인 범위 밖이다.
