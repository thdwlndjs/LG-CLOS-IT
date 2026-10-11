# A단계 계약 정합화 결과 및 변경 이력

2026-10-11 · 기준커밋 badf6f2 · **문서 작업 완료 / B~G 미착수**.

근거는 [사용자 A단계 지시서](../SMART_WARDROBE_STAGE_A_CONTRACT.md)이며 정책 정본은 [POC_CONTRACT_A1.md](../POC_CONTRACT_A1.md), 실행 초안은 [STAGE_B_G_EXECUTION_DRAFT.md](../execution/STAGE_B_G_EXECUTION_DRAFT.md)다. A1은 정책을 확정한 문서이고 구현 완료 보고가 아니다. 코드·DB·에셋·환경·마이그레이션·시드·생성 API 실행은 하지 않았다.

## 변경 방식과 권위

기존 MASTER 핵심 충돌 문구를 직접 변경하고, FSD/HLD/LLD/OpenAPI 및 통합/주제/단계 계약에는 **PoC A1 우선 적용 범위**를 연결했다. 기존 API 경로와 DTO, DB SQL은 바꾸지 않았다. 종전 글이 기술 구현/과거 정책을 기술하는 부분은 이 범위에서 이전 기준으로 명시해 동시 적용하지 않는다. 현재 정상 endpoint에 아직 미구현 PoC 동작이 있다는 설명을 덧붙이지 않는다.

OpenAPI에는 x-poc-stage-a의 target-policy-not-implemented와 정본 경로만 추가했다. 기존 response/request schema는 유지한다. 문서 hash는 승인된 문서 변경에 따른 amendment를 CONTRACT_REVISION_1_7에 추가해 이전/신규 current_sha256 모두 기록했다. 과거1.1~1.6 아카이브나 코드 검사 기준은 바꾸지 않았다.

기존 보고서/증적은 역사 자료로 보존한다. 전차 PARTIAL/WEAR0/10초 등의 기록을 새 정책의 완료로 재작성하지 않는다. 원본 지시서도 변경하지 않았다.

## 기존 문구 → 최신 문구 → 영향 범위

| 변경ID / 기존 위치 | 기존 문구·기준 | 최신 A1 문구·근거 | API·DB·UI·테스트 영향 |
|---|---|---|---|
| A-01 MASTER I.3 / DATA §2 / FSD VTON | 보유·등록만 VTON | POC-V01: 사용자 관심/보유/혼합 모두 시착 | 관심model·asset·user FK/선택snapshot, job DTO/Mockprovider 전체입력. T-V01 |
| A-02 03_EXPERIENCE 입력/복귀 / FSD VTON | 출발 코디/편집상태 복귀 유지 | V02~04: 선택만실행0,생성중선택허용,이탈임시상태초기화 | 원출발 화면 보존과 VTON 내부 임시상태 구분; controller/Compare/picker. T-V02~04 |
| A-03 MASTER I.10/III / 주제03 §확정 / HLD·FSD HIST·VTON / 11~14 | 확정은 선택/LED, wear0, 별도 실착확인 | W01: PoC 보유확정=실착1회. 평가/확인 별도단계없음 | confirm→wear orchestration/intent/Context FK. VTON session end는 명시 확정 외 여전히 wear0. T-W01 |
| A-04 FSD CARD/HIST / 12 계정·저장 | 카드 저장과실착독립,실착별도 | W02/K02: 저장wear0,저장카드 다시입기 새intent wear1 | saved look/confirmation/시간스냅샷. T-W02 |
| A-05 주제02 LED / 14 P1 TTL / 기존local10초 증적 | 시간미정/10초,단순선택구현 | L01~02:명시찾기/확정30초,재요청갱신,선택0 | led_off_seconds/state timer/select/find분리. T-L01~02 |
| A-06 주제02 불확실위치 / 기존LED 전체검증 | 불확실점등차단,요청전체실패가능 | L03:외부/불명 안내+알려진내부만 부분점등 | locate결과/LED부분응답/집합dedup;원격실물차단유지. T-L03 |
| A-07 MASTER I.11/III / 주제03 카드 / 02_AFTER_APPROVAL / 시정P5 | 사용자요청만 카드,추천자동카드금지 | H01:최초홈2~3 PNG preview자동/당일재사용,갤러리미저장 | draft visibility/일자profilecache/renderer참조. T-H01 |
| A-08 MASTER I.9 / FSD COM/REC / 시정P5 | 홈캐러셀2~3·맥락추천 | H01/H02:사용자·일자·날씨일정wear 기반 | Context/이력fixture/추천근거→PNG. T-H01~02 |
| A-09 주제04 관리 / FSD STO | 계절·이력·공간 복수제안 | M01:일정회수>계절>저사용,홈1개/관리전체 | ranking/reasoning/home/management. T-M01 |
| A-10 주제04 상태전이 / FSD STO / 통합14 | 수락≠완료,취소위치불변 | M02:이탈미완료실행취소·제안유지;완료품목보존 | action/proposal연결/배치취소/reentry. T-M02 |
| A-11 DATA/시정§2·§5 / FSD CARE | 합성세탁/케어가능·care완료구현 | M03:가이드/주기만,실제care완료임의생성금지 | seed케어완료제외/가이드출처/UI범위. T-M03 |
| A-12 DATA initial51 / MASTERpending / 시정52 / 승인24 | 단계별 수량·초기지점 다름 | D01:현재76보존·승인왼쪽유지 | 76ID baseline/정합manifest/이동보존. T-D01 |
| A-13 원본배치/주제02/시정P4 | 슬롯/칸과개별sprite 혼재 | D02:오른쪽복원,1벌1ID/위치는칸단위 | scenegeometry vs칸location/여러벌capacity/LED한칸. T-D02 |
| A-14 11~14 C06 / 쇼핑09·10 / OpenAPI PURCHASED | 구매전량일괄등록/동기화 포함 | D04:외부API·쇼핑계정·구매동기화·결제 제외 | 기존구매API 호환보존,PoC UI노출제외/추가구현금지. T-D04 |
| A-15 쇼핑09·10 / style/liked 모델 | 공통Mock관심/외부단품 | D03:사용자별관심DB 사전적재/보유ID분리 | catalog-userrelation/assets/id namespace/access. T-D03 |
| A-16 주제03 카드+기존CTA | 외부card불가/비활성가능 | V05:관심포함해도CTA숨김0,실행시안내·부작용0 | UI표시/guard/server validation. T-V05 |
| A-17 주제03/card 기술규격 | 독립T1~4/시각A/B/저장C | K01:수동template선택+수동생성유지,홈preview예외 | renderer/버전/4종시각독립승인. T-K01 |
| A-18 주제03공유 / FSD CARD | shareable URL/native공유검토 | K02~03:조회·재시착·삭제,SNSsheet목업+실PNG저장다운로드 | delete API/참조·권한/share sheet/공유만료;SNS게시성공금지. T-K02~03 |
| A-19 실행04/시정05/MASTER IV | 자율연속/부분병렬실행허용 | G01:단계구현→독립검증→증적→사용자승인→다음 | B~G게이트/체크포인트잔여ID완전성. T-G01 |
| A-20 P2 seed계획/검증wear0 / 시정합성허용 | 초기이력없음권고·wear0assert | H02/W01:생활시연데이터준비·행동전후delta검증 | 미래B시드/기존검증교체대상. A에서코드안바꿈 |

각 위치는 정본 추적표의 요구ID와 연결된다. 기존 보고서/실제 코드의 wear0/선택LED/10초는 변경 전 증거이며 계약 조항처럼 수정하지 않는다.

## 수정 파일·diff 및 독립 검사

[문서 변경 목록/전후 SHA256](STAGE_A_DOCUMENT_CHANGES.json), [변경 전후 diff](STAGE_A_DOCUMENT_DIFF.md)에 기록했다. 기존 미추적 계약/단계 입력도 변경 전 실제 바이트와 비교했으며 Git에 없었다는 이유로 새 원본처럼 가장하지 않는다. 권위 문서의 링크를 검사하고 OpenAPI YAML 구문/기존path·schema 불변/7개문서 hash 정합을 파일만 읽는 방식으로 검증한다. 제품 실행 검증과는 구별한다.

## 기준 자료와 상태

| 자료 | 경로/상태 | 적용 |
|---|---|---|
| 원본옷장 | web/public/assets/mirror-final/wardrobe-base-led-off.png, reports/wardrobe-visual-review/reference-unchanged.png | 원본 구도/밀도. 해시는 기존 REVIEW 참고 |
| 승인행거 | reports/hanger-individual-v1/review.html, assets/wardrobe-scene-sprites/approved-v1/A1~C8 | 현재 승인21 유지;B3재생성아님 |
| 승인접힘샘플 | approved-v1/K1~K3.png 및 templates/approved_scene_manifest.json | 오른쪽전체66품목 확정manifest와 구분 |
| 카드원본 | references/card/T1_reference.png~T4_reference.png | 4종독립시각게이트 |
| 보유76 | reports/evidence/remediation/poc-status-db.json,live-data-mapping.csv | 기존읽기snapshot,이번DB재조회안함 |
| 실제Scene | reports/evidence/remediation/poc-status-browser.json | 현재24개 ID대응. 전체복원완료증거아님 |
| 기존실행 | browser.json/verification-results.json/T1~T4-comparison.png | 과거성공·PARTIAL 기준. A1완료재판정금지 |

위 자료들은 파일 존재 검사 결과를 별도 문서 검증 JSON에 기록한다. 찾지 못하면 확인 필요이며 추측으로 대체하지 않는다. 원본/에셋 bytes는 변경하지 않는다.

## 실제 구현 차단 질문

- Q-B01: 오른쪽 밀도를 위해 **기존76 우선 재사용+부족분 별도승인 추가**인지 **총76 상한**인지.76보존은 확정이지만 신규등록수는 미정. 기존93자리 시각계획을 그대로 강제하면76전부재배치해도 수량이 부족하므로 임의 상품 추가하지 않는다. 사용자 질문을 제출했고 응답 전 미정이다. 이 결정과 개별 선반 매핑만 B의 해당 적재를 차단하며 다른 정책을 미정으로 돌리지 않는다.
- Q-F01: 홈 자동preview 기본 T1인지 추천카드별T1~4배분인지. 수동저장은 반드시사용자선택이며 이질문과무관. F홈렌더세부작업 전 확정필요. 응답전 임의템플릿고정금지.

관심 사전 적재 후보/환경값/일정값/ID namespace/동순위정렬/삭제참조 방식은 기존근거를 사용해 각 단계의 manifest·기술명세로 검증 가능한 제안을 만드는 구현 작업이다. 모두 제품질문으로 늘리거나 지금 승인 없이 사실데이터로 채우지 않는다. 위 질문에 대한 응답만으로 B실행이 승인된 것으로 간주하지 않는다.

## A단계 완료와 중단

A에서 정책 우선순위와 충돌 범위를 정리했고 요구ID/상태/허용·금지/검증/단계를 연결했다. B~G 초안은 단계별증적과사용자승인을 강제한다. 알려진 정책 충돌은 A1에 우선순위를 붙여 해소했고, 제품선택이 필요한 질문을 별도로 남겼다. 현재구현과의불일치는해소했다고주장하지않는다.

**문서작업후중단한다. B단계는 명시승인전까지 진행하지않는다.**

문서 독립 검증 결과: [STAGE_A_DOCUMENT_VALIDATION.json](STAGE_A_DOCUMENT_VALIDATION.json). YAML 구문 PASS, 기존 OpenAPI paths/components 불변 PASS, revision hash7/7 일치, 변경문서23개 해시 일치, 정본 링크 누락0, 기준에셋 존재 PASS. 이는 A단계 파일 검증이며 B~G 기능 테스트 PASS가 아니다. 원본 정책과 기존 검사 코드가 공유하는 기대값을 새 제품 완료 근거로 쓰지 않았다.

Q-CD01은 생성 중 선택 변경 후 확정/카드의 대상 snapshot 결정이며 C/D/F 후속 액션 연결을 차단한다. 요청 당시 결과의 snapshot 대응은 이미 확정되어 있다. 대상 결정을 임의로 고정하지 않는다. 사용자 응답 전 해당 연결을 구현하지 않으며 A단계 이후 멈춘다. 독립 cold-read는 게이트/상태 조항 발췌문만 검토했고 이 혼용 위험을 지적했다. 전체 코드/보고서 실행 검증으로 확대하지 않았다. 이로써 미해결 제품 질문은 Q-B01/Q-F01/Q-CD01 세 개다.
