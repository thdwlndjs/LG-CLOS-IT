# 프로필 오류 처리 수정 및 Docker 장애 분리

2026-10-12. 시작 커밋 `19549d8`. 로컬 프론트 수정만 실행했다.

## 프론트

`web/src/mirror/source/MirrorProfiles.tsx`에 loading/success/empty/error 상태를 추가했다. API 실패 시 마지막 정상 프로필 목록을 보존하고 “프로필을 불러오지 못했습니다” 및 재시도 버튼을 표시한다. 정상 빈 응답만 empty로 판정한다. 요청 중 버튼을 비활성화하고 10초 UI 제한 시간을 적용한다. Promise race로 제한 시간 이후 응답을 무시하며 effect cleanup으로 이전 요청 및 언마운트 이후 조회 상태 갱신을 차단한다. 실제 네트워크 요청 취소 기능은 추가하지 않았다.

`web/test/profile-status.test.mjs`는 독립 임시 Vite와 실제 Chromium에서 API fixture를 사용한다. 실제 API 요청은 가로채며 로그인·DB 변경·공급자 호출은 없다. 503 오류, 재시도 성공, 실패 시 기존 두 프로필 보존, 정상 빈 목록, 로딩 버튼 비활성화, 타임아웃, 재시도 후 늦은 이전 응답 무시, 화면 이탈 후 응답을 검증했다.

- `npm test`: 49 PASS, 0 FAIL.
- `npm run build`: TypeScript 및 Vite PASS. 큰 번들 경고 존재.
- `git diff --check`: PASS.
- B-01 Scene·에셋·geometry·VTON·FitRoom 제품 코드 변경 없음.

Fixture PASS는 실제 두 사용자 로그인 및 옷장 데이터 복구 PASS가 아니다.

## Docker 읽기 전용 조사

Windows Docker backend 프로세스와 WSL docker-desktop은 생존/Running으로 표시되지만 Docker Engine version 요청은 시간 초과된다. Redis16379·PostgreSQL56433·MinIO19000은 모두 Docker backend PID2036에서 TCP 연결을 받아주지만 각각 PING·SSL 협상·Health 프로토콜 응답이 시간 초과된다.

Docker host monitor 로그에는 내부 `192.168.65.7:2376` 연결 취소 및 `/networks`, `/containers/json` timeout이 반복된다. 따라서 host backend→내부 Engine 통신 실패는 확인됐다. WSL dmesg에는 InteropServer Broken pipe, Interop fatal signal6 등이 있으나 Docker 장애와의 직접 인과관계는 미확정이다.

- Windows 물리 메모리: 총 약15.75GiB, 여유 약0.52GiB. 여유가 낮지만 원인으로 확정하지 않음.
- C 드라이브: 여유239,805,968,384바이트, 약223GiB. 호스트 디스크 부족 근거 없음. Docker 가상 디스크 내부 여유는 별도 미확인.
- WSL 메모리: MemAvailable7,308,760kB, 약6.97GiB. load average1.00. 프로세스 정체 원인은 미확정.
- 확인한 커널 로그에서 OOM/no-space 기록 없음. 전체 과거 로그의 부재를 보장하지 않음.

기존 PostgreSQL·MinIO는 실제 저장된 컨테이너 설정상 tmpfs이고 영속 마운트가 없다. 실제 프로세스 생존·tmpfs 내용은 미확인이다. Redis는 익명 영속 볼륨의 dump.rdb4,247바이트와 12:15KST 저장 성공 기록을 확인했으나 최신 메모리 상태는 미확인이다.

## 다음 게이트

재시작 없이 살아 있는 Engine/컨테이너 접근을 확보할 수 있는 경로가 아직 확인되지 않았다. limiter 비활성화 및 별도 Redis 대체는 세션 폐기·큐 상태를 바꿀 수 있어 실행하지 않았다. Docker/WSL/backend 재시작은 tmpfs 소실 위험이 있으므로 사용자 승인 및 보존 방안 확정 전 실행하지 않는다. 기존 접근이 회복되면 먼저 DB·객체 백업 절차를 승인받는다.

후속 실제 검증은 Redis PING→limiter 유지 상태의 프로필 API→두 사용자 DB 관계/revision0006 확인→로그인→Scene 오른쪽66·왼쪽21→87개 이미지·클릭 영역·승인 캡처 비교 순서다. 현재 이 E2E는 의존성 장애로 미완료다.

Docker·컨테이너 재시작/재생성, 데이터 변경·재시드·마이그레이션, Git reset/revert, FitRoom 호출, 원격 push·배포 없음.
