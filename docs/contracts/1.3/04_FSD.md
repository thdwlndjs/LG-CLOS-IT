# Smart Wardrobe — FSD 상세 기능명세서 v1.1

> 문서 유형: Functional Specification Document (FSD)  
> 작성일: 2026-10-08  
> 상위 기준: `03_ARCHITECTURE_HLD_v1.1.md`, 제공된 Smart Wardrobe IA  
> 상태: **프로토타입 구현 기준 기능명세 초안**. 실제 Decart·ThinQ CLO·하드웨어 기능은 확인되지 않은 부분을 명시적으로 분리한다.  
> 후속: Backend LLD → OpenAPI 3.1 → PostgreSQL DDL → Codex 구현

## 1. 목적과 경계

본 문서는 React Smart Mirror 프로토타입과 FastAPI 백엔드가 제공해야 할 **사용자 관점의 기능 계약**을 정의한다. 기능별 트리거, 입력, 선행조건, 처리, 출력, 예외, 상태 변경, 수용 기준을 기술하며 실제 HTTP 경로·DB 컬럼·라이브러리 호출은 후속 LLD/API/DDL에서 확정한다.

**고정 원칙**

- Digital Twin은 의류·상태의 단일 원본이며 Agent는 도메인 서비스를 통해 접근한다.
- ThinQ CLO는 프로토타입에서 Structured Command Mock으로 대체한다. 자연어 파싱 자체는 보관·찾기 Agent의 범위가 아니다.
- Decart는 VTON Provider Adapter로 연결한다. 실제 모델 지원 범위, 요청 규격, 동시 의류 합성, 비용·속도는 검증 전이다.
- 코디 선택, VTON 성공, 미러 종료, 코디카드 저장, **실제 착용 확인**은 별개의 사건이다.
- 실물 RFID·Vision·IoT는 Mock Observation으로 대체 가능하며, Mock 결과를 실제 센서 정확도로 주장하지 않는다.
- FSD는 백엔드 우선 구현을 위한 기준이며 프론트엔드 와이어프레임은 IA의 화면 구조를 준수한다.

## 2. IA 및 기능 매핑

| IA 화면/진입점 | 기능 ID | 비고 |
|---|---|---|
| 잠금화면·홈 | COM-001, COM-002, REC-001, REC-002 | 오늘의 코디·케어 알림 |
| 옷장 > 내 옷 보기 | GAR-001 | 목록·필터 |
| 옷장 > 옷 상세 | GAR-002, CARE-001, VTON-001 | 공통 입어보기 진입 |
| 옷장 > 옷 등록 | GAR-003, GAR-004 | 인식은 백그라운드/Mock |
| 코디 > 내 코디 | OUTFIT-001, VTON-001 | 카드 재사용 연동 |
| 코디 > 스타일 보관함 > 전체·인스타·쇼핑몰 | STYLE-001 | 출처별 참고자료 |
| 코디 > 코디 만들기 | OUTFIT-002, REC-002, VTON-001 | 수동 편집·추천 |
| 캘린더 > 착용·케어 기록 | HIST-001, HIST-002, VTON-001 | 착용 확인과 과거 코디 불러오기 구분 |
| 케어 > 관리 일정 | CARE-002, CARE-003 | 일정·수행 |
| 케어 > 관리 가이드 | CARE-001 | 케어라벨 우선 |
| 마이 > 설정 | SET-001 | 프로필·동의·연동 |
| 공통 입어보기 | VTON-001~004 | Decart Adapter |
| 공통 코디카드 | CARD-001~003 | 저장·공유·재사용 |
| 구조화 의류 찾기/보관 판단 | STO-001~004 | ThinQ CLO Mock, 홈/케어 알림 등에서 호출 |

**IA 해석:** 검은색 상위 메뉴와 점선 입어보기 진입 경로를 유지한다. 파란색 코디카드 흐름은 `입어보기 → 코디카드 → 내 코디 불러오기`로 연결한다. 홈 추천·관리 알림과 보관 최적화는 기존 IA 내에서 진입하되 별도 상위 탭을 추가하지 않는다.

## 3. 기능 인벤토리 (28개)

| ID | 기능명 | 담당 도메인 |
|---|---|---|
| `COM-001` | 사용자 프로필 선택 및 세션 시작 | Common |
| `COM-002` | 홈 대시보드 및 알림 | Common |
| `GAR-001` | 보유 의류 목록·필터링 | Garment / Recognition |
| `GAR-002` | 의류 상세·현재 위치 조회 | Garment / Recognition |
| `GAR-003` | 의류 등록·이미지 관리 | Garment / Recognition |
| `GAR-004` | 의류 인식·상태 갱신 | Garment / Recognition |
| `REC-001` | Context 수집·Snapshot | Recommendation / Context |
| `REC-002` | 개인화 코디 추천 | Recommendation / Context |
| `OUTFIT-001` | 내 코디 조회·저장 | Outfit |
| `OUTFIT-002` | 코디 만들기·수정 | Outfit |
| `STYLE-001` | 스타일 보관함 관리 | Style Reference |
| `VTON-001` | 공통 입어보기 세션 생성 | VTON / Session |
| `VTON-002` | Decart 가상 착용 실행 | VTON / Session |
| `VTON-003` | 의류 교체·결과 갱신 | VTON / Session |
| `VTON-004` | 최종 코디 선택·세션 종료 | VTON / Session |
| `CARD-001` | 카드 데이터·템플릿 구성 | Card |
| `CARD-002` | 카드 이미지 렌더링 | Card |
| `CARD-003` | 카드 저장·공유·재사용 | Card |
| `HIST-001` | 착용·케어 이력 조회 | History |
| `HIST-002` | 실제 착용 확인·기록 | History |
| `CARE-001` | 의류별 관리 가이드 | Care |
| `CARE-002` | 관리 일정 생성·조회 | Care |
| `CARE-003` | 관리 수행·완료 기록 | Care |
| `STO-001` | 구조화된 의류 위치 검색 | Storage & Retrieval |
| `STO-002` | 착용 패턴 기반 옷장 최적화 | Storage & Retrieval |
| `STO-003` | 공간·환경 기반 보관 최적화 | Storage & Retrieval |
| `STO-004` | 보관 이동 제안·승인·확인 | Storage & Retrieval |
| `SET-001` | 사용자·연동 설정 | Settings |

## 4. 기능별 상세명세

### COM-001 — 사용자 프로필 선택 및 세션 시작

- **IA / 진입점:** 잠금화면 → 홈
- **Trigger:** 프로필 선택 또는 잠금 해제
- **Input:** household_id, member_id, 인증/데모 모드
- **Preconditions:** 해당 가구 소속, 프로필 활성, 접근 권한 확인
- **Processing:** 프로필 유효성·가구 권한 검증 → 사용자 범위 세션 발급 → 홈 초기 데이터 로딩 기준 반환
- **Output:** 세션 식별자, 사용자 표시 정보, 사용 가능 기능
- **Exceptions / Fallback:** 미존재 프로필·타 가구 접근·세션 만료 시 거부; 데모는 명시된 mock 프로필만 허용
- **State Change / Event:** 사용자 세션 생성/갱신; 옷 착용 이력 변경 없음
- **Acceptance Criteria:** 타 가구 데이터 접근 불가; 재접속 시 세션 만료 처리; 화면 전환 후 member scope 유지

### COM-002 — 홈 대시보드 및 알림

- **IA / 진입점:** 홈
- **Trigger:** 홈 진입·새로고침
- **Input:** member_id, 기준 일시, timezone
- **Preconditions:** COM-001 세션 유효
- **Processing:** 당일 Context와 추천 코디·케어 일정·미완료 보관 알림을 병렬 집계 → 우선순위·출처/Mock 여부 표시
- **Output:** 오늘의 코디, 케어 알림, 이동/관리 알림, 데이터 갱신 시각
- **Exceptions / Fallback:** 날씨·일정 실패 시 캐시/기본값 표시; 추천 실패 시 빈 상태; 부분 실패가 홈 전체를 막지 않음
- **State Change / Event:** 조회 자체는 불변; 읽음 처리 시 알림 상태 변경
- **Acceptance Criteria:** 알림의 대상 사용자/일자가 일치; Mock 데이터는 식별; 일부 소스 장애에도 홈 표시

### GAR-001 — 보유 의류 목록·필터링

- **IA / 진입점:** 옷장 > 내 옷 보기
- **Trigger:** 목록 진입·검색/필터 변경
- **Input:** member_id, owner_id?, category?, color?, season?, status?, pagination
- **Preconditions:** 가구 접근 권한 확인
- **Processing:** 소유자 및 허용된 공유 의류 범위 제한 → 속성 필터 → 정렬·페이지네이션 → 썸네일/상태 결합
- **Output:** garment 목록, 전체 건수, 페이지 정보, 필터 메타
- **Exceptions / Fallback:** 잘못된 필터는 400 계열; 이미지 누락 시 placeholder; 위치 미확인 별도 표시
- **State Change / Event:** 없음
- **Acceptance Criteria:** 필터/페이지 결과 일관; 권한 밖 의류 미노출; 이미지 누락에서도 목록 정상

### GAR-002 — 의류 상세·현재 위치 조회

- **IA / 진입점:** 옷장 > 옷 상세
- **Trigger:** 의류 선택
- **Input:** garment_id, member_id
- **Preconditions:** 해당 의류 접근 권한
- **Processing:** GARMENT·CARE_PROFILE·GARMENT_STATE 조회 → 최근 관측 및 위치 신뢰도 결합 → 인식 시각·미확인 표시
- **Output:** 속성, 이미지, 케어라벨, 현재 추정 위치, confidence, last_seen_at
- **Exceptions / Fallback:** 의류 삭제·권한 없음은 접근 차단; 관측 없음은 unknown; 오래된 관측은 stale 표시
- **State Change / Event:** 없음
- **Acceptance Criteria:** 위치 unknown과 미관측을 임의의 위치로 대체하지 않음; care_guide_available와 care_guide_url 제공; Sprint 1에서는 false/null, CARE-001 구현 시 링크 제공

### GAR-003 — 의류 등록·이미지 관리

- **IA / 진입점:** 옷장 > 옷 등록
- **Trigger:** 사용자 등록/수정/삭제 요청
- **Input:** owner_id, category, color, material?, season_tags?, care_label?, image_asset, location_id?
- **Preconditions:** 소유자 권한; 파일 크기·형식·업로드 동의 확인
- **Processing:** 이미지 자산 검증·저장 → 의류 속성 정규화 → GARMENT 생성/수정 → 초기 위치는 관측/명시 입력 근거에 따라 설정
- **Output:** garment_id, asset_id, 등록 상태, 누락 필드
- **Exceptions / Fallback:** 중복 태그·유효하지 않은 이미지·필수값 누락·업로드 실패; 재시도 중복 생성 방지
- **State Change / Event:** GARMENT/ASSET 생성·변경; 필요 시 GARMENT_STATE 초기화
- **Acceptance Criteria:** 등록 후 목록/상세 조회 가능; 임의의 위치 신뢰도 부여 금지; 타인 소유로 임의 등록 불가

### GAR-004 — 의류 인식·상태 갱신

- **IA / 진입점:** 공통 백그라운드
- **Trigger:** RFID/Vision/Mock observation 수신
- **Input:** sensor_source, garment_id 또는 tag, location_id?, observed_at, confidence, observation_id? (생략 시 source/time 기반 기존 UUID), tag_value?
- **Preconditions:** 허용된 센서/Mock 소스; 매핑된 의류
- **Processing:** 관측 정합성 검증 → GARMENT_OBSERVATION 기록 → 충돌·신선도·신뢰도 기준으로 상태 추정 → 변경 시 이벤트 발행
- **Output:** observation 수신 결과, 최신 추정 state, 변경 여부
- **Exceptions / Fallback:** 미매핑 태그는 404로 거부하고 관측/상태 변경 없음; 중복 관측 멱등; 충돌 관측은 unknown/검토; 비정상 시각 거부
- **State Change / Event:** GARMENT_OBSERVATION 생성, 조건 충족 시 GARMENT_STATE 갱신
- **Acceptance Criteria:** 관측과 상태 분리; 동일 observation 재수신 시 중복 없음; 신뢰도와 시각 보존

### REC-001 — Context 수집·Snapshot

- **IA / 진입점:** 홈/코디 만들기
- **Trigger:** 추천 요청 또는 사용자 수동 갱신
- **Input:** member_id, requested_at, timezone, location 범위?, 일정 접근 권한
- **Preconditions:** 세션 유효; 외부 정보 동의/권한 확인
- **Processing:** 날씨·기온·습도·강수·일정 유형·만남 대상·요일/휴일 조회 → 정규화 → source·timestamp·누락 항목 포함 Snapshot 생성
- **Output:** context_snapshot_id, normalized context, missing_fields, source_status
- **Exceptions / Fallback:** 날씨·캘린더 실패 시 수동/Mock/unknown으로 표시; 민감 일정 본문 무단 저장 금지
- **State Change / Event:** CONTEXT_SNAPSHOT 생성
- **Acceptance Criteria:** 동일 추천 세션은 참조 Snapshot을 유지; 정보 누락을 사실로 추정하지 않음

### REC-002 — 개인화 코디 추천

- **IA / 진입점:** 홈/코디 만들기
- **Trigger:** 추천 실행·조건 변경
- **Input:** member_id, context_snapshot_id, constraints, top_k
- **Preconditions:** 등록 의류 존재, 조회 권한
- **Processing:** 착용 가능 의류 필터(세탁·보관·가용성) → 조합 생성 → 계절/일정 적합도·사용자 피드백/착용 패턴 점수 → 다양성 반영 Top-K
- **Output:** 추천 outfit 후보, item_ids, scores, reasons, 제한사항
- **Exceptions / Fallback:** 후보 부족 시 제한 완화 제안 또는 빈 결과; Context 미확인 시 근거 제한; 개인화 이력 부족 시 규칙 기반
- **State Change / Event:** 추천 기록 및 OutfitRecommended 이벤트; WEAR_EVENT 생성 금지
- **Acceptance Criteria:** 사용 불가능한 옷 추천 금지; 점수·추천 이유 추적; 초기 사용자도 동작

### OUTFIT-001 — 내 코디 조회·저장

- **IA / 진입점:** 코디 > 내 코디
- **Trigger:** 목록 조회·저장·삭제/보관
- **Input:** member_id, outfit_id?, items?, title?, tags?, visibility
- **Preconditions:** 소유권·공유 범위 검증
- **Processing:** Outfit/OutfitItem 저장·목록화 → 구성 의류 참조 유효성 검사 → 카드/착용 여부는 별도 조회
- **Output:** 저장 코디 목록/상세, outfit_id, 구성, 카드 유무
- **Exceptions / Fallback:** 삭제된 의류는 누락 표시; 타인 코디 변경 금지; 동일 요청 중복 저장 방지
- **State Change / Event:** OUTFIT/OUTFIT_ITEM 생성·수정·보관
- **Acceptance Criteria:** 저장된 코디 재조회 가능; 착용 확정 없이 WearEvent 생성되지 않음

### OUTFIT-002 — 코디 만들기·수정

- **IA / 진입점:** 코디 > 코디 만들기
- **Trigger:** 의류 추가·교체·제거·저장
- **Input:** member_id, base_outfit_id?, slot별 garment_id, style_tag?
- **Preconditions:** 의류 접근 권한 및 코디 편집 권한
- **Processing:** 슬롯 구성 검증 → 편집 초안 유지 → 사용자가 저장 시 Outfit 생성/수정 → 입어보기로 전달 가능한 구성 정규화
- **Output:** draft/outfit_id, item 구성, 유효성, 입어보기 가능 여부
- **Exceptions / Fallback:** 중복 슬롯·권한 없는 의류·필수 구성 부족 시 안내; 저장 전 이탈은 초안 정책 적용
- **State Change / Event:** 편집 초안/OUTFIT 변경; 추천 학습은 확정 피드백만 사용
- **Acceptance Criteria:** 슬롯별 변경 반영; 저장·입어보기 진입 구분; 취소 시 기존 코디 유지

### STYLE-001 — 스타일 보관함 관리

- **IA / 진입점:** 코디 > 스타일 보관함 > 전체/인스타/쇼핑몰
- **Trigger:** 참고 스타일 추가·분류·선택
- **Input:** member_id, source_type, source_url?, image_asset?, title?, tags?
- **Preconditions:** 사용자 소유 또는 허용된 자료; URL·이미지 정책 충족
- **Processing:** 사용자가 제공한 스타일 이미지/링크 등록 → source_type 분류 → 전체/출처별 조회 → 코디 만들기 참고 입력으로 전달
- **Output:** style_reference_id, 썸네일, 출처, 연결된 outfit_id?
- **Exceptions / Fallback:** 접근 불가 링크·무허가 자동 수집 금지; 링크 유실 시 메타정보만 표시
- **State Change / Event:** STYLE_REFERENCE 생성·변경·삭제
- **Acceptance Criteria:** 출처별 필터 정상; 외부 이미지 무단 크롤링 없음; 참고자료와 보유 의류 구분

### VTON-001 — 공통 입어보기 세션 생성

- **IA / 진입점:** 옷 상세/코디 만들기/내 코디/캘린더/홈 연결
- **Trigger:** 입어보기 진입
- **Input:** member_id, entry_source, outfit_id? 또는 garment_id?, person_asset_id?
- **Preconditions:** 세션 유효; 의류·인물 자산 사용 권한
- **Processing:** 진입 출처에 맞춰 초깃값 해석 → OUTFIT_SESSION 생성 → 초기 선택 코디/사용자 자산 바인딩 → Provider 지원 조건 점검
- **Output:** outfit_session_id, 초기 outfit, VTON 가능 여부, entry_source
- **Exceptions / Fallback:** 사진 부재·진입 데이터 만료·미지원 의류 조합은 업로드/대체 경로 제시
- **State Change / Event:** OUTFIT_SESSION 생성; 착용 이력 변경 없음
- **Acceptance Criteria:** 어느 IA 진입점에서도 동일 화면 사용; 출처·초기 코디 보존

### VTON-002 — Decart 가상 착용 실행

- **IA / 진입점:** 공통 입어보기
- **Trigger:** 사용자 입어보기 실행
- **Input:** outfit_session_id, person_asset_id, selected garment_asset_ids, options?
- **Preconditions:** 사용자 이미지 동의; 유효 세션; 지원 입력 규격
- **Processing:** VTON_JOB 생성 → provider-neutral 계약으로 Decart Adapter 호출 → 동기/비동기 결과 정규화 → 저장/상태 갱신
- **Output:** vton_job_id, status, result_asset_id?, error_code?
- **Exceptions / Fallback:** API 키/할당량/시간초과·지원하지 않는 다중 의류 조합 → 명시적 실패/대체 흐름; 무단 성공 이미지 생성 금지
- **State Change / Event:** VTON_JOB 생성·상태 갱신, 성공 시 ASSET 추가
- **Acceptance Criteria:** 브라우저에 API 키 노출 없음; pending/running/succeeded/failed 구분; 실제 Decart 규격은 Adapter에서 확정

### VTON-003 — 의류 교체·결과 갱신

- **IA / 진입점:** 공통 입어보기
- **Trigger:** 슬롯 교체·이전/다음 코디 선택
- **Input:** outfit_session_id, slot, garment_id, expected_revision
- **Preconditions:** 편집 가능 세션; garment 접근 권한
- **Processing:** 선택 구성 변경 → 세션 이벤트 기록 → 기존 VTON 결과와 구분 → 사용자 재실행 시 새 VTON Job 요청
- **Output:** 변경된 구성, revision, 기존/신규 결과 상태
- **Exceptions / Fallback:** 중복 클릭·경합 revision 충돌·지원되지 않는 슬롯 → 수정 거부/재시도 안내
- **State Change / Event:** OUTFIT_SESSION_EVENT 생성, 세션 draft revision 갱신; 필요 시 새 VTON_JOB
- **Acceptance Criteria:** 의류 교체가 과거 결과를 덮어쓰지 않음; VTON 결과가 현재 revision에 대응

### VTON-004 — 최종 코디 선택·세션 종료

- **IA / 진입점:** 공통 입어보기
- **Trigger:** 코디 확정·화면 종료
- **Input:** outfit_session_id, selected_outfit_revision, save_choice, end_reason
- **Preconditions:** 세션 유효; 현재 revision 일치
- **Processing:** 최종 선택 Outfit 스냅샷 저장 → 추천 대비 수정/채택 기록 → 종료 상태 전이 → 코디카드 진입 데이터 반환
- **Output:** final_outfit_id, session_status, card_entry_payload
- **Exceptions / Fallback:** 선택 없음·중복 종료·저장 실패·오래된 revision; 미러 종료는 착용 추정만 기록
- **State Change / Event:** OUTFIT_SESSION 종료, OUTFIT_FEEDBACK 기록; WEAR_EVENT 생성 금지
- **Acceptance Criteria:** 종료 재요청 멱등; 마지막 선택과 실제 착용을 구분; 카드로 정상 이동

### CARD-001 — 카드 데이터·템플릿 구성

- **IA / 진입점:** 코디카드
- **Trigger:** 코디 확정 후 카드 만들기·재생성
- **Input:** outfit_id, context_snapshot_id?, template_preference?, member_id
- **Preconditions:** Outfit 접근 가능; 이미지 사용 권한
- **Processing:** OutfitItem 자산·styleTag·날짜/날씨 메타데이터 조회 → 템플릿 선택 → CardTemplate payload 생성·검증
- **Output:** template_id, resolved asset refs, metadata, render payload
- **Exceptions / Fallback:** 의류 이미지 누락 시 placeholder/생성 불가 명시; Context 부재 시 해당 문구 생략
- **State Change / Event:** OUTFIT_CARD draft 또는 render request 기록
- **Acceptance Criteria:** 동일 코디/Context 입력에 재현 가능한 카드 payload; 개인정보 자동 공개 금지

### CARD-002 — 카드 이미지 렌더링

- **IA / 진입점:** 코디카드
- **Trigger:** 렌더 요청/재시도
- **Input:** card_id, template_id, render_payload, format
- **Preconditions:** 허용된 템플릿·자산; Worker 이용 가능
- **Processing:** 렌더 작업 등록 → React/CSS 템플릿에 데이터 주입 → Playwright 1080×1350 캡처 → PNG/WebP Object Storage 저장
- **Output:** render_job_id, card_asset_id, status, dimensions
- **Exceptions / Fallback:** 템플릿 실패·자산 다운로드 실패·시간초과·스토리지 오류 시 failed 기록/재시도 정책
- **State Change / Event:** OUTFIT_CARD render_status 변경, 성공 시 ASSET 생성
- **Acceptance Criteria:** 1080×1350 규격·포맷 검증; 실패 시 완료로 표시하지 않음; 중복 렌더 요청 통제

### CARD-003 — 카드 저장·공유·재사용

- **IA / 진입점:** 코디카드 → 내 코디
- **Trigger:** 저장·공유·코디 불러오기
- **Input:** card_id, action(save/share/reuse), member_id, share_options?
- **Preconditions:** 카드 생성 완료; 접근·공유 권한
- **Processing:** 저장/즐겨찾기 → 사용자 선택 시 이미지 다운로드 또는 공유 링크 생성 → 재사용은 연결된 Outfit을 편집/입어보기로 전달
- **Output:** 저장 상태, 공유 가능한 결과, linked_outfit_id
- **Exceptions / Fallback:** 미완료 카드 공유 불가; 만료 링크 재발급; 민감 Context 기본 비공개
- **State Change / Event:** 카드 저장/공유 기록, 필요 시 링크 메타 갱신
- **Acceptance Criteria:** 카드에서 내 코디로 복귀; 공유에 사용자가 명시한 정보만 포함

### HIST-001 — 착용·케어 이력 조회

- **IA / 진입점:** 캘린더 > 착용·케어 기록
- **Trigger:** 월/일 이동·날짜 선택
- **Input:** member_id, date_range, timezone, record_type
- **Preconditions:** 가구·사용자 데이터 접근 권한
- **Processing:** WEAR_EVENT·CARE_EVENT·OUTFIT_SESSION 확정 기록을 상태별 구분 집계 → 날짜별 표시
- **Output:** 일자별 착용 확정, 케어 수행, 코디 선택 이력
- **Exceptions / Fallback:** 기간 과다 제한·시간대 변환 오류 처리; 착용 미확정은 확정 착용과 구분
- **State Change / Event:** 없음
- **Acceptance Criteria:** 달력 날짜 정확; 세션 종료만으로 착용 완료로 표시하지 않음

### HIST-002 — 실제 착용 확인·기록

- **IA / 진입점:** 캘린더/입어보기 후 확인
- **Trigger:** 사용자가 실제 착용 확인 또는 취소
- **Input:** member_id, outfit_id, outfit_session_id?, worn_at, confirmation_source
- **Preconditions:** 의류/Outfit 접근 권한; 명시적 확인 또는 검증된 센서 근거
- **Processing:** 확인 근거 검증 → Outfit 전체 구성 스냅샷 연결 → WEAR_EVENT 생성 → 추천 피드백/집계 업데이트
- **Output:** wear_event_id, outfit_id, confirmed_at, source
- **Exceptions / Fallback:** 중복 확인 멱등; 이미 취소된 착용 수정 규칙; 시점 불일치 경고
- **State Change / Event:** WEAR_EVENT 생성/정정, OutfitWearConfirmed 발행
- **Acceptance Criteria:** 미러 종료로 자동 생성 금지; 코디 구성과 당시 Context 추적 가능

### CARE-001 — 의류별 관리 가이드

- **IA / 진입점:** 옷 상세/케어 > 관리 가이드
- **Trigger:** 관리 가이드 조회
- **Input:** garment_id 또는 care_group, member_id
- **Preconditions:** 의류 열람 권한
- **Processing:** 케어라벨·CARE_PROFILE 조회 → 소재별 관리 규칙 적용 → 세탁/건조/보관 안내와 근거 표시
- **Output:** care_instructions, warnings, care_group, source
- **Exceptions / Fallback:** 케어라벨 없음/충돌 시 일반적 조언과 확인 필요 구분; 위험한 단정 금지
- **State Change / Event:** 조회는 불변; 사용자가 케어 정보 수정 시 CARE_PROFILE 갱신
- **Acceptance Criteria:** 라벨 우선; 불명확한 소재에 확정 가이드 제공하지 않음

### CARE-002 — 관리 일정 생성·조회

- **IA / 진입점:** 케어 > 관리 일정
- **Trigger:** 일정 등록·변경·목록 조회
- **Input:** member_id, garment_ids, care_type, due_at, recurrence?
- **Preconditions:** 해당 의류 관리 권한; 유효한 일정
- **Processing:** 관리 권고/수동 요청 기반 CARE_SCHEDULE 생성 → 일정 조회·예정 알림 집계 → 중복 일정 규칙 적용
- **Output:** care_schedule_id, next_due_at, status
- **Exceptions / Fallback:** 유효하지 않은 날짜·이미 삭제된 의류·중복 반복 일정 처리
- **State Change / Event:** CARE_SCHEDULE 생성/수정/취소
- **Acceptance Criteria:** 등록 일정이 홈/캘린더에 노출; 케어 수행과 예약은 별도 상태

### CARE-003 — 관리 수행·완료 기록

- **IA / 진입점:** 케어 > 관리 일정 / 캘린더
- **Trigger:** 사용자 완료·미완료 처리
- **Input:** care_schedule_id, garment_id, performed_at, outcome, notes?
- **Preconditions:** 관리 일정·의류 접근 권한
- **Processing:** 완료 여부 확인 → CARE_EVENT 기록 → 반복 일정의 다음 기한 산출 → GARMENT_STATE 세탁 상태는 근거 있는 경우만 변경
- **Output:** care_event_id, updated_schedule, next_due_at
- **Exceptions / Fallback:** 중복 완료·시간 역전·수행 취소/정정; 상태 변경 실패 시 원자성 보장
- **State Change / Event:** CARE_EVENT 생성, CARE_SCHEDULE 갱신, 필요 시 GARMENT_STATE 변경
- **Acceptance Criteria:** 관리 예정과 완료 이력 구분; 반복 일정 다음 회차 정확

### STO-001 — 구조화된 의류 위치 검색

- **IA / 진입점:** ThinQ CLO Mock / 의류 찾기
- **Trigger:** 조건 검색 요청
- **Input:** member_id, owner_id, category?, color?, garment_id?
- **Preconditions:** 소유/가구 접근 권한; 구조화된 파라미터
- **Processing:** 조건 검증 → GARMENT·GARMENT_STATE·STORAGE_LOCATION 조인 → 위치 신뢰도/최근 관측 반환
- **Output:** 의류 후보, 현재 추정 위치, confidence, last_seen_at
- **Exceptions / Fallback:** 검색 0건·위치 unknown·다중 후보·권한 없음; LLM 해석을 내부에서 재실행하지 않음
- **State Change / Event:** 없음
- **Acceptance Criteria:** 위치 없는 의류에 위치를 지어내지 않음; CLO 미연동에서도 구조화 UI로 동작

### STO-002 — 착용 패턴 기반 옷장 최적화

- **IA / 진입점:** 케어/홈 제안·정기 작업
- **Trigger:** 사용자 분석 요청·정기 트리거
- **Input:** household_id, member_id?, season, analysis_window
- **Preconditions:** 착용/보관 데이터 접근 권한
- **Processing:** WEAR_EVENT 기반 착용 빈도·계절성·현재 보관 위치 계산 → 누락/불확실성 감안 Scoring → 이동/회수 후보 생성
- **Output:** 제안 의류 목록, 현재/권장 위치, reason, score
- **Exceptions / Fallback:** 착용 데이터 부족 시 근거 부족 표시; 공간 미확인 시 실행 불가 제안 제외
- **State Change / Event:** STORAGE_ACTION 및 ITEM proposed 생성
- **Acceptance Criteria:** 제안만으로 위치 갱신 금지; 설명 가능한 추천 이유 제공

### STO-003 — 공간·환경 기반 보관 최적화

- **IA / 진입점:** 케어/보관 관리
- **Trigger:** 공간 최적화 요청·환경 변화
- **Input:** household_id, locations, capacity, environment_readings, garment_constraints
- **Preconditions:** 위치·환경 데이터 접근 권한
- **Processing:** 보관 공간 용량·습도/온도·소재 케어 제약 정규화 → Constraint Solver/Rule → 실행 가능한 배치 후보 산출
- **Output:** 제약 충족 배치 제안, 위반 사유, feasibility
- **Exceptions / Fallback:** 센서 없는 공간은 미측정; 불가능한 제약은 infeasible; 공간 정보 부족 시 제안 보류
- **State Change / Event:** STORAGE_ACTION 및 ITEM proposed 생성
- **Acceptance Criteria:** 하드 제약 위반 제안 금지; 실행 불가능하면 원인 표시

### STO-004 — 보관 이동 제안·승인·확인

- **IA / 진입점:** 홈/케어/보관 관리
- **Trigger:** 사용자 제안 승인·거절·실행 확인
- **Input:** storage_action_id, decision, approved_by, item_results?, evidence?
- **Preconditions:** 가구 권한, 제안 상태, 위치/의류 최신성
- **Processing:** 제안 상태 확인 → 승인/거절 기록 → 승인 후 이동 대기 → 사용자 확인 또는 관측 근거로 완료 처리 → 현재 위치 갱신
- **Output:** action_status, item_status, 변경된 garment_state
- **Exceptions / Fallback:** 중복 승인·상태 경합·이동 실패·관측 불일치·부분 완료; 완료 확인 없으면 위치 유지
- **State Change / Event:** STORAGE_ACTION/ITEM 상태 전이, 완료 근거 시 GARMENT_STATE 갱신
- **Acceptance Criteria:** 승인과 완료 별개; 부분 완료 지원; 권한 없는 승인 차단

### SET-001 — 사용자·연동 설정

- **IA / 진입점:** 마이 > 설정
- **Trigger:** 프로필/연동/동의 변경
- **Input:** member_id, preferences, provider_mode?, consents, timezone?
- **Preconditions:** 현재 사용자 권한; 운영자 설정은 별도 권한
- **Processing:** 설정 검증 → 사용자 선호·알림·개인정보 동의 저장 → 연동 상태 표시; mock/hybrid 모드는 서버 정책으로 통제
- **Output:** 설정 값, provider 연결 상태, 동의 이력
- **Exceptions / Fallback:** 유효하지 않은 설정·동의 철회 시 외부 처리 중지/보존 정책 적용; 비밀키 응답 금지
- **State Change / Event:** MEMBER 설정/동의 기록 변경; 서버 운영 설정은 별도
- **Acceptance Criteria:** 사용자 동의 철회 반영; API 키 노출 없음; 타 사용자 설정 변경 불가

## 5. 기능 간 연계 및 상태 규칙

### 5.1 핵심 사용자 여정

1. `COM-001 → COM-002 → REC-001 → REC-002`: 프로필·홈·Context·코디 추천.
2. `OUTFIT-001/002 또는 GAR-002 또는 HIST-001 → VTON-001 → VTON-002 ↔ VTON-003 → VTON-004`: 진입점에 무관한 공통 입어보기, 코디 변경 및 확정.
3. `VTON-004 → CARD-001 → CARD-002 → CARD-003 → OUTFIT-001`: 최종 선택 코디로 이미지 카드 생성·저장·재사용.
4. `VTON-004 → HIST-002 (별도 명시 확인) → HIST-001`: 실제 착용 확인 이후에만 착용 이력 집계.
5. `GAR-004 → GAR-002/STO-001 → STO-002/003 → STO-004 → GAR-002`: 관측→상태 추정→보관 제안→승인/실행 확인.
6. `CARE-001 → CARE-002 → CARE-003 → HIST-001/COM-002`: 가이드→일정→실행→캘린더/홈.

### 5.2 필수 상태 머신 (논리)

| 대상 | 상태 | 허용 전이/금지 |
|---|---|---|
| Outfit Session | `active → selected → ended`, `active → ended_without_selection` | 종료 ≠ 착용 확정; 종료 후 수정 금지, 재사용은 새 세션 |
| VTON Job | `queued → running → succeeded/failed`, `failed → queued` (새 시도) | 결과 이미지는 요청 revision과 결합; 오래된 작업 결과가 최신 선택을 덮어쓰지 않음 |
| Outfit Card | `draft → queued → rendering → ready/failed` | ready 전 공유 불가; 실패 시 상태/원인 보존 |
| Storage Action | `proposed → approved/rejected → in_progress → completed/partially_completed/failed` | 승인만으로 의류 위치 변경 금지 |
| Care Schedule | `scheduled → due → completed/skipped/cancelled` | 수행 이력은 별도 CARE_EVENT |
| Garment State | `known / unknown / stale` (위치 인식 품질) | 관측이 없는 경우 임의 위치 확정 금지 |

### 5.3 이벤트 및 데이터 일관성

| 이벤트 | 발생 기능 | 후속 처리 |
|---|---|---|
| `GarmentObserved`, `GarmentStateChanged` | GAR-004 | 상태·추천 가용성 갱신 |
| `OutfitRecommended` | REC-002 | 추천 세션 추적 |
| `OutfitModified`, `OutfitSessionEnded` | VTON-003/004 | 수정 이력·최종 선택 저장 |
| `OutfitWearConfirmed` | HIST-002 | WEAR_EVENT·착용 패턴 반영 |
| `CardGenerationRequested`, `CardGenerated`, `CardGenerationFailed` | CARD-001/002 | 렌더 Job 및 카드 상태 |
| `StorageActionApproved`, `StorageActionCompleted` | STO-004 | 승인·완료 및 상태 변경 |

상태 변경과 이벤트 발행은 Outbox 패턴 또는 동등한 정합성 보장으로 처리한다. 사용자 재시도·중복 콜백은 멱등하게 처리한다.

## 6. 논리 데이터 계약 / 참조 엔티티

| 영역 | 핵심 엔티티 | 관련 기능 |
|---|---|---|
| 사용자 | HOUSEHOLD, MEMBER | COM, SET, 전 도메인 권한 |
| 의류 원본·상태 | GARMENT, GARMENT_TAG, GARMENT_STATE, GARMENT_OBSERVATION, ASSET | GAR, STO, REC, VTON |
| 코디·Context | OUTFIT, OUTFIT_ITEM, CONTEXT_SNAPSHOT, OUTFIT_SESSION, OUTFIT_SESSION_EVENT, OUTFIT_FEEDBACK | REC, OUTFIT, VTON |
| 착용 | WEAR_EVENT | HIST, REC, STO |
| 보관·관리 | STORAGE_LOCATION, ENVIRONMENT_READING, CARE_PROFILE, CARE_SCHEDULE, CARE_EVENT, STORAGE_ACTION, STORAGE_ACTION_ITEM | STO, CARE, HIST |
| 참고·카드 | STYLE_REFERENCE, OUTFIT_CARD, ASSET | STYLE, CARD |
| 외부 작업 | VTON_JOB, DOMAIN_EVENT_OUTBOX | VTON, CARD, 이벤트 |

논리적 관계: `OUTFIT_ITEM`은 의류 참조, `OUTFIT_SESSION`은 Context 및 최종 Outfit 참조, `WEAR_EVENT`는 실제 착용 Outfit을 참조한다. `GARMENT_STATE`는 최신 추정 상태이고 `GARMENT_OBSERVATION`은 원시 관측 이력이다. 컬럼·FK·인덱스·삭제 정책은 DDL 단계에서 확정한다.

## 7. 외부 연동·프로토타입 모드

| 연동 | 내부 계약(논리) | 프로토타입 모드 | 제약/미확정 |
|---|---|---|---|
| Decart VTON | person asset + garment assets → job/result | mock 또는 real Adapter | 모델, 지원 입력·복수 의류, 과금, 인증·콜백 확인 필요 |
| ThinQ CLO | structured command → search/action result | Structured Command Mock | 실제 자연어→파라미터 API 미확인 |
| RFID/Vision/IoT | observation → state estimator | Seed/Mock Observation | 실물 인식·신뢰도 검증 범위 밖 |
| Weather/Calendar | context source → normalized snapshot | Mock/선택적 실연동 | 권한, 실패·캐시·timezone |
| Card Renderer | template payload → render job → asset | 로컬 Worker + Playwright | Figma는 디자인 단계만; 런타임 호출 없음 |
| n8n | 외부 스케줄/알림/동기화 | 선택적 | 핵심 트랜잭션 소유 금지 |

실행 모드: `mock`(외부 의존성 대체), `hybrid`(Decart 실연동·나머지 Mock), `integrated`(검증된 Provider만 실제 연동). Seed 데이터와 실사용 데이터는 표시 및 저장 수준에서 구분한다.

## 8. 공통 비기능·보안 요구사항

- **인가:** 모든 의류·Outfit·이미지·가구원 조회/수정은 세션 주체와 가구 범위를 검증한다. 가족 간 공유는 명시적 권한 정책을 따른다.
- **개인정보:** 사람 사진, 위치, 만남 대상, 일정은 최소 수집·동의·보존/삭제 정책을 적용한다. 공유 카드에는 기본적으로 민감한 Context를 포함하지 않는다.
- **외부 비밀정보:** Decart 등 API 키는 서버 환경변수/Secret으로 관리하고 클라이언트에 전달하지 않는다.
- **비동기 UX:** VTON·카드 렌더는 Job 상태 조회를 제공한다. 오류는 실패/재시도 가능 여부를 구분한다.
- **신뢰도:** 위치 confidence, observation timestamp, source(mock/real)를 보존한다. 센서 관측만으로 실제 착용 확정하지 않는다.
- **멱등성:** 중복 버튼 클릭·작업 재시도·이벤트 재전달 시 이중 레코드 생성 금지.
- **추적성:** 요청/세션/작업 ID와 이벤트 ID를 연결해 E2E 디버깅 가능하도록 한다.
- **접근성·화면:** IA의 공통 입어보기 흐름을 유지하고 오류/빈 상태/로딩 상태를 노출한다.

## 9. 프로토타입 E2E 수용 시나리오

| 시나리오 | 관련 기능 | 완료 조건 |
|---|---|---|
| E2E-01: 오늘의 코디 | COM-001/002, REC-001/002 | 홈에서 Context 기반 추천과 근거 표시 |
| E2E-02: 추천→가상착용→카드 | VTON-001~004, CARD-001~003 | Decart 또는 명시된 Mock으로 VTON 결과 표시 후 카드 저장·재사용 |
| E2E-03: 수동 코디 제작 | GAR-001, OUTFIT-002, VTON-001 | 선택 의류가 공통 입어보기 초기값으로 전달 |
| E2E-04: 실제 착용 이력 | VTON-004, HIST-002/001 | 미러 종료만으로 착용이 생기지 않고 확인 후 캘린더 반영 |
| E2E-05: 의류 위치 찾기 | STO-001, GAR-002 | 검색 결과에 위치/신뢰도/최근 관측 포함, unknown 처리 |
| E2E-06: 보관 최적화 | STO-002/003/004, GAR-004 | 제안→승인→이동 확인 후에만 위치 갱신 |
| E2E-07: 케어 일정 | CARE-001~003, HIST-001 | 가이드→일정→완료→캘린더 반영 |
| E2E-08: 스타일 보관함 | STYLE-001, OUTFIT-002 | 출처별 조회·참고 후 코디 만들기 진입 |
| E2E-09: 외부 장애 | VTON-002, CARD-002, REC-001 | 실패 상태/재시도/Mock 출처가 사용자에게 정확히 노출 |

## 10. Backend LLD 인계 항목

1. **서비스 모듈 경계:** Profile, Garment, Recognition, Context, Recommendation, Outfit, Session, VTON, Card, History, Care, Storage, Style.
2. **상태 머신과 트랜잭션:** OutfitSession/Job/Card/StorageAction/CareSchedule의 상태 전이, 동시성, 멱등 키.
3. **Provider Adapter:** Decart·ThinQ CLO Mock·Weather/Calendar·Recognition의 인터페이스와 폴백 정책.
4. **비동기 처리:** VTON·카드 작업 큐, Worker, 이벤트 Outbox, 재시도·중복 억제.
5. **권한·자산 관리:** Household/Member 범위, 이미지 업로드·저장·공유, 보존 정책.
6. **API 설계 준비:** 화면별 필요한 응답 집계, 공통 오류 코드, 작업 상태 조회, Cursor/Page 계약.
7. **DB 설계 준비:** Outfit/Session/Feedback/Wear 분리, Garment Observation/State 분리, 카드·VTON 자산 관계.

**문서 경계:** 이 FSD는 28개 기능의 동작 계약을 확정하기 위한 설계 초안이다. HTTP 메서드/경로, 정확한 JSON 필드 타입, DB 컬럼 및 Decart 실제 요청 규격은 후속 문서에서 확정한다.

## Sprint 1 승인 계약 개정 1.1 (2026-10-08)

1. **역할과 상태**: API는 DB의 OWNER/MEMBER/CHILD 및 AVAILABLE/IN_USE/LAUNDRY/CARE/STORED/UNKNOWN/RETIRED를 사용한다. DEMO는 인증 모드이며 역할이 아니다. CHILD도 자신의 의류를 관리할 수 있지만 공유 의류는 읽기만 가능하다. 관측은 착용 확인이나 wear_event를 생성하지 않는다. WORN은 제거한다.
2. **의류와 위치**: DELETE는 If-Match 기반 soft delete이며 retired_at 및 RETIRED를 기록한다. 등록·수정 location_id는 사용자의 명시적 수동 위치 등록이며 confidence=1, 서버 시각을 기록한다. care_label, location_label, stale(24시간), 공유 대상과 케어 가이드 가용성을 상세에 노출한다. 케어 가이드 자체는 기존 Sprint 5 범위이고 Sprint 1에서는 available=false/url=null로 명확히 표시한다. locator는 FOUND/STALE/UNKNOWN 및 fallback 안내를 반환한다.
3. **동의·보관·공유**: 이미지 동의 기본값 false, 변경 이력은 별도 consent_history. GARMENT 이미지에 한해 PNG/JPEG/WebP, 10MiB 이하, 최대 4096×4096, SHA256 필수 및 실제 디코딩 검증. PUT은 5분 동안 staging 키에만 허용하며 finalize가 검증된 바이트를 별도 최종 키에 저장한다. 읽기 URL 60초, 미완료 업로드 15분, 완성 이미지 30일 보관. 동의 철회는 읽기/신규 업로드를 즉시 차단하고 삭제를 수행한다. 정리 작업은 60초마다 재시도하며 삭제 실패를 숨기지 않는다. 공유는 소유자가 지정한 같은 가구 구성원에게만 읽기 허용, 쓰기/삭제/관측은 소유자만 허용한다. 공유 철회 후 기존 서명 URL은 최장 60초 유효할 수 있다. PERSON_VTON/STYLE/OTHER 업로드는 후속 Sprint 전까지 503이다.
4. **관측 식별**: observation_id와 tag_value를 추가한다. observation_id 생략 시 기존 source/time 기반 UUID를 유지하여 호환한다. garment_id 또는 tag_value 중 하나를 지정하며 태그는 소유자가 의류에 등록한 유일한 값이어야 한다. 알 수 없는 태그는 404이고 상태를 변경하지 않는다. 명시 ID 중복은 같은 내용만 재사용하며 다른 내용은 409. RFID/VISION의 실제 ingress는 503을 유지하고 MOCK/MANUAL만 검증한다.

API 버전 1.1.0으로 계약을 개정한다. 과거 0001 SQL은 원본 바이트와 SHA256로 동결하며 0002 전진 migration이 consent_history, garment_share와 asset 만료 필드를 추가한다. 기존 데이터·Seed는 삭제하거나 자동 동의시키지 않는다. 공개 서비스/운영 안전성은 완료 범위에 포함하지 않는다.

## Sprint 2 계약 보완 (2026-10-08)

REC-001/002, OUTFIT-001/002, STYLE-001의 구체 정책은 [Sprint 2 구현 기준](SPRINT_2_CONTRACT_DECISIONS.md)을 따른다. Context는 missing_fields/source_status와 nullable is_holiday를 제공해 불완전 Seed 일정을 추정하지 않는다. OutfitUpsert는 ARCHIVED를 허용하고 Outfit은 missing_garment_ids/try_on_ready를 제공한다. 추천 기록은 기존 domain_event_outbox recommendation aggregate로 저장하며 실제 후보 outfit_id/context_snapshot_id로 후속 세션에 연결한다. STYLE 업로드는 현재 동의·검증·보관 정책에 따라 활성화한다. API 1.2.0, 추가 물리 테이블 없이 현재 32개 테이블을 유지한다.

## Sprint 3 계약 보완 (2026-10-08)

VTON-001~004의 구현 정책은 [Sprint 3 구현 기준](SPRINT_3_CONTRACT_DECISIONS.md)을 따른다. 세션의 진입 코디/의류·인물 바인딩, 독립 revision 스냅샷, 가용성 및 Mock 출처를 API 1.3.0으로 보완한다. Job은 구버전/현재 결과와 provider 오류·재시도를 명시한다. DB job poller로 commit 후 worker 회수를 보장하며 공통 outbox dispatcher는 Sprint 7 범위다. 최종 선택은 final_items_snapshot과 피드백을 저장하고 wear_event를 생성하지 않는다. 기존 32개 테이블과 Seed를 유지한다. Decart live는 검증되지 않은 정적 이미지 계약을 임의 구현하지 않는다.
