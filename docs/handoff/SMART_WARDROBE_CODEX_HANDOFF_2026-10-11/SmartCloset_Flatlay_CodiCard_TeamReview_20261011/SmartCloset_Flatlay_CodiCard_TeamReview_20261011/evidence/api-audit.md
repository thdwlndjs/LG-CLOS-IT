# API 연결 점검 — 2026-10-11

이 문서는 읽기 점검 결과다. 팀 웹 통합·실제 공급자 성공·새 지출 승인을 뜻하지 않는다. 새 프로젝트의 README, 전체 지시문, api 3개 파일과 docs 2개 파일을 읽었다. 과거 복원본은 참고로만 읽었고 앱 코드·설정·원본을 변경하지 않았다. 키·토큰·실제 .env는 읽지 않았다. 이 점검의 공급자 호출·원격 변경은 0회다.

## 현재 확인 범위

- 새 작업: `C:/Users/bryan/Documents/SmartCloset_Flatlay_20261011`.
- 참고 복원본: `C:/Users/bryan/Documents/SmartCloset_20261008_202053_KST`. 팀 배포 코드라는 증거는 없다. 아래 구현은 그 복원본의 현황이며 팀 웹의 현황으로 보고하면 안 된다.
- 과거 `evidence/life-data-connection-20261009/remote-after-counts.json`에는 실행 승인·비용대장·Auth·의류·자산 0건, providerCalls 0이 기록되어 있다. 공급자 계정의 현재 비용 또는 다른 호출 내역을 증명하지 않는다.
- 과거 `runtime-after.json`은 OpenAI 키 존재 true / Decart false, DB 미설정, mock, live false였다. 2026-10-11 `http://127.0.0.1:4311/api/config` 읽기는 연결 거부였다. 과거 상태를 현재 키 설정이나 현재 실행 모드라고 확정하지 않았다.
- 기존 첫 시험 총액 OpenAI USD 1 / Decart USD 1은 사용자 대화의 이전 승인이다. 준비팩의 null 한도나 과거 원장 0을 새 잔액 USD 1로 채우지 않는다. 현재 잔액 확인 자료는 발견하지 못했다.

## 기존 코드의 연결과 제한

| 기능 | 읽어 확인한 계약 | 상태 |
|---|---|---|
| 사진·라벨·스타일 관찰 | `server/providers/openai.ts`, Responses HTTP `/v1/responses`, `gpt-6.1-sol`, low, default tier, store:false, 출력 최대 1800 | strict 결과 검증; 실제 성공 증거 없음 |
| 사진 적합성 | 같은 파일, `/v1/decisions`, `gpt-6-luna` | 카드 선택·저장용 호출로 확장하지 않음 |
| 추천·케어 | `server/providers/agents.ts`, `/v1/agents/sessions`, `gpt-6-astra` medium, 읽기 도구 5개와 영속 journal | 세션 총 지출 상한 미검증 때문에 실제 runtime 차단. fixture만 우회 가능하며 전역 fetch 주입을 거부함 |
| Decart 배치 | `server/providers/decart.ts`, `/v1/jobs/lucy-vton-3.6`, status/content 분리, 영상+단일 reference, 720p | 승인·자산·잔액·영상 검증 뒤 조건부 실행; 실제 job/결과 증거 없음 |
| Decart realtime | `src/integrations/decartRealtime.ts`, SDK 0.2.7, 3.6, WebRTC, 전체 state set, 세대·revision·절대 종료·track 정리 | 토큰 재사용/동시 세션 전체 비용 상한 미검증으로 실제 시작/토큰/변경 차단 |

`server/ai.ts`의 사진/스타일 Sol 보수 예약액은 $5.1007이며 기존 $1 총액보다 크다. 이는 실제 예상 청구액이 아니라 최대 입력을 가정한 예산 예약이다. 이 사진 경로를 metadata-only 첫 추천에 억지로 사용하지 않는다. 준비팩의 단발 Responses 참조는 명시적 입력 크기/출력 상한을 가진 별도 시험에 적합하지만 팀의 기존 Agents 구현을 자동 대체하는 근거는 아니다.

`server/fittingPreflight.ts`는 조회 전용으로 기존 승인/자산 ID·버전·동일 원작업·잔액을 확인하고 실제 reserve/POST는 하지 않는다. `server/fittingContentIdentity.ts`는 owned/external, 자산 버전, 인물/참조, 출력 영향 설정을 구분한다. `src/mirrorFittingController.ts`는 selected/requested/rendered snapshot과 owner/person/draft revision·generation을 비교하고 늦은 결과를 현재 화면에 적용하지 않는다. 이 의미를 새 모듈의 snapshot 경계에 유지해야 한다.

## 공식 문서 재확인

- **Lucy 3.6이 공개 표에 있다.** 현재 모델 표에는 3.6·3.5 모두 realtime/video에 있고 3.6은 newest로 표시된다. 동시에 `lucy-vton-latest`는 3.5로 표기된다. 따라서 버전명을 고정하고 alias로 치환하지 않는다. 실제 계정 접근권한은 별도 미확인이다. [Decart Models](https://docs.platform.decart.ai/getting-started/models)
- 3.5·3.6의 prompting guide는 같은 server-side prompt-enhancement를 사용한다고 명시한다. 약 750 영문자는 대략치이며 한국어는 더 적을 수 있다. 기존 코드의 단순 2000자 검사만으로 공급자 허용을 확정할 수 없다. [Prompting guide](https://docs.platform.decart.ai/models/realtime/vton-3.5-prompting)
- 3.6 공개 가격은 realtime $0.02/초, video $0.04/생성초다. 3.5의 fast는 $0.04/초이고 3.6에는 fast 표시가 없다. 이 값은 계정 잔액/승인이 아니다. [Pricing](https://docs.platform.decart.ai/getting-started/pricing)
- 설치된 SDK 0.2.7의 `dist/shared/model.js`에도 3.6 realtime 및 `/v1/jobs/lucy-vton-3.6` queue 경로가 있다. 공식 3.6 REST 문서는 목록에 있으나 본문 retrieval이 실패해 현재 endpoint 상세를 새로 통과 처리하지 않았다.
- 단기토큰 만료는 새 연결만 막고 활성 연결을 끝내지 않는다. TTL, maxSessionDuration, 앱 전체 절대 종료와 재연결 총예산이 모두 필요하다. 원점 제한은 단독 보안 경계가 아니다. [Client Tokens](https://docs.platform.decart.ai/getting-started/client-tokens)
- SDK `set()`은 전체 state를 교체한다. 상의 변경도 유지할 prompt/image/enhance를 함께 전달해야 한다. [Realtime SDK](https://docs.platform.decart.ai/sdks/javascript-realtime)
- OpenAI Sol의 현재 표는 입력 $2/출력 $10 per 1M, cache-write $2.5이며 long-context/tier/region 가산을 구분한다. 실제 모델·처리 조건 확정 뒤 상한 산식을 갱신해야 한다. [Model](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- 비용 확인은 조직 비용 API에서 시간·프로젝트별로 조회할 수 있다. 권한 있는 기존 연결 또는 사용자 본인의 Usage/Costs 자료가 필요하며 이 점검에서는 인증 요청하지 않았다. [Costs](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)
- store:false는 공급자에서 전혀 보관하지 않는다는 뜻이 아니다. 기본 abuse monitoring 보존 등 별도 정책이 있다. [Data controls](https://developers.openai.com/api/docs/guides/your-data)

## 서버 gate 연결 권고 (현재 live를 켜지 않음)

1. 서버 신뢰 문맥에서 actor/profile 허용 범위를 확인하고 의류·외부후보 source kind/ID와 asset ID/version을 조회한다. raw ID만 비교하지 않는다. 시안 profile을 Auth ID로 만들지 않는다.
2. profile/draft/revision, 선택 전체 조합, 고정 슬롯, 자산 버전, 공급자·고정 모델, 입력 hash를 불변 snapshot으로 묶는다. 카드 이미지와 장식 없는 VTON 참조는 별도 파생물이며 품목 집합은 동일해야 한다.
3. 준비 확인은 조회만 수행한다. 실제 요청은 사용자 명시 동작 뒤 기존 승인과 검증된 잔액에 대해 원자적 예산 예약·동시성/시도 제한을 통과해야 한다. 신뢰하지 않는 브라우저 boolean이나 빈 callback으로 승인하지 않는다.
4. intent 중복은 같은 operation을 반환한다. 제출 전 영속 reserve, 응답 ID 도착 후 영속 accepted, 이후 output 검증을 분리한다. timeout·5xx·원장 기록 실패는 unknown/unsettled로 보존하며 생성 POST 자동 재시도와 0달러 정산을 하지 않는다.
5. OpenAI는 후보 ID·중복 슬롯·고정 조건·허용 프로필·refusal/incomplete/invalid를 검사한다. 결과 적용 직전 화면 epoch와 최신 수동 revision을 다시 비교한다. 제안 성공은 자동 카드 저장·오늘 선택·실착이 아니다.
6. Lucy 배치 완료와 실제 영상 확보/재생/품질 확인을 분리한다. 첫 상하의와 상의 교체 결과의 인물·하의 유지까지 보기 전 전체 코디 성공을 주장하지 않는다. realtime 한도는 토큰당 세션 제한만으로 총액 보장을 주장하지 않는다.
7. fixture transport 성공은 계약검사로만 표시한다. 공개 유료 endpoint를 무인증·무예산으로 열거나 영구키를 frontend/localStorage에 저장하지 않는다.

## 필요한 항목 / 이유 / 없으면 막히는 기능

| 필요한 항목 | 필요한 이유 | 이것이 없으면 막히는 기능 |
|---|---|---|
| 팀 배포와 대응하는 소스·현재 branch 및 기존 서버 경로 | 과거 앱에 별도 구현하거나 다른 저장 계약을 덮지 않기 위해 | 실제 팀 프로필/의류/카드 ID 매핑과 API 통합 |
| 기존 승인에 속한 공급자 프로젝트·사용액/미정산액·남은 금액 자료 또는 권한 있는 비용 조회 경로 | 이전 USD 1+1의 남은 상한을 재사용해야 하며 새로 부여할 수 없음 | 유료 OpenAI·Decart 첫 시험 |
| 실제 사용할 모델·mode·서버 key 설정 여부, 단건/누적/시도/시간 조건 | 키 존재는 모델 사용권·비용 승인과 다름 | 모델별 실요청/정산. 키 원문은 채팅에 필요 없음 |
| 승인 인물 영상 asset ID/version 및 공급자 전송 범위, 팀 의류·깨끗한 참조 대응 | 가상 샘플을 실제 사용자/소유로 오인하지 않고 같은 인물·같은 조합을 검증해야 함 | Lucy VTON 실영상·상의 교체 품질·저장 결과 재생 |

사진 없는 OpenAI metadata-only 첫 시험은 인물 영상 준비와 독립적이다. 다만 위 비용/모델/server gate 조건까지 대신 면제되지는 않는다. 카드·프로필·로컬 저장 구현은 이 대기 항목과 독립적으로 진행할 수 있다.

## 독립 검사 권고

후보 외 ID·source 충돌·중복 슬롯·원피스 충돌·고정 품목 위반, 느린 응답 중 프로필/초안 변경, 불완전/거절/파싱 오류, reserve 실패 시 HTTP 0회, 중복 intent 1회, 제출 불명에서 재접수 0회, usage 없는 정산 미완료 유지, 새 서버 인스턴스에서 원작업 재조회, 카드/저장/VTON 품목 hash 일치, realtime 절대 종료·late stream 정리. 실제 공급자 성공은 이후 별도 작업 ID·사용량·재생 증거가 있어야 PASS다. 이번 점검에서는 앱 테스트나 유료 호출을 실행하지 않았다.
