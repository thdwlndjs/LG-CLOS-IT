# 옷장 의류 6개 시각 검수

상품 후보·배치 방향 및 샘플 6개는 사용자 승인 완료다. 행거 3개와 선반 측면 접힘 3개를 built-in `image_gen.imagegen`으로 각각 생성했다. 상품 사진은 색·소재·구조 참고로만 사용했고, 최종 화면에는 생성된 옆으로 걸린 모습과 측면 접힘을 합성했다. 다음 게이트는 [의류 찾기 표면 조명 검수](../wardrobe-lighting-review-v1/REVIEW.md)다.

| 샘플 | 위치 | 표현 |
|---|---|---|
| A5 | 왼쪽 긴 행거 5번째 | 검정 더블브레스트 코트, 옆 방향·이웃 의류 중첩 |
| B3 | 왼쪽 두 번째 칸 상단 3번째 | 빈티지 인디고 데님 셔츠, 측면 포켓·소매 |
| C6 | 같은 칸 하단 6번째 | 에크루 진, 기존 바지 행거의 좁은 측면 |
| K1 | 미러 오른쪽 첫 칸 1단 왼쪽 맨 위 | 샌드 니트, 얕은 접힘·리브 질감 |
| K2 | 같은 1단 오른쪽 중간 | 네이비 니트, 얕은 접힘·층 사이 그림자 |
| K3 | 같은 칸 4단 왼쪽 맨 위 | 차콜 니트, 곡면 접힘·얇은 측면 |

[전체 옷장 합성](wardrobe-composite.png), [실제 미러 UI를 함께 표시한 합성](actual-screen-composite.png), [6개 원본/샘플 확대 비교](six-sample-closeups.png), [전환 가능한 검수 화면](review.html).

`actual-screen-composite.png`는 로컬 앱을 읽기 전용으로 캡처한 중앙 미러 영역과 샘플 옷장을 결합한 검수용 합성이다. 앱에 에셋을 연결한 실행 증적이 아니다. 나머지 의류는 원본이므로 신규 상품으로 전부 교체된 상태도 아니다.

이번 샘플은 위치별 그림자·중첩을 포함한 **장면 패치**다. 배경이 제거된 범용 투명 sprite가 아니다. `*-context.png`는 생성 원본, `*-sample.png`는 생성 결과를 원본 주변 문맥과 함께 보여주는 확대 검수본이다. 좌표와 최종 프롬프트는 `samples.json`에 보존했다. 선반에서는 접힌 상품의 지퍼·목 형태가 대부분 가려지므로 제품 정면 디테일을 억지로 노출하지 않았다. 생성된 접힘은 실제 상품 관측을 인증하지 않는다.

B3 초안은 2번째 행거에 생성되어 폐기하고 3번째 행거로 재생성했다. K2 초안도 맨 위 층에 생성되어 폐기하고 승인안의 중간 층으로 재생성했다. 다른 선반의 층수와 묶음 수는 그대로 유지한다.

브라우저 렌더 검증은 6개 이미지 로딩 PASS, 합성 영역 밖 픽셀 변경 0 및 원본 SHA256 유지 PASS다. 결과는 `verification.json`과 `integrity.json`에 기록했다. K2 생성 원본만 너비1671px이며 나머지는1672px, 높이는 모두941px이다. 패치는 리사이즈 없이 동일 좌표에서 합성했다. 자동 검증의 PASS는 파일 로딩과 합성 영역 확인이며 시각적 완성도 승인과 구분한다. 사용자는 이후 이 샘플을 승인했다. 당시 검증 JSON의 승인 대기 값은 검증 시점 기록이며 현재 상태는 `samples.json`을 기준으로 한다.

재현: 프로젝트 루트에서 `node docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/wardrobe-visual-samples-v1/render-review.mjs`, 이어서 `.venv/Scripts/python.exe docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/wardrobe-visual-samples-v1/verify_integrity.py`. 로컬 검수 URL은 `http://127.0.0.1:5194/wardrobe-visual-samples-v1/review.html`. 서버 재시작 명령은 `.venv/Scripts/python.exe -m http.server 5194 --bind 127.0.0.1 --directory docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports`다.

현재 게이트: **샘플 6개 승인 완료, 표면 조명 검수 대기**. 나머지 에셋 생성·앱 코드·DB·운영 저장소 변경·원격 push·배포는 수행하지 않았다. 조명 검수 후에도 장면 패치를 제품 원본 이미지로 덮어쓰지 않고, 승인된 배치와 기존 계약에 맞는 파생 에셋으로 반영해야 한다.
