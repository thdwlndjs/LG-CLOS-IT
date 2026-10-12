# 로컬 시연 프로필 표시 장애 진단

조사일: 2026-10-12. 기준 HEAD: `19549d8`. 제품 코드·DB·서비스 설정 변경 없음.

## 결론

시연 프로필이 화면에서 사라져 보이는 직접 원인은 프로필 목록 요청의 실패와 프론트의 오류 은폐다. 프로필 데이터 삭제는 입증되지 않았다. 앞선 설명에서 이를 DB 문제로만 설명한 것은 정확하지 않았다.

## 실제 재현 및 근거

- Playwright 실제 Chromium에서 `http://127.0.0.1:5195`를 열고 마이 버튼 클릭.
- 브라우저의 `GET /api/v1/integration/demo-profiles` 요청이 HTTP 503으로 실패함을 확인.
- 프론트 프록시 5195 및 API 18082·18081에 직접 GET을 보내 같은 응답을 확인:

```json
{"error":{"code":"DEPENDENCY_UNAVAILABLE","message":"Request limiter unavailable"}}
```

- 최초 홈 화면은 `로그인 필요`이며, Scene이 준비되지 않은 상태로 표시된다. 초기 화면만 정상 응답한다고 앱 정상 기동으로 판정할 수 없다.

## 실패 경로

1. `MirrorProfiles.tsx`의 effect가 `HttpRemoteBackend.demoProfiles()` 호출.
2. `backendClient.ts`가 `/integration/demo-profiles` GET 실행.
3. `backend/app/core/rate_limit.py`의 `rate_guard()`가 Redis `eval()` 실행.
4. Redis 오류를 `503 DEPENDENCY_UNAVAILABLE / Request limiter unavailable`로 변환. 이번 응답은 프로필 DB 조회 결과가 아니라 요청 제한기 실패다.
5. `MirrorProfiles.tsx`의 catch가 `setDemoProfiles([])` 실행. 조회 오류를 화면에 알리지 않아 두 시연 프로필이 없는 것처럼 보인다.

프로필 API 자체는 `member`, 활성 `account_credential`, `device_member`를 조회한다. 그러나 현재 요청은 그 조회에 도달하기 전에 차단된다. 따라서 현재 DB에 해당 행이 존재하는지 이 요청으로 판정할 수 없다.

## 장애 구분

| 항목 | 확인 상태 | 판정 범위 |
|---|---|---|
| 프로필 목록 API | 실제 브라우저·직접 요청 모두 503 | Redis 요청 제한기 실패 확인 |
| 프로필 오류 표시 | catch에서 빈 목록 처리 | 프론트 오류 상태 처리 결함 확인 |
| 프로필 DB 삭제 | DB 연결 불가 | 미확정 |
| API live | 200 | 프로세스 생존만 확인 |
| API readiness | 시간 초과 | 전체 의존성 정상 아님 |
| MinIO health | 시간 초과 | 이미지 저장소 응답 장애 확인 |
| Docker Engine | 요청 시간 초과 | 컨테이너 실시간 상태 확인 불가 |
| PostgreSQL·MinIO tmpfs | 저장된 실제 컨테이너 설정 확인 | 재시작 시 데이터 보존 위험 있음 |

Redis 장애와 DB·MinIO 장애는 별도 의존성 장애다. 공통 Docker 장애와의 인과관계 및 tmpfs 데이터 소실은 확정하지 않는다. 프로필 API 실패로 로그인 진입이 막히면 후속 의류·Scene 조회도 정상 검증할 수 없다. 모든 의류 누락을 이 문제 하나로 설명하지 않는다.

## 최소 후속 조치 제안

1. 기존 Redis·PostgreSQL·MinIO의 생존과 접근을 비파괴적으로 확인. 비파괴적 확인은 기존 포트·소켓에 대한 연결 및 상태 조회만 의미하며 프로세스 종료·재시작·재생성은 포함하지 않는다. 재시작·재생성은 현재 금지 유지.
2. Redis 접근 복구 후 프로필 API 재검증. 그때 DB 조회 실패·빈 결과를 구분하고 두 사용자 관계를 확인.
3. 승인 후 프론트에서 로딩·조회 실패·실제 빈 목록을 구분하고 오류와 재시도 동작 표시. DB 근거 없이 프로필을 임의로 생성하거나 성공으로 대체하지 않음.
4. 두 프로필 로그인, 오른쪽 선반 66벌·왼쪽 행거 21벌의 Scene 표시, 이미지 다운로드를 각각 검증. `/health/live`의 200은 API 프로세스 응답이며 DB·Redis·MinIO 정상 여부를 보장하지 않는다.

완료 기준: 프로필 API 200 및 두 사용자 반환, 프로필 표시·로그인 성공, 실패 시 명확한 오류 안내. 옷장 완료는 별도로 Scene·객체 로딩·실제 배치를 검증해야 한다.

## 작업 제한 및 기록

실제 로그인 POST·FitRoom 호출·DB 변경·백업·복원·재시드·Docker 재시작·Git 롤백·원격 push 없음. 이 보고서만 신규 작성했다. `19549d8` 유지 지시 때문에 문서를 커밋하지 않았으며, 로컬 변경으로 남긴다.
