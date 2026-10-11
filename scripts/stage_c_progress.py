"""Durable C-only checkpoint; never loads or mutates a database."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11"


def main():
    for relative in [
        "execution/STAGE_C_VTON_EXECUTION_DRAFT.md",
        "reports/STAGE_C_IMPLEMENTATION_PLAN.md",
    ]:
        path = PACKAGE / relative
        value = path.read_text(encoding="utf-8")
        if "## 2026-10-12 실행 승인" not in value:
            value += """

## 2026-10-12 실행 승인

사용자는 C1~C6 구현을 승인했다. 본문의 초안·승인 대기 표현은 작성 당시 상태이며,
이번 승인에 따라 C단계만 실행한다. A1, B-01 승인 화면, B-02 DEFERRED를 유지한다.

- C Mock PASS는 실제 VTON 시착 품질 PASS가 아니다.
- 최종 PoC의 실제 시착 시연은 별도 공급자 연동 및 품질 검증 게이트다.
- Mock 이미지는 실제 시착 이미지로 표현하지 않는다.
- 완료 보고에는 실제 시착 시연의 남은 의존성과 검증 항목을 별도 인계한다.
- 각 C1~C6 독립 테스트 통과 후 다음 단계로 진행하며 실패·미실행은 PASS 처리하지 않는다.
- D~G, 유료 호출, 실물 LED, 운영 DB, 원격 push·배포는 승인 범위 밖이다.
"""
            path.write_text(value, encoding="utf-8")
    path = PACKAGE / "reports/STAGE_C_CHECKPOINT.md"
    if not path.exists():
        path.write_text(
            """# C단계 실행 체크포인트

기준 커밋 a1e439b. 이해한 범위: 기존 UI와 보유 데이터는 보존하고, 보유/관심 혼합
Mock 요청을 불변 Snapshot에 연결한다. 실제 시착 품질 및 D/F 후속 실행은 별도 게이트다.

## 단계별 기록
""",
            encoding="utf-8",
        )
    with path.open("a", encoding="utf-8") as output:
        output.write("\n- " + " ".join(sys.argv[1:]) + "\n")


if __name__ == "__main__":
    main()
