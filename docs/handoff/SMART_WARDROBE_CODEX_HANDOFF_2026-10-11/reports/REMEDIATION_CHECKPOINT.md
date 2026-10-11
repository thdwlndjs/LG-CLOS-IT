# 시정 작업 체크포인트

2026-10-11 · `feat/handoff-p3-p10` · 시작 HEAD `1fffbeb`.

최우선 `execution/05_P3_P10_REMEDIATION.md`. 최종 보고서 `P3_P10_REMEDIATION_REPORT.md`. 전체 PARTIAL: 실제 데이터/Mock 기능 경로 통과, 카드 시각 Gate A/B 미완료, 기존 계약 문서 검사2건 실패. 운영 DB/remote push/merge/deploy/유료 API 금지 유지.

## 완료 증적

- 공식 실제 사진52개: Worn Wear51+Dr. Martens PC11. 초기 내부35/외부8/소품9. 엄마18/아들25/아빠5/딸4. 소재·케어 미확인 null. 소유/계절/위치/환경은 합성.
- `templates/remediation_products.json` frozen 원본 URL/SHA256/MIME/SVG mask. 원본 래스터는 gitignore된 test-results/remediation/source-images, public에서 제거.
- DB wardrobe_test_remediation: 52개 READY 사진, 새 signed 다운로드52/52 해시 일치, 가족4명, 착용0, 용량 초과 없음. 현재 내부33/방10/소품8/신발1; 반복 QA 이동을 초기화하지 않는다.
- 동적 scene와 동일 슬롯 Mock LED/10초 자동 소등, 실제 AVAILABLE 가족 의류 추천3개, carousel/VTON/복귀, LIKED 보유 미등록, 보관 승인≠완료 및 회수 후 DB/scene 갱신.
- 엄마·아들 각각 T1~T4 신규 카드 PNG 생성→private MinIO→DB 저장→재조회/다운로드. browser.json 최종17 그룹 PASS, page error/HTTP 실패0. 카드 시각 품질과 분리.
- backend279 PASS; web35 PASS; renderer5 PASS; OpenAPI validator/Ruff/TS/build PASS. contract8PASS/2FAIL, baseline1fffbeb 같은2FAIL(7PASS). 로그 reports/evidence/remediation/.
- 카드4종 비교 PNG/HTML 및 generated-assets/card/layout manifests. 개별 접힘·레이어/occlusion·광원 retargeting 부족, Gate A/B PARTIAL/C local PASS.

## 실행 상태와 재개

API18081(session49432), Vite5193(session4048), renderer3300(session62813)는 루프백 실행 중. PostgreSQL56433/MinIO19000/Redis16379는 별도 데모 컨테이너. 자격정보는 ignored test-results/handoff/runtime.json. 기존 사용자 DB/서비스와 이전11개 검증 DB 보존.

API는 시연 로그인 수정 후 session48410으로 재기동했다(동일18081). DB·MinIO·Redis는 재시작하지 않았다.

정확한 명령/입력은 최종 보고서 로컬 실행 절을 따른다. API serve는 JWT가 없으면 로컬 runtime에 새 secret 생성. prepare/verify는 기존 이동 상태 보존. tmpfs DB를 중단·재시작하면 데이터가 사라질 수 있으므로 검수 중 임의 재시작 금지.

다음 작업: 카드 참조별 접힘/레이어 복원과 실제 선택 의류의 형태 치환 수정 후 비교 캡처로 수동 Gate A/B 인수. 기존 FSD operation 추적/문서1.7 revision 불일치는 별도 정합성 작업. 실제 Decart/실물 LED/사진 재배포 권리는 별도 인수 게이트. 외부 장애로 카드 구현 미완료를 숨기지 않는다.

shower cold read는 판정/재개 발췌문을 읽었으며 전체 보고서 검사는 아니다. renderer 환경변수/실행 위치, 서버 상태, 필수 참조 파일, 시각 통과 기준을 최종 보고서에 보강했다. mandela 관점으로 기존 카드 ID가 성공 판정에 섞이지 않도록 신규 ID를 대조했고, 실제 다운로드 해시를 원본/DB와 독립 대조했다. 계약 원본 해시를 임의 재작성해 실패를 숨기지 않았다.

로컬 커밋 해시는 아래에 기록한다. 기존 미추적 인계 입력/팀원 자료는 보존하며 stage/push하지 않는다.

- 구현 커밋: `6f5b667` — verified photos/격리 DB/scene/추천/Mock E2E 연결.
- 보고서·증적 커밋: HEAD에서 `docs: record remediation evidence and incomplete visual gates` 메시지로 식별한다. 원격 push 없음.

## 사용자 QA 후 배경 수정

로그인 전/scene frame 미확보 시 동적 stage가 원본 이미지를 숨겨 임시 배경만 남던 결함을 수정했다. PhotoWardrobeStage는 동적 모드에서도 생성된 빈 옷장 이미지를 항상 기본으로 표시하고 서버 frame/의류를 위에 표시한다. photo-db-scene의 임시 갈색 gradient를 제거했다. Playwright 새 비로그인 세션에서 clean plate decode 및 overlay backgroundImage=none 확인, TypeScript/Vite build PASS. 캡처는 ignored test-results/remediation/background-fallback-fixed.png. 카드 Gate A/B 및 전체 PARTIAL 판정 유지.

## 시연용 로그인 QA

사용자 지시로 카드 후속 작업 중단(카드 변경 없음). 브라우저 버튼 POST /integration/demo-login이503 Demo account is not provisioned를 반환했다. 시정 DB의 4인 계정과 기존 고정 demo UUID/login이 달라 발생했다.

선택적 LOCAL_DEMO_MEMBER_ID를 추가하고 격리 서버에서 아들 MEMBER를 지정했다. 해당 설정은 local/test, 비공개, DEMO auth 및 demo_auth_enabled일 때만 적용한다. enabled credential·MEMBER·기기 연결을 확인하며 기존 계정명/비밀번호·4인 DB 구조를 변경하지 않는다. 공개 demo 경로와 기본 고정 demo 동작은 보존한다. 운영에서는 이 로컬 설정만으로 로그인할 수 없다.

실DB demo-login/config20 tests PASS, Ruff PASS. 실제 브라우저 시연 버튼200→가족4인/52개/사진52개→동적 scene→로그아웃200 및 버튼 재진입 PASS. 재현: web에서 `node test/demo-login-remediation.mjs`. 캡처 ignored test-results/remediation/demo-login-fixed.png. API18081 재기동, 운영 DB/원격push/배포 없음.

## 사용자 시각 요구 재확인: 옆으로 걸린 옷 / 개어진 옷

상품 정면 사진을 슬롯에 축소하는 방식은 요구와 다르다. 실제 원본을 보존하고 별도 생성 파생 이미지를 행거용 옆 모습/서랍·선반용 접힌 모습으로 만들어 위치에 연결했다. 원본 이미지 ID는 상세·추천·카드에서 유지한다. 생성 결과를 공식 제품 사진이나 실제 접힘 관측으로 표시하지 않는다. 52개 원본 해시에 묶인 7개 투명 PNG atlas와 두 모습의 후보 에셋을 생성했다. assets/wardrobe-scene-sprites에 로컬 보존, private MinIO에 업로드/finalize, 기존 asset metadata로 연결. 공개 static 파일 아님. geometry-only 보정으로 완료 처리하지 않았다. 용량/보관 위치·소유자/이력은 변경하지 않았다.

행거 geometry는 해당 봉 아래 한 줄로 재배치, 선반은 바닥 정렬. SVG crop/alpha silhouette로 종횡비 유지, 앞옷/클릭 영역 z 순서 일치. 원본 checksum이 변경되거나 atlas가 삭제/타 가구/미READY이면 이전 파생 에셋을 사용하지 않는다. 닫힌 G 서랍은 기존처럼 offstage 유지. 개어진 후보는 확보했지만 닫힌 서랍의 펼침 UI를 새로 만들지는 않았다.

실제 브라우저: 로그인/가족52개, 가시33개 전부 파생(행거23/접힘10), 모든 SVG 실제 이미지 decode, page error0, 시연 로그인/로그아웃 PASS. web38 tests/TS·build PASS, scene 단위8 PASS, handoff 실DB7 PASS, Ruff PASS. 마지막 API session73277/18081. 재현: 루트 `python scripts/provision_wardrobe_sprites.py`, `python scripts/remediation_local.py layout`, web `node test/wardrobe-sprites-browser.mjs`. Python은 .venv 사용. 생성 파일/manifest가 없으면 자동으로 외부 이미지 API를 호출하지 않는다. 기존 파일을 새 생성으로 덮어쓰지 않는다.

생성된 색/주름/로고 세부는 추정 파생이며 실제 상품 정확성을 인증하지 않았다. 현재 화면을 확인한 로컬 표시 후보, 사용자 시각 인수는 아직이다. 카드 Gate A/B는 이번 옷장 이미지 수정과 별개로 PARTIAL 유지. 외부 API/원격push/배포/운영 DB 변경 없음.

## 현재 시연 계정 2개

사용자 지정 페르소나: 김수진 42세(엄마), 최휘재 27세(아들). 격리 DB의 기존 mom/son member 이름만 변경하고 소유자 ID·역할·52개 의류·착용 이력은 유지했다. 나이는 시연 프로필 표시값이며 member 스키마를 확장하지 않았다.

기존 가족 구성원은 4명이며 아빠·딸 데이터도 유지한다. 저장된 시연 로그인 버튼만 엄마·아들 두 개로 제공한다. 공개 환경 차단 테스트는 목록 items=[] 및 프로필 선택 로그인403을 실DB 테스트로 확인했다. 이번 계정 기능은 검증 통과했으며, 전체 PARTIAL은 앞서 기록한 카드 Gate A/B 등 별도 미완료 사항에 대한 판정이다.

마이의 **누가 옷장을 사용하나요?** 기존 프로필 선택 화면에 김수진·최휘재 두 프로필을 표시한다. 내 계정에 잘못 추가했던 선택 UI는 제거했다. 이름·나이·엄마/아들·사용 중 상태는 기존 프로필 디자인으로 표시한다. 선택 시 실제 JWT 세션을 발급하며, 다른 프로필 선택 시 이전 세션을 서버에서 로그아웃한 다음 새로 로그인한다. 비밀번호·토큰을 카드에 저장하지 않는다. 로그인 필요/기본 시연 사용자 placeholder는 두 프로필이 제공될 때 표시하지 않는다. 일반 로그인 계정은 기존 허용 프로필 계약을 유지하고 가족 계정으로 위임하지 않는다.

GET /integration/demo-profiles 및 기존 POST /integration/demo-login의 선택적 profile=mother|son을 추가했다. 기존 빈 요청 로그인과 공개 demo 경로는 유지한다. 로컬 프로필 선택은 비공개 local/test DEMO에서만 허용하며 enabled credential·명시적 member ID·같은 가구의 기기 접근을 확인한다. 엄마 OWNER 역할은 명시적 로컬 엄마 ID에만 허용한다. 운영·공개 배포에서는 프로필 목록이 비어 있고 이 선택 경로는 차단된다.

재현: 루트 `.venv/Scripts/python.exe scripts/remediation_local.py personas`(격리 DB 이름만 갱신), `.venv/Scripts/python.exe scripts/remediation_local.py serve`(API 18081; 두 로컬 ID 자동 설정). web에서 `npm run dev -- --host 127.0.0.1 --port 5193`, `node test/demo-personas-browser.mjs`. 브라우저 테스트는 마이 → 프로필 선택에서 엄마 → 아들 → 엄마 직접 전환, 각 계정 가족 의류52/사진52/소유자4, 사용 중 표시, 내 계정에 프로필 카드 없음까지 확인했다. 계정 ID 서로 다름, page error0, PASS. 기존 backend demo-login 실DB4 tests 및 web38 tests PASS; 이번 UI 위치 수정 후 TypeScript/Vite build PASS(기존 bundle 크기 경고). 증적: evidence/remediation/demo-personas.png 및 demo-personas-browser.json. 원격push/배포/운영 DB 변경 없음. 전체 시정 PARTIAL 판정 유지.

## 의류 샘플 6개 승인 · 옷걸이·의류 윤곽 조명 검수 대기

기존 앱의 전체 sprite 외형은 승인되지 않았다. Codex 수정 전 팀원 원본 `wardrobe-base-led-off.png`를 시각적 기준으로 사용한다. [후보·배치 승인안](wardrobe-visual-review/REVIEW.md), [HTML 시안](wardrobe-visual-review/proposal.html)에 공식 상품 후보33개(왼쪽21개+가족 대표12개), 원본 좌표를 보존하는 배치도·CSS 조명 연출안을 작성했다. 왼쪽 행거21자리 중 휘재18, 오른쪽은 선반당2묶음×3층을 제안한다. 기준 원본과 공유본 파일 해시 동일, 공식 사진33개 decode 및 후보 상품 ID 중복 없음 확인. 원본 보존 방식의 새 샘플 6개는 아래와 같이 승인되었으며 전체 의류 교체는 아직 진행하지 않았다.

상품 후보·배치 방향과 행거 A5·B3·C6 및 선반 K1·K2·K3 샘플은 사용자 승인 완료. 조명안 전반은 긍정 평가되었으나 사각형 섹터가 맞지 않는다는 추가 피드백이 있었다. 행거 조명을 선택 옷걸이의 고리·목재부터 어깨·소매·밑단까지 보이는 윤곽을 따라 합성하도록 수정했다. 고정 사각형 조명 마스크는 제거했고 옆옷 감광과 선반 조명은 유지한다. 현재 산출물·재현 명령·승인 게이트는 [표면 조명 검수 보고서](wardrobe-lighting-review-v1/REVIEW.md)를 기준으로 재개한다. 기존 조명 참고 이미지 재사용, 새 상품·조명 이미지 생성 없음. 기본34% 감광, 표면 참고80% 혼합, 320ms 전환, 검수용5초 자동 소등, 새 발광점·글로우·선택 테두리 없음. 브라우저 단일/동시/전환/위치미확인/자동소등 PASS. 읽기 전용 비교에서 선택 의류·옷걸이 밝기 증가, 같은 칸 옆옷 감광, 윤곽 마스크 밖 밝기 증가0, 수납부 밖 픽셀 변경0, 소등 후 기본 복귀 PASS. 실제 윤곽 일치는 사용자 확대 검수 대기이며 앱·서버 LED·하드웨어 검증과 구분한다.

원본은 시각적93자리이며 현재 격리 DB52개와 다르다. 최종 적재 수량·선반 전체 상품 배정은 미확정이다. 사용자 지시로 조명 검수 후 다음 단계로 진행하므로 현재 나머지 에셋 생성·앱·DB·운영 저장소 변경·원격push·배포는 진행하지 않는다. 이전 후보·샘플 검증 증적의 승인 대기 값은 당시 기록이며 현재 게이트는 조명 승인이다. 현재 로컬 앱에는 새 의류 샘플과 조명 검수안을 적용하지 않았다.


## 2026-10-11 ?? ?? ? ??? ?? 60%

???? ?????? ?? ??? ????. ??? ?? ??? 34%?? 60%? ????. ??/?? ?? ???? ?????. ?? ??? ??? ?? ??? ?? ??? ??? ??? ?? ?? ? ???? DB ????. ?? push?????? DB ??? ???? ???.


## Lights OFF / ON asset replacement
Latest instruction replaces the 60% overlay implementation: generated wardrobe-lights-off-v2.png, existing selected relit assets, no black layers. Review code switched; app/DB rollout pending.


## Individual hanger extraction checkpoint
Understood as: permanent individual garment layers in the normal scene, not find-only masks; preserve the current approved visual composition.
21 transparent source-pixel PNGs and original coordinates exported to hanger-individual-v1. Reassembly matches original pixels exactly; independent PNG readback passed. Browser hide actions for all21 and move previews passed. Edge quality and occluded backs remain incomplete; app/DB/light variants not applied. See hanger-individual-v1/REPORT.md for current scope and resume steps.
