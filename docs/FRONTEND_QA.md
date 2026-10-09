# 프론트엔드 직접 QA

브라우저에서 **http://127.0.0.1:5173** 을 연다. `나의 옷장`을 선택하면 기존 로컬 데모 회원으로 접속한다. 가족 프로필은 별도 사용자이며 공유하지 않은 옷이 보이지 않는 것이 정상이다. JWT는 메모리에만 있어 브라우저 새로고침 후 프로필을 다시 선택한다.

## 시작과 재현

프로젝트 루트에서 기존 Compose 서비스가 실행 중인지 확인한다. 프론트 서버는 loopback에만 연결하며 포트 5173을 사용한다. 원래 MinIO의 개발용 제한을 그대로 유지한다.

```powershell
docker compose --env-file .env -f infra/compose.yaml up -d
npm --prefix web ci
npm --prefix web run build
powershell -NoProfile -File scripts/start_frontend.ps1
```

직접 터미널에서 실행하려면 `npm --prefix web run preview`를 사용하고 Ctrl+C로 종료한다. 숨겨진 서버는 `powershell -NoProfile -File scripts/stop_frontend.ps1`로 종료한다. 이 명령은 기록된 PID가 이 작업공간의 Vite인지 확인하고 종료하며 backend는 유지한다. PID는 프로젝트 루트의 `test-results/frontend-server.pid`, 실행 로그는 `test-results/frontend-server.log`에 기록한다. 다른 프로그램이 5173을 사용하면 임의로 종료하지 않는다. 개발 중 변경 즉시 반영은 `npm --prefix web run dev`로 제공하며, QA 인수 대상은 빌드 미리보기다.

QA의 등록·수정·삭제·동의·착용 확인은 **로컬 개발 DB에 실제 반영**된다. 자동 브라우저 검증은 전용 UUID DB와 별도 API/worker를 생성하고 정리하므로 사용자 QA 데이터와 구분된다. 자동 검증 재현은 실행 중인 postgres-test와 Docker CLI, `.venv` 의존성, Node/npm 및 Chromium 설치가 필요하다.

```powershell
docker compose --env-file .env -f infra/compose.yaml -f test-results/compose.verify.yaml --profile test up -d postgres-test
npm exec --prefix web -- playwright install chromium
.venv/Scripts/python.exe scripts/verify_frontend.py
```

Windows 55432 포트 제한의 `test-results/compose.verify.yaml`은 이 작업공간의 기존 검증 파일이다. 이 파일이 없는 다른 환경에서는 README의 테스트 DB 절차를 따른다. `verify_frontend.py`는 샘플 PNG를 자동 생성하고 127.0.0.1:5174에서 검증용 빌드 미리보기를 실행한다. 실제 backend/worker 이미지는 먼저 기존 절차대로 빌드되어 있어야 한다.

## 확인 순서

1. **프로필·홈:** 오늘의 코디 추천을 실행한다. 추천 이유와 Context의 Mock/부분 상태를 확인한다. 새로고침만으로 추천이나 착용이 생성되지 않아야 한다.
2. **옷장:** 종류·색상·계절·상태 필터와 등록·수정·삭제를 확인한다. 위치 미확인과 최근 관측을 구분한다. `현재 위치 Mock 관측`은 실제 센서 인식이 아니다.
3. **사진:** 마이에서 업로드 동의를 저장한다. 옷 상세의 정보 수정에서 의류 사진을 넣는다. 입어보기에는 선택한 모든 의류 사진과 별도 인물 사진이 필요하다. PNG/JPEG/WebP, 10MB 이하, 각 변 4096px 이하의 단일 이미지를 사용한다. 동의 철회는 기존 사진·공유 접근을 철회하므로 기존 자료 보존이 필요하면 별도 확인 후 실행한다.
4. **코디·스타일:** 슬롯별 옷을 골라 코디를 저장한다. 참고 스타일은 인스타·쇼핑몰·기타 출처별로 확인하며 링크의 이미지를 자동 수집하지 않는다. 코디의 `보관` → `보관 확인`을 누르면 보관됨(ARCHIVED) 상태가 된다. 상태 필터를 보관됨으로 바꾸고 입어보기 버튼이 비활성화되는지 확인한다. 보관 복원은 기존 API 정책상 제공하지 않는다.
5. **입어보기:** 세션 시작 → 인물 업로드 → Mock 실행 → 작업 상태/결과 → 의류 교체 및 구성 반영 → 최종 선택을 확인한다. Mock 결과는 실제 합성 사진이 아니다. 최종 선택만으로 착용 이력이 생성되어서는 안 된다.
6. **카드:** 최종 선택 또는 내 코디에서 초안을 만들고 카드 이미지를 생성한다. 비공개 저장·코디 연결·재사용, 명시적 24시간 공유와 비공개 전환 시 공유 폐기를 확인한다.
7. **캘린더:** 월·날짜·이력 종류로 확인한다. 코디 선택과 실제 착용을 구분한다. 실제로 입은 경우만 착용 확인하고, 잘못된 기록은 사유를 적어 취소한다.
8. **케어:** 가이드·사용자 관리 프로필, 반복 일정·수정·취소·수행·미수행·완료 취소를 확인한다. 수행 시각을 비우면 확인 시각을 사용한다.
9. **보관:** 기본 미리보기 분석과 제안 저장을 구분한다. 분석의 보류 사유를 확인한다. 승인만으로 위치가 변경되지 않아야 하며, 실제 이동을 완료한 항목만 확인한다. 공간·환경 분석에 측정값이 없으면 실행 불가가 정상이다.
10. **모바일·오류:** 좁은 창의 하단 메뉴, 키보드 Tab/Escape, 로딩·빈 상태·권한 오류를 확인한다. 충돌 시 서버 version을 우회하지 말고 최신 정보를 확인한다.

## QA 후 진행

이 문서는 현재 구성된 작업공간에서의 QA 인계다. `.env`·`.venv`·migration/Seed·backend/worker 이미지가 이미 준비되어 있다. 새 환경의 최초 설치는 [README](../README.md)의 bootstrap·migration·Seed 절차를 먼저 따른다. QA에서 기존 DB를 초기화하거나 Seed를 재실행할 필요는 없다.

결과는 `화면 / 동작 / 기대 결과 / 실제 결과 / 통과·실패 / 재현 조건` 형식으로 기록한다. 위 1~10 흐름에서 진행을 막는 결함이 없고, Mock·실제 착용·공유·실제 이동의 구분을 확인한 뒤 사용자가 직접 QA 완료를 승인하면 다음 단계로 넘어간다. 자동 테스트 통과만으로 사용자 승인을 대신하지 않는다.

화면, 수행한 동작, 기대 결과, 실제 결과를 알려주면 결함을 수정한다. 직접 QA 승인 전에는 미확정 외부 연동과 유료 API 테스트를 진행하지 않는다. 이후 선택 연동의 범위를 정하고 실제 Decart 어댑터를 구현한 뒤 마지막에 유료 실제 요청 검증을 진행한다.
