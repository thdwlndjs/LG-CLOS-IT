# Smart Wardrobe — Codex 실행 인계 패키지

- 버전: `H1.0` / 작성: 2026-10-11
- 상태: **사용자와 확정한 정책을 모은 작업 명세 + 기존 저장소 대조 전**
- 프로젝트 경로: 실제 작업 환경에서 확인. 과거 대화상 후보 `C:\Users\aicam\Desktop\2차프로젝트`; 없으면 현재 저장소 루트 우선.
- 가장 먼저 읽을 파일: **`01_PASTE_TO_CODEX.md`** → **`contracts/00_MASTER_CONTRACT.md`** → `execution/00_PLAN_AND_GATES.md`

## 왜 다시 묶었나

기존 통합 계약 v0.2는 IA/VTON을 DB보다 앞세웠고, 수납 의류 21벌을 고정했다. 이후 실제 옷장 이미지 기반 35벌·외부 8벌·소품 8개, 실재 제품 기반 적재 RULE-01, 계절 경계 의류 유지 규칙이 제안/확정되었다. 서로 충돌하는 예전 계약들을 단순 합치지 않고, **확정 원칙/후보 가정/금지된 가정**으로 분해하여 새 기준을 만들었다.

## Codex에 보낼 자료

`SMART_WARDROBE_CODEX_HANDOFF_2026-10-11.zip`을 실제 저장소 루트의 `docs/handoff/` 아래에 풀어 `docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/`로 둔다. 또는 압축 해제 폴더 자체를 저장소에 놓아도 되지만, 지시문의 상대 경로를 실제 위치로 바꾼다.

Windows PowerShell (프로젝트 루트를 확인한 뒤 실행):

```powershell
$repo = 'C:\Users\aicam\Desktop\2차프로젝트'
$zip = 'C:\Users\aicam\Downloads\SMART_WARDROBE_CODEX_HANDOFF_2026-10-11.zip' # 실제 다운로드 위치로 수정
New-Item -ItemType Directory -Force -Path (Join-Path $repo 'docs\handoff') | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $repo 'docs\handoff') -Force
```

**중요:** 상위 프로젝트의 `docs/contracts/`, `docs/04_FSD.md`, 실제 DB/API/소스코드는 **이 패키지에 없다.** Codex가 반드시 저장소에서 조회해 대조해야 한다. 압축 파일을 풀기만 해서는 구현되지 않는다.

## 문서 역할

| 경로 | 역할 |
|---|---|
| `01_PASTE_TO_CODEX.md` | 첫 실행 프롬프트. 복사해서 Codex에 붙여넣기 |
| `contracts/00_MASTER_CONTRACT.md` | **유일한 신규 계약 기준점**, 상태·우선순위·범위 |
| `contracts/01_DATA_AND_PRODUCT.md` | RULE-01, 논리 DB, 시드·증거·적재 규칙 |
| `contracts/02_ASSETS_WARDROBE.md` | 옷장 구획, 원본·파생 이미지, 디지털 트윈·LED |
| `contracts/03_EXPERIENCE_VTON_CARD.md` | IA, VTON, 카드 템플릿·이벤트 분리 |
| `contracts/04_STORAGE_AGENT.md` | 계절 판단과 외부 보관 이동 상태 머신 |
| `execution/00_PLAN_AND_GATES.md` | 의존성·마일스톤·승인 게이트 |
| `execution/01_DISCOVERY_AND_REPORT.md` | 무인 첫 실행(감사·조사·설계) 산출물 규격 |
| `execution/02_AFTER_APPROVAL.md` | 승인 이후 단계별 구현 지시문과 회귀 원칙 |
| `execution/03_QA_MATRIX.md` | 시나리오 QA와 종료 조건 |
| `templates/*.csv` | 후보/승인/에셋/위치/결정 검토표, 헤더만 존재 |
| `references/card/` | 사용자가 제공한 실제 카드 원본 4장 및 원본 계약 |
| `references/wardrobe/` | 사용자가 제공한 실제 옷장 화면(옷과 UI 포함) |
| `references/history/` | **이전 문서 보관만, 실행 우선순위 없음** |
| `reports/` | Codex가 작성할 실제 갭·후보·계획·QA 기록 위치 |

## 단 한 번의 첫 실행

1. 패키지 폴더를 저장소에 배치한다.
2. Codex에 `01_PASTE_TO_CODEX.md` 전문을 붙여넣는다.
3. Codex가 P0 감사 → P1 의류/제품 후보 조사 → P2 이미지/DB 적재 설계안까지 **읽기 중심 작업을 연속 진행**하게 한다.
4. 사용자는 귀가 후 `reports/`와 `templates/`를 검토해 승인/보완한다. **승인 전 운영 DB 쓰기, 코드 대량 수정, 원격 push, 고비용 API 호출 금지.**

## 착각 금지

- 숫자 `21`은 **폐기된 초기 수납 가정**. `35 + 8 + 8 = 51`은 **아직 미승인 데이터셋 제안**.
- 4인 가족(엄마/아빠/아들/딸)은 **권장 시연 데이터 모델**, 최종 인원 수 승인 전. 화면 배우는 **엄마·아들**로 확정.
- 제품·품번·색상·소재와 이미지는 아직 리서치/실증 전. 카드 PNG/Decart API/LED 실제 실행이 이미 완료되었다고 주장하지 않는다.
- 기존 `SW_CHG00_REAL_PRODUCT_SEED_CONTRACT_v0.3.md`는 파일이 빈 상태여서 패키지에서 제외했다. 원문 DOCX는 history에 보관했고 새 계약에서 내용을 재편했다.
