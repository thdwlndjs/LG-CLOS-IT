# 의류 찾기 표면 조명 검수

의류 샘플 6개와 기존 진행상황은 사용자 승인 완료다. 이번 요청은 **조명 효과를 검수받은 후 다음 단계 진행**으로 해석했다. 현재 게이트는 조명 검수이며 나머지 의류 생성·앱·DB 반영은 아직 진행하지 않았다.

[인터랙티브 검수 화면](http://127.0.0.1:5194/wardrobe-lighting-review-v1/review.html)에서 기본 조명, A5 코트 섹터, B3 셔츠 섹터, K1·K2 선반 칸, 동시 선택을 비교한다. 현재 이 프로젝트 PC에서 검수 서버를 실행해 두었다. 다른 PC에서는 저장소 파일을 확보하고 아래 서버 명령을 실행해야 한다. [미러 UI 포함 합성](B-with-mirror-ui.png), [원단 표면 확대 비교](lighting-closeups.png)도 제공한다. 미러 UI는 이전 로컬 앱의 읽기 전용 캡처이며 실시간 화면 연결 증적이 아니다. 확인 후 채팅으로 조명안 승인 또는 수정할 칸·효과를 알려주면 다음 작업에 반영한다.

## 구현한 검수 효과

- 비선택 수납칸과 같은 행거 칸의 비선택 의류를 기본 34% 감광한다. 감광 정도는 검수 화면에서 조절할 수 있다. 중앙 미러·외곽 프레임·닫힌 서랍·바닥은 감광하지 않는다.
- 행거는 선택 옷걸이·금속 고리·걸린 의류의 윤곽에만 기존 imagegen 표면 조명 참고 이미지를 80% 혼합한다. 선반은 기존 한 단 단위 조명을 유지한다. 검정 코트의 소매·라펠, 데님의 봉제선·주름, 니트의 접힘·층 사이 그림자에 명암을 주었다.
- 새 발광점·글로우·광선·선택 테두리를 추가하지 않는다. 금속 고리·목재 옷걸이에는 표면 반사를 적용하며 조명 자체가 빛나는 점으로 표현하지 않는다. 행거 봉과 배경은 감광한다.
- 전환은 320ms로 부드럽게 연결한다. 움직임 줄이기 설정에서는 즉시 전환한다. 위치 미확인 시 임의 칸을 선택하지 않는다.
- 검수용 5초 자동 소등을 선택적으로 켤 수 있다. 소등하면 강조와 비선택 칸 감광을 모두 해제하고 승인된 기본 이미지로 복귀한다. 5초는 검수 전용이며 기존 제품의 LED 유효시간 계약을 바꾸지 않는다.

행거는 선택한 옷의 금속 고리부터 목재 옷걸이·어깨·소매·밑단까지 보이는 윤곽을 따라 밝힌다. 고정 사각형 마스크와 사각형 경계 페더를 제거하고, 승인된 원본을 확대해 작성한 Path2D 곡선·목재 윤곽·고리 선을 사용한다. 이웃 의류에 가려진 부분은 제외하며 옆옷과 배경은 감광 상태로 유지한다. `lighting.json`의 `cloth_path`, `hanger_path`, `hook_path`가 실제 마스크 기준이다. `sector_bounds`는 검증용 범위이며 발광 사각형으로 사용하지 않는다. 선반의 한 단 조명은 유지한다. 실제 슬롯·기기 접근·원격 LED 권한은 기존 서버 계약을 유지하고, 이번 검수 화면에서는 API나 장치를 제어하지 않는다.

## 확인한 결과와 한계

브라우저에서 세 가지 단일 선택, 세 칸 동시 선택, 선택 전환, 위치 미확인, 5초 자동 소등 PASS. 페이지 오류와 외부/API 요청은 0이다. 선택 칸이 바뀌면 이전 강조를 해제한다.

PNG 비교에서 각 선택 의류 영역의 평균 밝기는 기본보다 높아졌고, 나머지 14개 수납부의 평균 밝기는 낮아졌다. 행거에서는 선택 옷걸이도 밝아지고 같은 칸의 옆옷은 어두워졌다. 윤곽 마스크 밖에서 기본보다 밝아진 픽셀은 0이다. 수납부 밖 변경 픽셀은 0이다. 자동 소등·위치 미확인 상태는 승인된 기본 이미지와 픽셀이 완전히 일치한다. 상세 결과: [브라우저 검증](browser-check.json), [픽셀·해시 검증](integrity.json). 마스크 자체는 `A-silhouette-mask.png`와 `B-silhouette-mask.png`, 원본 확대 참고는 `outline-reference-zoom.png`에 보존한다. 윤곽 정합성의 최종 판정은 확대 비교를 통한 사용자 검수이며 마스크 밖 픽셀 검증만으로 완벽한 윤곽 일치를 주장하지 않는다.

이 검증은 화면 상태·밝기·합성 범위 확인이며 질감의 사실성이나 자연스러운 조명 품질을 자동 승인하지 않는다. 조명은 생성된 시각적 참고이며 실제 조도(lux), 광학 시뮬레이션, 하드웨어 실측이 아니다. 생성된 표면 세부는 원본과 미세하게 달라질 수 있어 확대 비교를 최종 사용자 검수 기준으로 제공한다. 앱 E2E·실제 LED 기기·백엔드 자동 소등은 이번 작업에서 검증하지 않았다.

## 파일과 재현

- `lighting.json`: 입력·구획 좌표·효과 수치·생성 프롬프트·원본 생성 경로의 기준.
- `A/B/E1-relit-context.png`: built-in `image_gen.imagegen` 조명 생성 원본. 승인된 이미지 원본은 덮어쓰지 않았다.
- `review.html`, `review.js`: 검수 전용 선택·감광·표면 합성·타이머.
- `*-selected.png`, `multi-selected.png`, `B-with-mirror-ui.png`, `lighting-closeups.png`: 검수 증적.
- `verify-review.mjs`, `verify_integrity.py`: 브라우저 상태와 읽기 전용 픽셀 비교. Python은 이미지를 편집하지 않는다.

프로젝트 루트에서 다음을 실행한다.

```powershell
node docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/wardrobe-lighting-review-v1/verify-review.mjs
.\.venv\Scripts\python.exe docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/wardrobe-lighting-review-v1/verify_integrity.py
.\.venv\Scripts\python.exe -m http.server 5194 --bind 127.0.0.1 --directory docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports
```

현재 상태: **옷걸이·의류 윤곽 조명 수정본 검수 대기**. 사각형 섹터가 맞지 않는다는 사용자 피드백에 따라 옷걸이를 포함한 윤곽 마스크로 교체했다. 새 상품·조명 이미지를 생성하지 않고 기존 조명 참고 이미지와 네이티브 벡터 마스크를 사용했다. 검수 승인 후 나머지 파생 에셋 생성과 기존 계약에 따른 앱·DB 연결 단계로 진행한다. 이번 변경은 보고서·검수 코드·증적에 한정하며 제품 코드·환경설정·DB·운영 저장소·원격 push·배포를 변경하지 않았다.


## Superseding update: OFF / ON assets
The above 60% overlay description is historical and superseded. Current implementation uses a generated OFF base and selected ON assets without black overlays. See ASSET_SWAP_V2.md.
