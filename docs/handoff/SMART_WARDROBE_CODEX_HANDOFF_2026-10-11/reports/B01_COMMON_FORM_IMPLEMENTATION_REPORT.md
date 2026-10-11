# B-01 공통 측면 접힘 적용 결과

2026-10-12 · 시작 커밋 `bc2fd93` · 로컬 격리 DB `wardrobe_test_remediation` · B-01만 수행

## 결정과 현재 상태

사용자가 REM-11-side-v1의 공통 측면 형태를 유지하고 상품별 색상·무늬를 적용하는 방식을 승인했다. [POC_CONTRACT_A1.md](../POC_CONTRACT_A1.md)의 B-01 계약과 [실행 초안](../execution/STAGE_B_G_EXECUTION_DRAFT.md)을 이에 맞춰 수정했다. 이전 PoC의 재질·실제 접힘 재현 FAIL은 역사적 결과이며 소급해 PASS로 바꾸지 않았다. 이번 계약에서는 사진 수준의 소재 재현을 완료 조건에서 제외한다.

35벌에 별도 버전 PNG/SVG를 제작하고 실제 Scene API에 연결했다. 기존 K1~K3 31벌은 파일을 그대로 유지하고 불투명 외곽 기준 배치만 수정했다. 11칸마다 좌우 2묶음 × 3벌, 총 66벌이며 의류별 ID는 유지했다. 정면 상품 사진이 선반에 혼재하는 문제를 제거했다. 승인 왼쪽 21벌과 원본 상품 이미지는 수정하지 않았다.

**B-01 구현·수치 검증은 완료했고 최종 시각 승인은 대기한다. B단계 전체는 PARTIAL이다.** 기존 일반 의류 상세/위치 API의 source 위치 별칭 문제는 이번 범위 밖으로 남겼다. C~G, 원격 push·배포, 운영 DB, 유료 API, 실물 LED는 실행하지 않았다.

## 구현과 데이터

| 변경 | 내용 |
|---|---|
| `web/test/shelf-common-form.mjs` | 기존 REM-11 곡선 기반 무료 로컬 SVG/PNG 제작. 원본 사진 마스크 내부 색상 추출, REM-23/25의 카무플라주 무늬 단순화 |
| `scripts/stage_b_common_shelf.py` | 기존 업로드 동의 확인 후 upload intent → 업로드 → finalize. 35 파생 에셋·66 geometry를 로컬 DB에 연결 |
| `backend/app/application/wardrobe_scene.py` | placement의 `sprite_override` 해석. READY·가구·역할·원본 asset ID·원본 SHA 일치 검사, 실패 시 표시 차단 |
| `scripts/stage_b_seed.py` | 재적재 시 승인된 공통 형태 manifest의 geometry 유지 |
| `backend/tests/integration/test_stage_b.py` | 정상 override, 원본 SHA 불일치, 타 가구 override 차단 검증 |
| `web/test/shelf-common-browser.mjs` | 실제 API·MinIO 이미지로 두 프로필 렌더링·불투명 외곽 측정 |

기존 API 응답과 DB 스키마는 유지했다. scene_placement.geometry JSON에 표시용 override를 추가했으며 garment.image_asset_id의 상품 원본은 변경하지 않았다. DB Migration은 없다. [매핑 manifest](../templates/b01_common_shelf_manifest.json)에 garment·원본 asset·파생 asset·칸·geometry·checksum을 기록했다.

작업 전 asset 271개에서 311개로 증가했다. 현재 연결된 신규 공통 에셋은 35개이며, 배치 보정 중 생성한 중간 버전 5개도 삭제하지 않고 보존했다. 기존 76벌 및 작업 전 총 104벌의 전체 행·상태는 그대로다. 신규 의류 등록은 없다.

## 검증 결과

| 항목 | 결과 | 근거 |
|---|---|---|
| 김수진·최휘재 실제 브라우저 | 각 오른쪽 66 / 왼쪽 21, 표시 ID 중복 0, 브라우저 오류 0 | [browser.json](b01-common-v1/browser.json) |
| 묶음 크기 ±10%, 적층·바닥 접점 0~2px | 각 프로필 22/22 PASS | 같은 증적의 stacks |
| 좌우 간격 편차 ±5px | 각 프로필 11/11 PASS | 같은 증적의 groups |
| 기존 76벌·원본 asset 행 보존 | PASS | Stage B 실제 DB 검증 재실행 |
| 11개 비대상 테이블 전체 행 보존 | PASS | [db-verification.json](b01-common-v1/db-verification.json) |
| 동일 적용 명령 재실행 | 13개 테이블 수량·전체 행 해시 불변 | 같은 증적 |
| Scene·Stage B·설계 계약 회귀 | 14 PASS, 49 warnings | [backend-tests.txt](b01-common-v1/backend-tests.txt) |
| Ruff | 변경 Python 파일 검사 PASS | 로컬 실행 |
| 최종 시각적 품질 | 사용자 승인 대기 | 아래 실제 화면 |

실제 화면: [최휘재](b01-common-v1/최휘재-actual.png), [김수진](b01-common-v1/김수진-actual.png). 별도 검수 화면이나 Mock 응답을 사용하지 않았다.

두 프로필은 같은 가족 옷장의 66벌을 각각 검사했다. 22묶음은 묶음당 3벌이다. 이미 받은 승인은 공통 형태 제작·전체 적용 방식이고, 남은 승인은 실제 최종 배치의 시각적 결과다. 49 warnings는 Alembic 설정 폐기 예정 경고 2개, botocore UTC 호출 폐기 예정 경고 46개, Windows pytest 캐시 쓰기 거부 1개다. 테스트 실패는 없었고 권한 설정은 변경하지 않았다.

## 수치 판정의 한계와 독립 기준

[reference-trace.json](b01-common-v1/reference-trace.json)의 22개 묶음 및 선반 바닥 좌표는 원본 이미지에서 먼저 추적했다. 측정은 1672×941, DPR 1 실제 브라우저의 SVG crop/clip/meet 결과에서 alpha≥240인 불투명 외곽과 중앙 적층 간격을 사용한다. 원본 추적에도 사람이 해석한 오차가 있으므로 수치 PASS만으로 원본과 동일한 질감이나 자연스러움을 선언하지 않는다. `mandela` 검토의 verifier=designer 위험은 실제 원본과 캡처의 사용자 비교 승인으로 분리한다.

F7 왼쪽은 PNG viewport의 nominal 폭이 +11.2%이지만 투명 여백을 제외한 실제 불투명 묶음은 ±10%를 만족한다. 제작 도구의 nominal `failed_geometry`가 남아 있는 것을 숨기지 않으며, 완료 판정은 실제 표시된 의류 외곽 기준이다. 검사 임계값은 완화하지 않았다. 카무플라주와 공통 곡선은 표시용 도식이며 실제 제품의 모든 로고·재질·접힘을 재현하지 않는다.

## 실행과 복구

프로젝트 루트, 기존 로컬 서비스가 실행 중인 상태에서:

```powershell
node web/test/shelf-common-form.mjs
.venv/Scripts/python.exe scripts/stage_b_common_shelf.py apply
node web/test/shelf-common-browser.mjs
.venv/Scripts/python.exe scripts/stage_b_verify.py
```

앱은 http://127.0.0.1:5193 에서 두 시연 프로필로 확인한다. 원본 상품 에셋과 승인 K 파일은 유지되므로 [before.json](b01-common-v1/before.json)의 66 placement geometry로 로컬 트랜잭션 복원할 수 있다. seed manifest override도 함께 해제해야 재적재가 새 배치를 다시 적용하지 않는다. 자동 삭제·초기화는 수행하지 않았다.

API 시작은 `.venv/Scripts/python.exe scripts/remediation_local.py serve`, 프론트 시작은 `web/`에서 `npm run dev -- --host 127.0.0.1 --port 5193`이다. PostgreSQL56433·MinIO19000·Redis16379 등 기존 로컬 인프라가 필요하다. 위 명령은 순서대로 실행하며 `apply`만 DB/스토리지를 변경한다. 롤백 설명은 수동 복구 설계이며 이번 작업에서 자동 복원 명령을 구현하거나 실행한 것은 아니다.

일반 위치 API의 source 별칭 문제 때문에 의류 상세에서 물리적 칸 표기가 일관되지 않을 수 있다. Scene의 66개 칸 연결 검사는 통과했지만 일반 상세/찾기 전체 플로우 완료까지 뜻하지 않는다. 기존 표시 보류 7벌도 임의 슬롯을 만들지 않고 유지했다.

남은 사항은 최종 선반 시각 승인과 기존 B단계 위치 API 연결이다. 후자는 별도 승인 범위에서 진행한다.
