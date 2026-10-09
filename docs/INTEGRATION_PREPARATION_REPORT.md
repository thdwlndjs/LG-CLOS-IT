# 프론트엔드 통합 준비 보고서

분석일: 2026-10-09. 대상: 팀원 전달본 `SmartCloset_TeamHandoff_20261009_131123_KST_7abae58`의 고객 화면 `/` 및 개발 보조 화면 `/dev`. **분석·문서화 완료이며 통합 구현 완료가 아니다.** 프론트·백엔드 구현 코드, 원본 계약, DB·MinIO·동의 설정은 변경하지 않았다. 이번 실행은 로컬 Mock UI와 격리 브라우저 시연 데이터만 사용했다.

## 1. 기준과 자료의 역할

| 자료 | 역할과 적용 범위 |
|---|---|
| [제품 HLD](03_ARCHITECTURE_HLD_v1.1.md), [제품 FSD](04_FSD.md) | Agent 책임, 데이터 흐름, 사건 구분과 목표 기능 28개의 기준 |
| HLD §3 IA, FSD §2 IA 매핑 | 홈·옷장·코디·캘린더·케어·마이와 공통 입어보기·코디카드의 목표 구조. 독립된 원본 IA 이미지/파일은 현재 자료에서 확인하지 못했으므로 문서에 전사된 IA를 기준으로 분석함 |
| [팀원 실행 안내](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/TEAM_HANDOFF/INSTALL_RUN_KO.md), 아래 T 파일 | 디자인·컴포넌트·인터랙션의 참고 구현. 팀원 로컬 기능을 확정 제품 요구로 자동 승격하지 않음 |
| [Sprint 7 추적표](IMPLEMENTATION_TRACEABILITY.md), [OpenAPI](06_OPENAPI.yaml), 아래 B 파일 | 실제 FastAPI 계약 1.7과 최신 구현의 대응 여부. 기존 검증 보고서와 이번 정적 재확인을 구분함 |
| [추가 통합 설계 INT-DATA-004](integration_sources/10_DB_IMPORT_AND_SHOPPING_INTEGRATION_DESIGN.md) | 구매 내역 가져오기·좋아요 VTON, 카탈로그와 실물 의류 분리. 테이블/API 이름은 아직 후보이며 구현된 것으로 취급하지 않음 |
| [CR-009](09_SHOPPING_INTEGRATION_CHANGE_REQUEST.md), [동봉 CR-009](integration_sources/09_SHOPPING_INTEGRATION_CHANGE_REQUEST.md) | 배경과 이전 제안. 구매 내역·좋아요만 남기는 INT-DATA-004 §10의 범위 축소를 우선 적용 |
| [현재 프로젝트 프론트 설계](FRONTEND_DESIGN.md), `web/` | 이미 Sprint 7에 연결된 별도 구현. 팀원 UI와 혼동하지 않으며 API 클라이언트·업로드·작업 상태 구현의 재사용 후보로만 비교함 |

원본 IA의 도식·연결선을 독립적으로 재검증했다는 주장은 하지 않는다. 팀원 코드의 실시간 Decart, 전경 분리, 슬롯 잠금, AI 도움, 회원가입, 계획 이벤트 등은 참고 기능이다. 해당 기능을 제품 FSD에 넣을지는 목표 기능·계약·비용 검토로 별도 결정해야 한다.

## 2. 실제 실행 및 증적

| 검사 | 이번 수행 결과 | 증명하지 않는 범위 |
|---|---|---|
| 전달본 무결성 | `node TEAM_HANDOFF/VERIFY_PACKAGE.mjs`: **352개 파일 SHA256 일치** | 원 작성자의 기능 검증 결과를 자동 신뢰한다는 뜻은 아님 |
| 실행 의존성 | Node 24.18.0, npm 11.17.0, `npm ci --no-audit --no-fund` 성공; lockfile 유지 | 의존성 전체 보안 감사·라이선스 감사는 이번 미수행 |
| 정적 타입 | `npm run typecheck`: 종료 코드 0 | production build·전체 단위검사·실DB 테스트를 이번 재실행한 것은 아님 |
| 팀원 API/UI 기동 | UI `127.0.0.1:4311`, 자체 API `127.0.0.1:4312`; `database_configured=false`, `ai_mode=mock`, `live_enabled=false`, 공급자 키 모두 없음 | Supabase 인증·저장·재조회, Sprint 7 접속, 유료 API 성공은 미검증 |
| 실제 Chromium 화면 | 23개 캡처와 DOM 측정. 1920×1080의 여섯 메뉴·등록·상세·케어·쇼핑·계정·공통 입어보기; 2560×1440, 1280×720, 390×844의 홈·옷장·캘린더 추가 확인 | 작은 화면에서 나머지 모든 화면을 검증하지는 않음; 실물 터치·다른 브라우저·고배율 미검증 |
| 화면/기본 상태 | 검색 결과 없음, 등록 열기/닫기, 상세 탭 전환, 관리 일정 탭, 쇼핑몰 출처 탭, 계정 미설정과 Escape 닫기 확인 | 계정 설정된 로그인 정상/실패, 권한·API 오류 전부를 실행 검증하지는 않음 |
| 사용자 액션 | 별도 격리 컨텍스트에서 아래 10개 시나리오 성공 | 로컬 상태의 성공은 FastAPI/DB/MinIO E2E 성공이 아님 |
| 요청 및 오류 | 두 QA 실행 모두 브라우저 `/api/config` GET만 관측; pageerror 0, 외부 브라우저 요청 0, 실제 API 변경 요청 0 | 콘솔 경고 전체·서버 성능·라이브 피팅 품질을 통과했다는 뜻은 아님 |

이번 브라우저에는 전달본의 생성 의류 시연 팩 47개와 저장 코디를 격리 주입했다. 실제 사용자의 보유 의류나 구매 이력을 넣지 않았다. 수동 등록 시험의 사진도 전달본 자산이며 저장은 테스트 브라우저 localStorage에 한정된다. 유료 API 호출, 실사용 DB·MinIO 쓰기, Migration·Seed 재실행은 0이다.

별도로 `/dev`를 새 격리 브라우저에서 읽기 전용 열람·캡처했다. [개발 보조 화면](../test-results/team-ui-qa/developer-surface.png)은 23개 기본 화면 캡처와 액션 증적에 추가되는 참고 자료이며, 개발 도구의 착용 기록 버튼 등을 고객 `/` 완료에 합산하지 않는다.

재현 도구: [화면 QA 스크립트](../test-results/team-ui-qa.ts), [액션 QA 스크립트](../test-results/team-ui-actions.ts). 결과: [화면·측정 JSON](../test-results/team-ui-qa/results.json), [액션 JSON](../test-results/team-ui-qa/actions.json). 증적은 로컬 `test-results/`에 있으며 현재 Git 제외 대상이다. 공유가 필요하면 시연 자산 이용 조건을 확인하고 따로 패키징해야 한다.

실행 중 두 차례 액션 스크립트의 탐색 가정을 수정했다. 프로필 전환 후 홈으로 돌아가는 동작과 이전 옷장 페이지 복원을 반영하지 않아 대상 요소가 없거나 비활성 페이지에 있었던 것이다. 고객 코드는 바꾸지 않았으며 `force` 클릭으로 우회하지 않았다. 실제 내비게이션과 Home 키를 사용해 최종 10개 시나리오를 재실행했다.

### 이번 액션 검증 10개

| 액션 | 관측 결과 |
|---|---|
| 종류 필터·키보드 가로 페이지 | 해당 종류의 실제 로컬 목록으로 바뀌고 ArrowRight로 다음 페이지 표시 |
| 4단계 수동 등록·중복 저장 | 사진/이름/색상 입력 후 더블클릭·재클릭에도 로컬 의류 1개만 증가; 착용·관리 이벤트 불변 |
| 빈 코디에서 상·하의 선택·저장 | 로컬 저장 코디 1개 증가; 착용·관리 이벤트 불변 |
| 쇼핑 후보 버튼 | 외부 후보 없음 안내; 보유 의류 수 불변 |
| 프로필 왕복 | 사용자별 코디 초안 유지; 전환 시 홈으로 이동 |
| 캘린더 이전 달·오늘 | 표시 월 변경·오늘 복귀 |
| ‘이 옷으로 입기’ 더블클릭·기록 재사용 | 계획(plan) 1개 생성, wear 증가 0; 캘린더 재사용도 이벤트 증가 0 |
| 실제 관리·이동 폼 열기/취소 | care·wear·movement 이벤트 불변 |
| 관리 도움 요청·원문 읽기 | 출처가 표시된 보조 안내 열림; 실제 이력 불변 |
| 새로고침 | 격리 로컬 브라우저 계획 이력 유지; 원격 저장 증거는 아님 |

## 3. 화면별 디자인·레이아웃 관찰

| 화면 | 실제 관찰 | 재사용 및 수정 판단 | 캡처 |
|---|---|---|---|
| 홈 | 사진 배경의 중앙 미러, 세로 내비게이션, 현재 시각, 시연 출처, 작은 저장 코디 카드. 날씨 없음 표시 | 배경/글래스 패널/상태 배지 재사용 가능. 오늘의 추천 이유·케어·보관 알림을 제공하는 목표 홈으로 확장 필요 | [홈 1920](../test-results/team-ui-qa/home-1920.png) |
| 옷장 | 3열×4행 카드, 종류 탭·select·검색, 가로 페이지. 긴 이름은 말줄임 | 카드와 페이지 탐색 재사용. 필터 UI가 탭/select로 중복돼 목적 정리 필요; 색상·계절·상태 필터와 API pagination 추가 | [옷장](../test-results/team-ui-qa/wardrobe-1920.png), [검색 없음](../test-results/team-ui-qa/wardrobe-empty-search.png) |
| 의류 상세·등록 | 의류/시연 위치, 착용 이력·라벨 탭, 정보 없음 안내. 등록은 4단계와 명시적 저장 | 단계 UI 재사용. 목표 필수 색상·선택 이미지와 팀원의 선택 색상·필수 사진/이름이 충돌. 관측 신뢰도·stale·편집/삭제·공유 보완 | [상세](../test-results/team-ui-qa/garment-detail.png), [등록](../test-results/team-ui-qa/registration.png) |
| 코디 | 내 코디·스타일 보관함·코디 만들기 탭, 슬롯 선택/편집, 별도 저장. 쇼핑 출처/후보는 빈 상태 | 초안·슬롯 카드·출처 필터 재사용. 목록 썸네일을 백엔드 카드 렌더 결과로 오인하지 않도록 명칭/상태 구분 | [코디](../test-results/team-ui-qa/outfits-1920.png), [쇼핑몰 출처](../test-results/team-ui-qa/shopping.png) |
| 캘린더 | 7열 달력·월 이동·오늘·선택 날짜·빈 상태. plan과 wear 명칭 분리 | 달력/날짜 카드 재사용. 실제 착용 확인/취소·API 날짜 집계 연결 필요 | [캘린더](../test-results/team-ui-qa/calendar-1920.png), [계획 기록](../test-results/team-ui-qa/plan-calendar.png) |
| 케어 | 관리 가이드 격자. ‘관리 일정’에는 과거 관리 이벤트와 다음 일정 정보 없음 표시 | 가이드/근거 원문 패널 재사용. 일정과 과거 수행 기록을 분리하고 일정 CRUD·완료·완료 취소 화면 추가 | [케어](../test-results/team-ui-qa/care-1920.png), [관리 일정](../test-results/team-ui-qa/care-schedule.png) |
| 마이·계정 | 로컬 프로필 2열 선택, 계정 준비 필요/비활성 로그인 안내, 모달 Escape 닫기 | 프로필과 접근 불가 안내 재사용. Supabase 계정 흐름을 FastAPI 세션으로 그대로 치환할 수 없음; 제품 설정·동의 이력·잠금 화면 필요 | [마이](../test-results/team-ui-qa/my-1920.png), [계정](../test-results/team-ui-qa/account-dialog.png) |
| 공통 입어보기 | 저장 코디에서 진입, 선택 구성·이전 결과/준비 정적 착장 표시, 편집·계획·피팅 시작 버튼 | 명시적 시작과 미반영 안내 재사용. 캡처는 정적 착장을 준비 중인 순간이며 실제 피팅/전경 품질 통과 증거가 아님 | [입어보기 진입/로딩](../test-results/team-ui-qa/common-tryon.png) |

### 반응형·상태·일관성

- 1920×1080에서 여섯 메뉴의 주요 조작부는 viewport 안에 있고 색·폰트·둥근 패널·선택 강조가 일관된다. 사진 속 옷장 배경은 넓지만 실제 조작 영역은 중앙 미러 약 285px로 좁다. 일반 웹 UX에서는 배경 비중과 콘텐츠 너비를 다시 설계할 필요가 있다. 미러 실물 UX와 일반 웹 레이아웃을 같은 요구로 섞지 않는다.
- 색·폰트·패널 일관성은 이번 캡처를 직접 본 정성 평가다. viewport·조작부 크기는 DOM 기하 측정이다. 정성 평가를 접근성·통합 동작의 정량 통과 근거로 사용하지 않는다.
- 2560×1440은 홈·옷장·캘린더에서 추가 확인했으며, 여섯 메뉴 전체를 그 크기에서 이번 검증한 것은 아니다.
- 1280×720의 캘린더는 보이는 조작부 41개 중 31개가 폭/높이 중 하나라도 24px 미만이었다. 이는 기하학적 측정이며 WCAG 전체 준수/위반 판정은 아니다.
- 390×844에서 배경은 축소되지만 폰트·패널이 같은 비율로 적절히 재배치되지 않는다. 홈 글자가 겹치며 카드 일부가 화면 밖이고, 옷장 페이지 조작부도 viewport 밖으로 나간다. [모바일 홈](../test-results/team-ui-qa/home-390.png). 홈 9/9, 옷장 22/28, 달력 38/41 조작부가 측정상 24px 미만이다. **모바일 반응형은 불일치**로 판정한다. 문서 scrollWidth가 390이라고 해서 overflow:hidden 내부 잘림이 없다는 뜻은 아니다.
- 빈 검색·빈 쇼핑 후보·날씨 없음·케어 이력 없음·계정 미설정은 실제 확인했다. 공급자 지연·실API 401/403/409/422/네트워크 실패·작업 취소·업로드 실패 전체는 이번 미검증이며, 해당 코드의 존재와 실행 성공을 구분한다.
- 계정 모달 Escape 닫기는 실제 확인했고, `MirrorExperience`에는 focus trap과 배경 inert 처리도 있다. 스크린리더·완전한 키보드 순서·200% 확대·색 대비·실물 손 도달성은 미검증이다.

## 4. 목표 IA·기능 대응 QA 매핑

판정은 팀원 **고객 화면 `/`**의 목표 대응을 기준으로 한다. ‘구현됨’은 해당 행에 적힌 화면/로컬 조작 범위만 충족한다는 뜻이다. FastAPI 통합 성공을 뜻하지 않는다. `/dev`에만 있는 조작은 고객 UI 구현으로 합산하지 않는다. B는 이번 브라우저 확인, S는 정적 확인, U는 실행 근거 부족이다. B/S/U는 QA 판정과 다른 증거 구분이다.

| 화면 ID | 목표 IA 기능 | 현재 UI 구현 | 사용자 액션 구현 | 백엔드 API 대응 | QA 판정 | 개선 필요 사항 | 근거 파일 |
|---|---|---|---|---|---|---|---|
| UI-NAV | 여섯 상위 메뉴·코디 하위 탭 | 동일 여섯 메뉴와 내 코디/스타일/만들기 탭의 로컬 탐색 | B: 메뉴·탭 클릭 전환만 확인 | 클라이언트 탐색; 데이터 API 별도 | 구현됨 | 판정은 로컬 탐색 한정; 좁은 화면 재배치·기존 메뉴 안에서 보관 진입 유지 | T1·T4, 화면 JSON |
| UI-LOCK / COM-001 | 잠금·프로필·세션 시작 | 로컬 프로필·Supabase 계정 안내; 목표 잠금 화면 없음 | B: 프로필 전환, 미설정 계정 모달; U: 인증된 세션 | `POST /api/v1/sessions` 있음; 팀원은 `/api/session` | 부분 구현 | 가구/회원 UUID·JWT·만료·잠금·공유 범위 연결 | T1·T7·T9, B1 |
| UI-HOME / COM-002 | 오늘 추천·케어·보관 알림 | 저장 코디와 시각만; 날씨 없음 | B: 저장 카드→입어보기; 알림 조작 없음 | `GET /api/v1/home` 있음 | 부분 구현 | 집계 응답·부분 장애·갱신 시각·알림 대상 표시 | T2, B7 |
| UI-W-LIST / GAR-001 | 보유 의류 목록·속성 필터 | 종류/이름/가로 페이지 | B: 필터·검색 없음·키보드 페이지 | `GET /api/v1/garments` 있음 | 부분 구현 | UUID·속성 필터·공유 스코프·서버 pagination | T1·T3, B1 |
| UI-W-DETAIL / GAR-002 | 상세·현재 위치·관측 근거 | 이미지·시연 위치·착용/라벨 탭 | B: 같은 의류 탭 전환; 신뢰도 UI 없음 | `GET /garments/{id}` 있음 | 부분 구현 | unknown/stale/confidence/last_seen; 상세에서 공통 VTON 진입 | T1·T8, B1 |
| UI-W-REG / GAR-003 | 등록·이미지·편집·삭제 | 4단계 사진/이름 필수, 색상 선택; 고객 편집/삭제 없음 | B: 격리 수동 저장·중복 클릭 방지 | `POST/PATCH/DELETE /garments`, asset intent/finalize 있음; DTO 다름 | 불일치 | 목표 필수 category/color·owner, 이름/브랜드 확장 결정; 동의·READY asset·MinIO; 편집/삭제/공유 | T3·T9, B1·BA |
| UI-W-OBS / GAR-004 | RFID/Vision/Mock 관측 | 고객 화면 관측 입력/신선도 표시 없음 | S: 시연 위치 표시를 관측 접수로 볼 수 없음 | `POST /garment-observations` 있음 | 미구현 | 명시적 Mock 관측 또는 갱신 결과 표시; 시각/신뢰도 보존 | T1, B1 |
| UI-C-CONTEXT / REC-001 | Context snapshot·출처·누락 | 홈 날씨 미제공 안내; 로컬 도움 조건 | B: 없음 안내; U: 실제 snapshot 생성 | `POST/GET /context-snapshots` 있음 | 부분 구현 | 날씨/일정/누락·동의와 snapshot ID 연결 | T2·T4·T9, B2 |
| UI-C-REC / REC-002 | 개인화 Top-K·이유·가용성 | ‘작은 코디 도움’과 로컬 제안 | S: 별도 자체 추천 API; U: 이번 추천 실행 | `POST /outfit-recommendations` 있음; 팀원 `/api/outfits/recommend` | 부분 구현 | 룰/점수/근거·불가 의류 제외·snapshot 전달; LLM 기능을 필수로 승격 금지 | T4·T9, B2 |
| UI-C-MINE / OUTFIT-001 | 내 코디 저장·불러오기 | 로컬 카드 목록·별도 저장 | B: 저장 1개·조회·재사용; 원격 미검증 | `GET/POST /outfits`, `GET/PATCH /outfits/{id}` 있음 | 부분 구현 | 원격 CRUD·보관·권한·revision 연결; ‘코디 저장’과 ‘이미지 카드 저장’ 구분 | T4·T10, B2 |
| UI-C-EDIT / OUTFIT-002 | 코디 슬롯 편집·저장 구분 | 빈 초안·7슬롯·고정·외부 후보 | B: 상/하의 선택·저장; S: 잠금 처리 | outfit DTO는 garment UUID 구성; 외부 혼합 없음 | 부분 구현 | 카테고리/슬롯 정규화·초안 정책·revision; 외부 혼합 저장은 미확정 범위로 분리 | T4·T10, B2·B3 |
| UI-C-STYLE / STYLE-001 | 전체·인스타·쇼핑몰 참고 자료 | 출처 필터·참고 사진·원격 저장 버튼 | B: 쇼핑몰 빈 상태; U: 저장/재구성 | `GET/POST/DELETE /style-references` 있음; 팀원 externalItems와 구조 다름 | 부분 구현 | style_reference와 상품/활동 모델 분리; 등록/삭제/링크·출처 연결 | T4·T11·T9, B2 |
| UI-F-ENTRY / VTON-001 | 모든 확정 IA 진입의 공통 세션 | 저장 코디/홈/캘린더→같은 미러; 의류 상세 직접 버튼 없음 | B: 홈 코디·캘린더 재사용 진입 | `POST/GET /vton-sessions` 있음 | 부분 구현 | source_screen·person asset·garment/outfit ID; 상세 진입·세션 생성 연결 | T1·T6·T9, B3 |
| UI-F-JOB / VTON-002 | 명시적 비동기 VTON·오류·결과 | 피팅 시작·준비 정적 착장·자체 batch/realtime 경로 | B: 상태 표기; U: 이번 피팅 실행/실Decart | `POST /vton-jobs`, `GET /jobs/{id}` 있음; 실제 Decart는 미완성 | 검증 불가 | Mock 작업 E2E 먼저; 이후 최종 유료 검증. 팀원 SDK만으로 백엔드 완료 주장 금지 | T1·T12·T9, B3 |
| UI-F-EDIT / VTON-003 | 의류 교체·결과 갱신·늦은 결과 보호 | 조합 편집·미반영 표시와 snapshot guard | B: 편집; S: guard; U: 실제 결과 갱신 | `POST /vton-sessions/{id}/outfit` 있음 | 부분 구현 | expected_revision·job is_current/stale·실패/취소·재시도 연결 | T1·T4·T12, B3 |
| UI-F-END / VTON-004 | 최종 선택·세션 종료, 착용 별도 | ‘이 옷으로 입기’가 로컬 plan을 생성; backend end 없음 | B: plan 1개·wear 0개 | `POST /vton-sessions/{id}/end` 있음; plan 저장 API 없음 | 불일치 | 버튼을 ‘오늘 코디로 선택’ 등으로 명확화; 최종 선택/종료에 매핑. 별도 plan 기능은 변경 결정 필요 | T1·T10, B3 |
| UI-CARD-DRAFT / CARD-001 | 카드 데이터/템플릿 구성 | 구성품 썸네일을 코디카드로 명명 | B: 썸네일/저장; 템플릿 선택 없음 | `POST /cards/drafts` 있음 | 부분 구현 | CardDraft·template_id·Context 연결; 의류 목록 썸네일과 카드 도메인 분리 | T4·T10, B4 |
| UI-CARD-RENDER / CARD-002 | PNG/WebP 비동기 렌더 | 로컬 Outfit 저장만; 카드 render job 없음 | S: ‘코디카드로 저장’이 saveOutfit 호출 | `POST /card-render-jobs`, job polling 있음 | 미구현 | 준비/렌더 중/READY/실패·결과 자산 UI | T4·T9, B4 |
| UI-CARD-OPS / CARD-003 | 저장·공유·폐기·재사용 | 로컬 코디 저장/재사용; 카드 공유/폐기 UI 없음 | B: 코디 재사용; U: 카드 저장/공유 | card list/save/PATCH/share GET 있음 | 부분 구현 | 렌더 카드 저장, 선택 필드 공유·만료/폐기, 연결 outfit 재사용 | T4·T6, B4 |
| UI-HISTORY / HIST-001 | 착용·케어 이력 조회 | 달력의 local plan/wear/care/movement | B: 월·날짜·계획 조회·reload | `GET /history` 있음 | 부분 구현 | 실제 응답 종류·날짜·timezone 매핑; 계획·이동은 확정 이력과 구분 | T6·T10, B5 |
| UI-WEAR / HIST-002 | 명시적 실제 착용 확인·취소 | 고객 `/`에 확인/취소 없음; `/dev`에 착용 기록 있음 | B: 고객 계획은 wear 증가 없음; S: dev 착용 함수 | `POST /wear-confirmations`, cancel 있음 | 미구현 | 고객 액션으로 추가; plan/VTON/저장과 분리, 취소/버전/멱등 | T1·T13, B5 |
| UI-CARE-GUIDE / CARE-001 | 근거 우선 가이드·사용자 프로필 | 라벨 근거·없음·보조 도움; 목표 프로필 편집 없음 | B: 안내 읽기·이력 불변; U: 실제 라벨 정상 데이터 | `GET /garments/{id}/care-guide`, `PUT .../care-profile` 있음 | 부분 구현 | GET 조회와 AI 도움 분리; REVIEW_REQUIRED·원문·편집/version | T5·T8·T9, B5 |
| UI-CARE-SCHEDULE / CARE-002 | 일정 생성·조회·변경·취소 | ‘관리 일정’이 과거 care 기록을 표시 | B: 탭 클릭, 다음 일정 없음 | `GET/POST/PATCH /care-schedules` 있음 | 불일치 | due_at/주기/상태·overdue·중복·취소를 가진 실제 일정 화면 | T5, B5 |
| UI-CARE-COMPLETE / CARE-003 | 일정 수행·미수행·완료 취소 | 자유 문자열 관리 기록 폼 | B: 폼 열기/닫기; U: 실제 저장 | complete/completion-cancel API 있음; 팀원은 `/care-events` | 부분 구현 | schedule ID·SUCCESS/NOT_DONE·완료 취소로 연결; 임의 메모를 일정 완료로 간주 금지 | T5·T9, B5 |
| UI-LOCATE / STO-001 | 구조화 찾기·위치 근거 | 의류 선택 시 시연 LED, 이름 검색 | B: 상세 위치; 구조화 locator 조작 없음 | `POST /garments/locate` 있음 | 부분 구현 | category/color 조건과 FOUND/STALE/UNKNOWN·fallback; 시연 LED와 실센서 분리 | T1·T14, B1 |
| UI-STORAGE-PATTERN / STO-002 | 착용 패턴 보관 최적화 | 고객 분석 요청/근거 화면 없음 | S: 해당 job 호출 없음 | `POST /storage-optimization-jobs`, job GET 있음 | 미구현 | 홈/케어 진입, 분석 상태·착용 근거·dry-run 결과 | T1·T5, B6 |
| UI-STORAGE-SPACE / STO-003 | 용량·환경 보관 최적화 | 시연 배경·위치만 | S: 용량/환경 제약 및 결과 화면 없음 | 같은 job API 있음 | 미구현 | 환경 신선도·용량·제약과 불가/부분 제안 표시 | T14, B6 |
| UI-STORAGE-ACTION / STO-004 | 제안 승인·실제 이동 확인 | 수동 ‘이동’ 기록 폼만 | B: 폼 열기/취소; S: 문자열 위치 갱신 | actions list/detail/decision/confirm 있음 | 부분 구현 | action UUID·승인/거절/취소·부분 실제 확인. 승인만으로 위치 변경 금지 | T5·T9·T10, B6 |
| UI-SETTINGS / SET-001 | 시간대·단위·알림·동의·연동 | 고객 마이에 프로필/계정만, AI 전송 체크는 등록 보조 | B: 프로필/계정 안내; 제품 설정 없음 | `GET/PUT /settings`, consent-history 있음 | 부분 구현 | 동의 종류/철회·이력·시간대·단위·알림·MOCK_ONLY 연결 | T3·T7·T9, B1 |
| UI-SHOP-PURCHASE / SF-01 | 구매 내역→선택·보유 확인·가져오기 | 쇼핑몰은 스타일 출처 필터뿐 | B: 출처 빈 화면; 구매·확인 UI 없음 | `/shopping/items`, `/sync`, `/import-purchases` 모두 후보이며 현재 없음 | 미구현 | **API·로직 Gap + 프론트 Gap**. 수량/소유/옵션/취소·반품/중복/항목별 보류·부분 실패 | T4·T9, INT-DATA-004 |
| UI-SHOP-LIKED / SF-02 | 좋아요 목록→외부 상품 VTON | 일반 외부 후보 빈 상태; 좋아요 탭/활동 모델 없음 | B: 외부 후보 없음; U: 외부 VTON | 현재 VTON은 garment/outfit UUID 기반; 외부 catalog 입력 없음 | 미구현 | **API·로직 Gap + 프론트 Gap**. LIKED·옵션·이미지·job 결과; garment/wear 생성 금지 | T4·T9, B3, INT-DATA-004 |
| UI-RESPONSIVE | 좁은 웹 화면 상태·조작 가능성 | 배경 축소와 절대 위치 중앙 미러 | B: 390px 겹침·작은 조작부·일부 viewport 밖 | 프론트 레이아웃 문제 | 불일치 | 일반 웹 breakpoint·읽기/조작 영역·스크롤 정책; 미러 뷰 분리 | T14·T15, 화면 JSON |

경로는 별도 표기 없으면 `/api/v1` 접두사를 생략했다. API 대응은 코드/계약에 존재한다는 의미이며 이번 API 호출 통과 표시가 아니다. 잠금·모바일 등의 공통 UX 행과 신규 SF 행은 기존 제품 기능 28개와 별도 집계한다. 이 표의 고객 기능 28행에 팀원 개발 보조 기능을 섞어 ‘전부 구현’으로 판정하지 않는다.

## 5. 통합 충돌과 Gap

| ID | 유형 | 확인 내용 | 통합 방향 |
|---|---|---|---|
| GAP-01 | API·데이터 계약 | 팀원은 cookie 세션·Supabase `sc_*`·`/api/state` 전체 상태·문자열 시연 ID, 목표는 JWT·PostgreSQL wardrobe·UUID·도메인별 `/api/v1` | React 표현 컴포넌트를 분리하고 기존 `web/src/api.js` 계약 처리 재사용 검토. URL prefix만 바꾸는 연결 금지 |
| GAP-02 | 등록 계약 충돌 | 팀원 이름/사진 필수·색상 선택, 목표 owner/category/color 필수·이미지 선택. 현재 API에 name/brand/size/catalog 연결 없음 | 통합 설계 G1에서 비파괴 DTO 확장과 필수값 합의. 현재 UI의 선택 색상을 그대로 보내면 검증 실패 가능 |
| GAP-03 | 자산·동의 계약 | 팀원 `/assets/prepare`와 같은-origin content PUT, allowedProviders; 목표 intent→서명 PUT→SHA256 finalize·READY·member 동의 | 기존 업로드 서비스/클라이언트 재사용. AI 전송 체크를 image_upload_consent나 영구 동의 변경으로 간주하지 않음 |
| GAP-04 | 사건·버튼 의미 | 고객 `/`의 ‘이 옷으로 입기’는 plan, `/dev`의 같은 이름은 실제 wear. 목표 최종 선택·세션 종료·실착 확인은 별개 | 고객 문구와 실제 착용 확인을 분리. 팀원 plan API는 현재 목표에 없음; 별도 도입 없이 세션 최종 선택으로 매핑 검토 |
| GAP-05 | 카드 도메인 충돌 | ‘코디카드로 저장’은 Outfit 저장과 썸네일, 목표는 CardDraft→렌더 job→private asset→저장/공유 | 실제 카드 작업 화면 연결. UI 명칭으로 렌더 성공을 대체하지 않음 |
| GAP-06 | 케어/보관 프론트 Gap | 목표 일정·완료 취소·최적화·제안 승인은 백엔드에 있으나 팀원 UI는 기록/수동 이동 중심 | 기존 `web/src/pages/Life.jsx`, `Storage.jsx` 동작을 참고해 목표 고객 흐름 설계 |
| GAP-07 | 쇼핑 API·로직 Gap | catalog/purchase/LIKED/import 모델·API와 외부 상품 VTON 입력이 없음 | INT-DATA-004 G1~G3 계약 확정 후 G5 UI 연결. fixture 구매는 합성 표시, 구매 기록만으로 실제 보유 확정 금지 |
| GAP-08 | 범위·문서 충돌 | CR-009의 장바구니/최근 본 상품 vs INT-DATA-004 구매·좋아요만; 팀원 외부 혼합 코디 저장 | 최신 축소 범위 적용. 좋아요의 저장 코디/카드 포함은 미확정이므로 이번 확정 기능에 넣지 않음 |
| GAP-09 | UI/UX | 사진 미러 고정 비율과 절대 위치 때문에 모바일 겹침·잘림. 데스크톱도 배경 대비 작업 폭이 작음 | 미러 데모 레이아웃과 일반 웹 레이아웃 분리. 단순 전체 축소 대신 콘텐츠 재배치 |
| GAP-10 | 환경·검증 제약 | 실제 계정/Auth/실상품·라벨·실물 위치/Decart 결과 없음 | 해당 항목은 검증 불가/대기로 유지. 실제 데이터 적재·유료 호출을 분석의 일부로 실행하지 않음 |

팀원 코드의 Supabase 프로젝트 제한이나 예산 안내는 그 전달본의 실행 조건이다. 현재 프로젝트의 새 인증 체계·계정·비용 승인으로 해석하지 않는다. 유료 VTON 시험은 기존 사용자 지시대로 후속 단계의 마지막 검증으로 남긴다.

## 6. 재사용 컴포넌트와 후속 Frontend FSD 범위

| 재사용 후보 | 보존할 UI/UX | 교체/분리할 의존성 |
|---|---|---|
| `MirrorGarmentGrid`, `MirrorPanelThumbnail`, `Icons` | 카드·이미지 placeholder·선택 표시 | 팀원 Asset/ID/category와 singleton 의존성을 목표 DTO props로 분리 |
| `HorizontalPager`, `calendar.ts`, `MirrorCalendar` | 드래그/키보드 탐색·날짜 그리드·빈 상태 | 로컬 events 대신 목표 history response; 모바일은 가로 페이지 외 대안 검토 |
| `MirrorRegistration` | 단계·수동 입력·명시적 저장·입력 유지 | 이름/사진/색상 필수 정책·동의·자산 서비스·중복 키를 목표 계약에 맞춤 |
| `MirrorOutfitWorkspace` | 초안·슬롯 편집·원본 보존·로딩/저장 구분 | 로컬 Repository·외부 혼합·AI 도움 경로를 확정 도메인과 분리 |
| `MirrorCareEvidence`, 계정/원문 dialog 구조 | 출처/정보 없음·Escape·focus trap·inert | 실제 가이드/동의/회원 계약. 실제 근거 없음 상태를 유지 |
| `PhotoWardrobeStage`, `MirrorForeground` | 미러 시연 배경·LED·준비/미반영 안내 | 미러 전용 뷰로 제한. 전경/영상 기능은 제품 필수로 확정하지 않음; 제공 자산 README/라이선스 확인 후 재사용 |
| 기존 프로젝트 `web/` | JWT·API 오류·멱등 키·private upload·job polling·care/storage/card 실행 흐름 | 팀원 시각 컴포넌트와 연결할 얇은 상태/DTO 계층 설계. 실제 재사용은 이번 미실행 |

후속 FSD는 아래 액션→상태→API→결과와 예외를 화면별로 구체화한다. 구현 순서는 설계 제안이며 이번 구현 착수 승인을 뜻하지 않는다.

요구 수준은 세 가지로 구분한다. 세션~설정의 목표 기능은 기존 HLD/FSD의 **기존 확정 요구**다. 구매 가져오기·좋아요 VTON은 INT-DATA-004의 **추가 확정 범위**지만 정확한 DTO·경로는 미확정이다. 컴포넌트 재사용 방식·새 plan 도메인·외부 혼합 저장·실시간 영상/전경·새 API 이름은 **승인 대기 제안**이다. 아래 표는 목표 기능에 필요한 명세 항목을 도출한 것이며 마지막 종류를 확정 요구로 바꾸지 않는다.

| 후속 화면 범위 | 사용자 액션 → 상태 변화 → API → 결과 | 최소 수용 기준 |
|---|---|---|
| 세션/홈 | 프로필 선택→인증 대기/활성→sessions→home 집계 | 401/만료/잠금·프로필 전환 정리, 부분 장애에도 홈 표시 |
| 옷장/등록 | 필터/등록 확인→loading/uploading/saving→garments·asset intent/finalize→목록/상세 | 필수값·owner·동의·READY 자산·중복 재시도·unknown 위치·422/409 안내 |
| 코디/추천/스타일 | 조건/편집/저장→초안/제안/저장됨→Context·recommendations·outfits·style-references | 슬롯/공유 권한·출처·근거·원본 보존·빈 후보, 저장과 착용 분리 |
| 공통 VTON | 진입/시작/교체/종료→session revision/job 상태→vton-sessions/jobs→현재 결과/오류 | IA 진입 출처, 인물/의류 자산, 늦은 결과 미반영·취소·최종 선택과 실착 구분 |
| 코디카드 | 템플릿 준비/렌더/저장/공유→DRAFT/QUEUED/READY/SAVED→cards/jobs→이미지/선택 공유/재사용 | 작업 실패·비공개 자산·선택 공유 필드·만료/폐기·권한 |
| 캘린더/실착 | 날짜 선택/재사용/실착 확인/취소→조회/확정/취소→history·wear-confirmations→확인 이력 | 조회/재사용으로 wear 증가 0, 실제 확인에만 생성, 날짜/시간대·멱등·취소 |
| 케어 | 원문/프로필/일정/수행/취소→근거·예정·완료/미수행→care-guide/profile/schedules→안내/이력 | 라벨 우선·REVIEW_REQUIRED·일정 중복·완료 취소; 조회로 기록 생성 금지 |
| 보관 | 찾기/분석/승인/실이동 확인→job/제안/부분 완료→locate·optimization·actions→근거와 현재 위치 | 승인만으로 위치 불변·unknown/stale·capacity·버전 충돌·실제 부분 확인 |
| 마이/동의 | 설정 저장/동의·철회→저장 중/완료→settings·consent-history→상태/이력 | 사용자 명시 동의·권한·시연/미연동 식별·설정 실패 안내 |
| 구매 가져오기 | 구매 선택/실물·옵션·수량 확인→미확인/승인/처리/보류→후보 shopping 계약→항목별 결과/옷장 | 상품1:실물N·반품/취소·중복 재시도·부분 실패·이미지 동의·Mock/실소유 구분 |
| 좋아요 VTON | 좋아요/옵션 선택/시작→job 로딩/실패/결과→확장된 외부 상품 입력→결과 | 상품 출처·옵션·asset 정합성, garment·wear 생성 0; 저장 코디/카드 포함은 미확정 |

Frontend FSD에서 미확정으로 남길 항목: 독립 IA 원본 재확인, 일반 웹/미러 목표 해상도, plan 저장 도입 여부, 잠금·가구 프로필 UX, 이름/브랜드/사이즈/catalog DTO, 실제 shopping 후보 API 이름, 좋아요 혼합 코디/카드, 슬롯 잠금·LLM 도움·실시간 영상·전경 분리의 제품 범위. 팀원 화면에 있다는 이유로 확정하지 않는다.

## 7. 근거 파일 색인

T는 팀원 전달본의 참고 구현, B는 현재 프로젝트의 백엔드다. 이 색인은 표의 근거 파일을 따라가기 위한 것이다.

| ID | 파일 |
|---|---|
| T1 | [MirrorExperience.tsx](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/MirrorExperience.tsx) |
| T2 | [MirrorHome.tsx](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/MirrorHome.tsx) |
| T3 | [MirrorRegistration.tsx](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/MirrorRegistration.tsx), [MirrorGarmentGrid.tsx](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/MirrorGarmentGrid.tsx) |
| T4 | [MirrorOutfitWorkspace.tsx](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/MirrorOutfitWorkspace.tsx) |
| T5 | [MirrorCareOverview.tsx](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/MirrorCareOverview.tsx), [MirrorCareRecord.tsx](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/MirrorCareRecord.tsx) |
| T6 | [MirrorCalendar.tsx](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/MirrorCalendar.tsx) |
| T7 | [MirrorProfiles.tsx](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/MirrorProfiles.tsx), [BackendPanel.tsx](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/BackendPanel.tsx) |
| T8 | [MirrorCareEvidence.tsx](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/MirrorCareEvidence.tsx) |
| T9 | [backendClient.ts](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/integrations/backendClient.ts), [server/main.ts](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/server/main.ts) |
| T10 | [core/app.ts](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/core/app.ts), [core/types.ts](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/core/types.ts) |
| T11 | [MirrorStyleReference.tsx](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/MirrorStyleReference.tsx) |
| T12 | [mirrorFittingSession.ts](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/mirrorFittingSession.ts), [mirrorScene.ts](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/mirrorScene.ts) |
| T13 | [App.tsx](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/App.tsx) — `/dev` 보조 화면, 고객 완료 판정 제외 |
| T14 | [PhotoWardrobeStage.tsx](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/PhotoWardrobeStage.tsx), [photoSceneMapping.ts](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/photoSceneMapping.ts) |
| T15 | [mirror-experience.css](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/mirror-experience.css), [HorizontalPager.tsx](integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58/src/HorizontalPager.tsx) |
| B1 | [Sprint 1 routes](../backend/app/api/v1/sprint1.py), [Sprint 1 DTO](../backend/app/schemas/sprint1.py) |
| B2 | [Sprint 2 routes](../backend/app/api/v1/sprint2.py), [Sprint 2 DTO](../backend/app/schemas/sprint2.py) |
| B3 | [Sprint 3 routes](../backend/app/api/v1/sprint3.py), [Sprint 3 DTO](../backend/app/schemas/sprint3.py) |
| B4 | [Sprint 4 routes](../backend/app/api/v1/sprint4.py), [Sprint 4 DTO](../backend/app/schemas/sprint4.py) |
| B5 | [Sprint 5 routes](../backend/app/api/v1/sprint5.py), [Sprint 5 DTO](../backend/app/schemas/sprint5.py) |
| B6 | [Sprint 6 routes](../backend/app/api/v1/sprint6.py), [Sprint 6 DTO](../backend/app/schemas/sprint6.py) |
| B7 | [Sprint 7 home route](../backend/app/api/v1/sprint7.py), [home DTO](../backend/app/schemas/sprint7.py) |
| BA | [자산 업로드/동의/검증](../backend/app/application/assets.py) |

이번 산출물은 이 보고서와 Git 제외 QA 증적이다. 팀원 전달본, 현재 `web/`, backend, 기존 설계·통합 문서는 수정하지 않았다. 현재는 목표 대응과 구현 Gap을 확인한 상태이며, UI/API/DB 통합 완료나 사용자 QA 통과로 판정하지 않는다.

분석 종료 시 이번에 띄운 팀원 UI/API 프로세스만 종료했다. 원래 프로젝트의 로컬 서비스는 중지하지 않았다. 종료 전 전달본 352개 파일 해시를 다시 검사해 모두 일치했고, 기존 Git 추적 파일의 변경도 없음을 확인했다.
