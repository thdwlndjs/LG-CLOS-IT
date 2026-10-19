# 팀 공유 패키지 실제 검수 결과

검수 기준: 원본 소스와 분리한 후보 ZIP을 생성하고 **새 빈 폴더에 압축 해제**한 프로젝트에서 실행했습니다. 이 결과는 원본 폴더에서만 검사한 결과가 아닙니다. 앱/이미지/JSON/잠금파일/실행기는 ZIP의 파일만 사용했으며 검수 도구도 이전 프로젝트의 node_modules와 분리해 설치했습니다.

## 환경과 명령

- Windows, Node.js24.18.0, 실제 Chrome, Playwright1.55.1. 실행 의존성0개.
- `npm ci --ignore-scripts --offline` PASS, `npm run check` PASS, `npm test` **49/49 PASS**.
- `node tests/browser-check.mjs`: 실제 브라우저 **15/15 PASS**, 페이지 JS 오류0. 새 격리 브라우저의 native localStorage 사용. 메모리 storage 대체가 아닙니다.
- 검수 주소127.0.0.1:4393. 배포·원격 쓰기·유료 API0회, 외부 요청 차단.
- `START_WINDOWS.cmd`를 복원본에서 실제 실행해 인덱스·모든32개 의류 이미지의 HTTP 내용/hash를 확인했습니다. 포트 override도 표시 주소와 일치했습니다.
- 두 번째 실행기로 포트 충돌을 재현했습니다. 오류 문구가 보이고 `pause`에서 기다리며, 확인 키 입력 후 실패 코드1로 종료했습니다. 정상 시연 프로세스는 이 검사에서 만든 프로세스만 정리했습니다.

## 요청한 10개 확인

| 항목 | 결과 |
|---|---|
| 수진/휘재별 의류 조회 | 두 프로필 실조작, 각자 후보·초안·저장 카드 분리 PASS |
| 선택한 옷의 이미지 배치 | 휘재4품목/수진5품목 선택, 같은 asset ID·사진으로 구성 PASS |
| 상의만 교체 | 하의·신발·가방 객체 그대로 유지 PASS |
| 크기·간격·겹침 | 실제1440×1080 화면 및 PNG 관찰. 대표 조합 의류 누락/가림 없이 시안의 비대칭 구성 유지. 모든 가능 실제 의류 형태나 실물 미러는 미검수 |
| 저장 후 동일 조합 재조회 | 품목·자산 버전 포함 compositionKey 동일 PASS |
| 원본 보존 후 수정 | 새 초안/새 카드, 변경 없는 중복 저장 방지 PASS |
| 새로고침 저장 | 프로필 왕복·페이지 새로고침·브라우저/서버 재시작 후 동일 데이터 PASS |
| 외부 후보 구분 | external 유지, 실제 소유·LED·착용으로 전환 없음 PASS |
| PNG 출력 | 실제 다운로드한1080×1350 PNG를 열어 수진5품목과 동일 사진 확인, 투명 영역 유지 PASS |
| API 상태 | 실제 공급자 미연결·호출0. mock 결과로 실연동을 대체하지 않음 |

브라우저15개에는 **의도적으로 HTTP404를 주입한 사진 오류 검사1개**가 포함됩니다. 실제 원본 사진 손상 주장이 아닙니다. 단위49개에는 메모리/Canvas fixture를 쓰는 계약 검사가 있으므로 공급자 실행 성공으로 해석하지 않습니다. 실제 저장 검수는 별도 Chrome 원본 저장소로 수행했습니다.

## 화면·녹화

- [휘재 선택](evidence/browser/01-hwijae-four-items.png), [상의 교체](evidence/browser/02-top-only-replacement.png)
- [수진+외부 후보](evidence/browser/03-sujin-external-mix.png), [저장 카드](evidence/browser/04-saved-cards.png)
- [좁은 화면](evidence/browser/05-narrow.png), [재시작 복원](evidence/browser/06-restart-preserved.png)
- [실제 출력 PNG](evidence/browser/export-transparent.png)
- [선택·저장·재사용 녹화](evidence/browser/scenario-selection-save-reuse.webm), [재시작·오류·탭 충돌 녹화](evidence/browser/scenario-restart-and-error.webm)
- 원시 검사 결과: `evidence/browser/results.json`, `evidence/unit-results.txt`, `evidence/launcher-results.json`.

## 포장과 보안

소스 기준 커밋 `902e47c9fd2cf54dea754d44667388457af90d7f` (`feature/flatlay-card-module`). 기능 기준은 `c63689e`, `b27ac43`, 기존 검수 기록은 `59fcb9c`입니다. 시작 시 미커밋 변경 없음. 이번 커밋은 인계 문서/설정 예시/실행기/검수 경로 이식성만 수정했고 카드 기능·UI·자산은 바꾸지 않았습니다.

ZIP에는 API 키/토큰/실제.env/브라우저 세션/개인 저장소/비공개DB/.git/node_modules/캐시/이전ZIP을 넣지 않았습니다. 가상 시연 이미지32개는 제공 자료의 파생 hash와 일치합니다. 전체 파일 목록·무결성은 `MANIFEST.sha256`, 소스별 hash/버전은 `PACKAGE_INFO.json`에 있습니다.

이 패키지로 가능한 것은 독립 로컬 체험입니다. 팀 웹 소스·ID/저장 계약 매핑, 원격 DB/인증 통합, 홈/캘린더/LED 연결, OpenAI/Decart 실제 호출은 미완료입니다. 통합 조건은 `INTEGRATION_GUIDE.md`에 명시했습니다. 원격push·merge·운영배포는 하지 않았습니다.
