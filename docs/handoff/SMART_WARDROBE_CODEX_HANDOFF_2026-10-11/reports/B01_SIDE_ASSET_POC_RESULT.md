# B-01 대표 3종 측면 에셋 제작 PoC 결과

2026-10-12 · 기준 `03db5ba` · 로컬·무료 방식만 사용

**PoC 수행 완료, 확대 적용 판정은 FAIL이다.** 배치 수치와 투명 PNG 제작은 검증했지만 원본의 사진 같은 접힘·소재·그림자를 재현하지 못했다. 35벌 전체 적용이나 B단계 완료를 선언하지 않는다. 나머지32벌 제작, DB 매핑 변경 및 C~G는 진행하지 않았다.

## 대표 선정과 보존 범위

| 표본 | 기존 garment_id / 현재 칸 | 선정 이유 |
|---|---|---|
| REM-03 W's Cashmere Tunic / Titanium | `fa6caeb1-0966-58c2-a81e-2754d7643c2c` / F2 | 회녹색 단색 니트. 편직 결·부드러운 접힘 시험 |
| REM-11 W's Micro D-Luxe 1/4 Zip / Pale Blossom | `883a6a25-4c2c-510b-bbe5-0ca8e5a44e32` / E4 | 연보라 플리스. 니트와 다른 표면·두께 시험 |
| REM-23 Minimalist Wavefarer Board Shorts / Harlequin: El Cap Khaki | `2904fd43-cb31-530d-b4bd-2d9783d3c762` / E2 | 카키 단색부와 위장무늬가 함께 있는 직물. 패턴 보존 시험 |

이름·색상은 기존 상품 metadata와 원본 사진을 확인했다. 소재 혼용률은 세 상품 모두 기존 `material=null`이므로 새 사실로 채우지 않았다. ‘니트/플리스/직물’은 이번 사진상 표면 표현의 분류이며 혼용률 인증이 아니다.

원본 사진 및 기존 아틀라스를 읽기만 했고, 신규 산출물은 [b01-poc-v1](b01-poc-v1/)에 분리했다. 3종의 SVG·PNG는 미승인 임시 파생 버전이다. 기존 garment_id·소유자·칸·원본 asset·승인 에셋은 변경하지 않았다.

## 도구·방식과 재현

Node.js, 저장소에 설치된 Playwright/Chromium, 브라우저 SVG/Canvas만 사용했다. 외부 생성 호출·다운로드·새 패키지 설치·과금은 없었다. imagegen의 코드 네이티브 작업 제외 기준과 사용자의 로컬 제작 지시에 따라 이미지 생성 도구/API는 호출하지 않았다.

[render.mjs](b01-poc-v1/render.mjs)는 새 Bézier 단면·상부 곡선·접힌 입구·봉제선·조명 gradient로 **2.5D 측면 형태**를 만든다. 원본 사진의 원단 부위만 균등 비율로 표면 texture에 사용한다. 전체 정면 의류를 회전·가로 늘림·워프하지 않는다. 실제 3D 천 시뮬레이션이나 사진 복원 모델은 아니며, 이 한계가 시각 FAIL의 주요 원인이다.

[reference-trace.json](b01-poc-v1/reference-trace.json)은 원본1672×941 이미지의 E2/E4/F2 좌우 묶음6개와 바닥3개를 **샘플 geometry 생성 전에** 수동 추적한 기준이다. 이전 seed의 placement를 복사하지 않았다. 외곽은 불투명 옷, 바닥은 지지 선반 윗면이며 수동 추적 불확실성은 약2px다. 사용자 검수로 확정된 정답표는 아니다.

[verify.mjs](b01-poc-v1/verify.mjs)는 두 검증을 구분한다.

1. 실제 앱: 정상 로그인 후 브라우저 route interception으로 **3개 Scene item의 파생 이미지·표시 geometry만** 임시 치환한다. 기존 SVG·cache 경로에서 렌더링하고3개 ID·칸을 유지한다. 나머지84개 item은 그대로다. 이것은 임시 프리뷰이며 실제 백엔드 응답/MinIO 등록/DB 반영을 검증한 것이 아니다. 다른32벌이 정면 셀인 상태도 그대로 드러난다.
2. 격리 배치 시험: 세 표본을 각자 현재 칸의 좌우 두 묶음에3회씩 반복해 규격을 시험한다. 반복 이미지는 **시험용 복제 표시**이며 새로운 의류나 DB 데이터가 아니다. 기존 K1~K3의 매핑을 바꾸지 않았다. 이 fixture는 앱 전체 선반 완료 증거로 사용하지 않는다.

프로젝트 루트 PowerShell에서:

```powershell
node docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/b01-poc-v1/render.mjs
# 기존 로컬 API18081 및 Vite5193이 실행 중인 상태에서:
node docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/b01-poc-v1/verify.mjs
```

재현은 새 PoC 산출물만 다시 생성한다. 기존 상품 이미지·승인 에셋은 덮어쓰지 않는다. DB 보존 확인은 `stage_b_idempotence.snapshot()`의 SELECT 함수만 호출했으며 시드 main은 실행하지 않았다.

## 비교와 실행 증적

- [상품 원본 → 기존 정면 파생 → 신규 측면 비교](b01-poc-v1/source-legacy-side-comparison.png)
- [실제 앱의 3종 임시 적용](b01-poc-v1/app-three-samples.png)
- [원본 추적선](b01-poc-v1/reference-traced.png), [격리 적층 시험](b01-poc-v1/trial-stacks.png), [추적선과 적층 시험](b01-poc-v1/trial-stacks-traced.png)
- 확대 비교: [REM-03 원본](b01-poc-v1/REM-03-reference-shelf.png) / [시험](b01-poc-v1/REM-03-trial-shelf.png), [REM-11 원본](b01-poc-v1/REM-11-reference-shelf.png) / [시험](b01-poc-v1/REM-11-trial-shelf.png), [REM-23 원본](b01-poc-v1/REM-23-reference-shelf.png) / [시험](b01-poc-v1/REM-23-trial-shelf.png)
- [표본·원본/파생 SHA256·crop·접점](b01-poc-v1/samples.json), [브라우저·수치 검증](b01-poc-v1/verification.json), [DB 보존 증적](b01-poc-v1/db-preservation.json)

측정은 Chromium Canvas에서 실제 PNG를 선반 크기로 래스터화한 뒤 alpha≥240인 픽셀 외곽을 검사했다. 투명 여백·그림자는 크기에서 제외한다. 적층·바닥 접점 수치는 묶음 중앙 열을 기준으로 한다. 전체 곡선 접촉면이나 모든 원본 칸의 완료를 증명하는 검사는 아니다. 샘플3종 전체를 원본과 같은 조건1672×941·DPR1에서 캡처했고 브라우저 오류0건을 확인했다.

## 기준별 PASS/FAIL

| 기준 | REM-03 | REM-11 | REM-23 | 판정 범위 |
|---|---|---|---|---|
| 묶음 폭·높이 ±10% | PASS: 폭 -1.79/-1.77%, 높이 +4.00/0.00% | PASS: 폭 -1.80/-1.77%, 높이 -6.90/-3.51% | PASS: 폭 -1.83/-1.79%, 높이 -5.66/+6.12% | 격리 시험 좌/우 실픽셀, 모든 앱 칸 아님 |
| 좌우 묶음 간격 ±5px | PASS: 원본 대비 +2px | PASS: +2px | PASS: +2px | 격리 시험 외곽 |
| 상하 빈 공간0~2px | PASS: 최대1px | PASS: 최대2px | PASS: 최대1px | 중앙 접촉 열. 곡선 전체 접점은 미확정 |
| 바닥 접점0~2px | PASS: 2px | PASS: 2px | PASS: 2px | 격리 시험 중앙 열, 실제 인벤토리 전체 아님 |
| 투명 배경·불투명 외곽 | PASS | PASS | PASS | PNG alpha0 존재, 옷 alpha≥240 존재, 불투명 배경 없음 |
| 색상 계열 | PASS: 회녹색 | PASS: 연보라 | PASS: 카키/올리브 | 육안으로 색상 계열 유지. 색도 정밀 일치 검증 아님 |
| 측면 접힘의 자연스러움 | FAIL | FAIL | FAIL | 입구 곡선·봉제선이 도식적이고 납작한 판처럼 읽힘 |
| 상품 소재·무늬 충실도 | FAIL | FAIL | FAIL | 니트 결 반복이 인공적, 플리스 보풀·탄성 부족, 위장무늬 타일 반복과 원본의 단색부/무늬부 비대칭 소실 |
| 접촉 그림자 자연스러움 | FAIL | FAIL | FAIL | 위치는 맞출 수 있으나 원본의 입체감·주름 그림자를 재현하지 못함 |
| 실제 앱 2묶음×3벌 전체 복원 | FAIL(현상) | FAIL(현상) | FAIL(현상) | 현재 화면 관찰 결과. 전체35벌 시정 작업을 시도한 뒤 실패했다는 뜻은 아님. 샘플 외 정면 셀은 의도적으로 유지 |
| DB·ID·소유·칸·K1~K3 보존 | PASS | PASS | PASS | 관련13테이블 full-row hash 불변. 제품 코드/기존 에셋 diff 없음 |

수치 PASS가 시각 FAIL을 상쇄하지 않는다. 사용자 시각 승인도 아직 받지 않았으므로 확정/배포용 에셋이 아니다.

수치 PASS는 이 PoC의 임시 수동 추적값을 기준으로 한다. 특히 바닥 추적의 약2px 불확실성이 허용 오차와 비슷하므로, 원본 접점 정답이 확정되기 전에는 실제 원본 대비 접점 Gate의 최종 통과를 주장하지 않는다. 전체 접촉면 검사도 남아 있다.

## 확대 적용 가능성과 다음 결정

이 방식은 **투명한 개별 레이어·접점·칸 geometry의 무료 재현 시험**에는 유용하다. 그러나 현재 결과물로35벌을 제작하면 같은 도식적인 외곽, 반복 texture, 상품 특징 소실이 확대된다. **현재 제작 방식 그대로의 전체 적용은 권장하지 않는다.**

무료 범위를 유지하는 후속 후보는 더 정교한 수작업 3D 접힘 모델·소재별 조명/원근 렌더링 또는 실제 접힌 의류 촬영이다. 전자는 제작 시간과 숙련도가 필요하고 자동으로 사진 품질이 보장되지 않는다. 후자는 실제 의류와 촬영 조건이 필요하다. 어느 쪽도 이번 작업에서 착수하지 않았다. 허용된 유료 도구는 없고 승인 요청으로 유료 경로를 우회하지 않는다.

대표3종 PoC 결과와 한계를 보고하고 여기서 중단한다. 사용자 승인 없이 나머지32벌 제작, 기존 에셋 일괄 치환, DB 업데이트 또는 다른 B/C~G 작업을 진행하지 않는다. B는 PARTIAL을 유지한다.

인계 점검: `sip`/`shower`는 권장 적용 판정과 검증 범위를 독립적으로 읽었고, 실험 완료와 B 완료, 현재 전체 화면의 미완료와 전체 시정 시도의 실패를 구분하도록 보완했다. 독립 읽기는 시각 합격 검사가 아니다. `mandela` 관점에서 fixture 반복·중앙 열 수치가 실제 인벤토리 전체나 자연스러움을 증명하지 않도록 제한했고 수동 추적 불확실성도 명시했다. `ssotize` 읽기 전용 대조로 기존 B-01의 C+D 방향과 이번 임시 제작 실패를 구분했으며 기존 계약은 바꾸지 않았다. `re0`로 결과를 정리했다. 외부 사실·이식성 주장은 없어 외부 `factchk` 조회와 `detool`은 적용하지 않았다.
