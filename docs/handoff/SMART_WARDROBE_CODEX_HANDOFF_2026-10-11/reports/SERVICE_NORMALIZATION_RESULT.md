# 시연 환경 정상화 결과 — 2026-10-12

## 완료 판정

승인된 서비스 정상화 범위는 PASS이다. 전체 PoC의 D~G 단계 또는 실제 시착 품질 완료를 뜻하지 않는다. 현재 접속 주소는 **http://127.0.0.1:5196/** 이며 API는 18083이다. 이전 5195/18082 실행 환경은 전환하지 않았다.

| 검증 항목 | 결과 | 직접 증적 |
|---|---|---|
| PostgreSQL 16 실제 PGDATA named volume | PASS — `/var/lib/postgresql/data`, tmpfs 없음 | actual-storage-mounts.json / full-recreate.log |
| MinIO `/data` named volume | PASS — 신규 볼륨, localhost만 공개 | actual-storage-mounts.json |
| Redis 원본 보존 및 새 named volume 사용 | PASS — `wardrobe-recovery-demo_redis-restored-v3` | redis-copy-verification.json |
| Redis RDB 호환성 | PASS — 7.4.2 RDB, 25키 로딩·38키 정상 만료, AOF 전환 후 PONG | redis-copy-verification.json |
| 회수 데이터 보존 | PASS — 기존 9벌 및 회수 이력 행 해시 포함 비교 | final-db-validation.json |
| 승인 시연 데이터 | PASS — 기존 76+신규 28=104벌, 승인 UUID·소유자 보존 | final-db-validation.json |
| 생활 데이터 | PASS — 김수진·최휘재 각각 합성 착용 54건/Context 연결, LIKED 각각 3건 | final-db-validation.json |
| 재적재 멱등성 | PASS — Stage B seed 두 차례 재실행, 13개 테이블 행 지문 일치 | idempotency.json |
| 이미지 | PASS — READY 162개 GET·SHA256·크기·decode, 누락 참조 0 | image-validation.json |
| 실제 Scene | PASS — 오른쪽 11칸×6=66벌, 왼쪽 21벌, ID·geometry·에셋 대조 | browser/results.json |
| 화면 | PASS — 두 프로필, 6개 메뉴, 모바일 숨김/클릭 차단 및 데스크톱 복원 | browser/results.json / 프로필별 PNG |
| C단계 Mock VTON | PASS — 보유/LIKED/혼합, 생성 중 변경, Snapshot·이탈·프로필 전환 | browser-c/browser-results.json |
| 신규 컨테이너 재생성 | PASS — DB 44개 테이블 및 전체 객체 284개 해시 일치, Redis PONG | full-persistence.json |
| 백업·실제 복원 | PASS — 별도 DB/버킷의 44개 테이블·객체 284개 해시 일치, 격리 Redis RDB 로딩 | 아래 백업 폴더 restore-drill.json |
| 최초 보존본 | PASS — 1,520개 파일 SHA256 재확인 일치 | 아래 백업 폴더 manifest.json |

표의 상대 증적 경로는 `test-results/recovery-normalization/` 기준이다. 개인정보가 포함된 증적·백업은 ignored 폴더에만 두고 외부 전송하지 않았다.

전체 DB 의류는 **113벌**이다. 승인 시연 household 104벌과 회수 household 9벌은 ID가 겹치지 않으며 회수 9벌을 삭제하지 않았다. 합성 생활 데이터는 실제 사용자 이력 복구로 주장하지 않는다.

## 백업 및 보존

- 새 백업: `test-results/rebuilt-backups/normalized-104-final/` — PostgreSQL archive 865,471 bytes, MinIO 284개/67,558,386 bytes, Redis RDB 1,958 bytes. 현재 사용자와 SYSTEM으로 접근 권한 제한.
- 최초 물리 보존본: `test-results/recovery-candidates/20261012T101130Z/` — 변경하지 않았다.
- 원본 PostgreSQL·MinIO 볼륨은 신규 서비스에 연결하지 않았다. Redis 원본 볼륨 `bf37edf0792e66b808e31f7c38640463b189b66717c2925f92ff01ff822db506`은 읽기 전용 복사에만 사용했다. 원본 RDB SHA256은 `ee0a1cfce9772004927ebd79c3e80c118d75f03d51216b26553392c90a314e37`이다.
- 복원 시험 DB·버킷 및 실패했던 시험 컨테이너/볼륨은 삭제하지 않고 남겼다. 실제 서비스와 구분된다.
- PostgreSQL·MinIO·Redis 간 백업은 원자적 단일 스냅샷이 아니다. 신규 API와 브라우저 쓰기를 중지한 상태에서 백업·복원 대조했다.

## 변경 및 재실행

`infra/compose.demo-recovery.yaml`은 새 저장소 3개와 localhost 3301 renderer를 구성한다. `recovery_api_local.py`는 고정된 신규 DB·Redis·MinIO를 사용하고 Mock/INLINE, FitRoom 비활성화 및 빈 외부 API 키를 강제한다. `recovery_local.ps1`은 이 환경만 다시 열며 시드·마이그레이션·Docker Desktop 재시작을 자동 실행하지 않는다. API는 protected runtime의 기존 자격증명을 읽는다.

```powershell
powershell -NoProfile -File scripts/recovery_local.ps1
.venv/Scripts/python.exe scripts/recovery_verify_demo.py --runtime test-results/recovery-normalization/runtime.json --output test-results/recovery-normalization/readback.json
node web/test/recovery-screens-browser.mjs
```

실제 백업·복원 명령과 대상은 각 도구의 명시적 승인 플래그로 한정된다.

```powershell
.venv/Scripts/python.exe scripts/recovery_backup.py --approved-new-target-backup --approved-new-redis-rdb --runtime test-results/recovery-normalization/runtime.json --pg-bin test-results/recovery-tools/postgres16/pgsql/bin --output test-results/rebuilt-backups/<새-폴더>
.venv/Scripts/python.exe scripts/recovery_restore_drill.py --approved-new-target-restore --approved-isolated-redis-load --runtime test-results/recovery-normalization/runtime.json --pg-bin test-results/recovery-tools/postgres16/pgsql/bin --backup test-results/rebuilt-backups/<백업-폴더>
```

최종 시험: 저장소·적재 보호 테스트 15 PASS, 관련 backend unit 33 PASS, 프론트 49 PASS, TypeScript/Vite build PASS, Ruff 및 diff whitespace 검사 PASS. 제품 프론트·B-01 에셋·geometry는 수정하지 않았다. 브라우저 테스트에 새 origin/증적 경로와 현재 UI에 맞는 동의 체크박스 선택만 추가했다.

## 실패 후 시정한 검증 도구

- Redis 첫 복사 시 셸 인용 오류, 두 번째 시험에서는 AOF 우선 기동으로 복사 RDB를 읽지 않았다. 두 실패 볼륨은 격리해 보존하고 원본에서 새 v3 볼륨으로 복사했다. v3는 RDB를 먼저 로딩한 후 AOF 전환했다.
- 화면 시험은 API geometry가 내부 metadata를 제외하는 계약을 무시해 처음 실패했다. 전체 내부 geometry는 DB 검사로, API 화면 좌표는 DTO의 x/y/width/height/z_index로 독립 검사하도록 수정했다.
- C 브라우저 시험의 기존 checkbox 선택은 신규 HD checkbox와 충돌했다. 인물 업로드 동의 checkbox를 이름으로 특정하고 실제 두 프로필 재실행 PASS를 확인했다.
- Redis 복원 시험의 공식 entrypoint가 읽기 전용 백업에 chown을 시도해 차단됐다. 실패를 보존하고 새 시험 컨테이너를 비루트 직접 redis-server entrypoint로 실행했다. DB·MinIO 복원 시험을 반복하지 않고 Redis만 재검증해 PASS를 확인했다.

## 남은 범위와 한계

- B-02 DEFERRED: 외부 보관 10벌의 내부 Scene 중복 및 위치 조회 단일화는 기존 승인에 따라 미수정이다.
- D~G 후속 제품 구현 및 실제 FitRoom 시착 품질 검증은 별도 승인 게이트이다. 이번 Mock PASS는 실제 시착 품질 PASS가 아니다. 실제 FitRoom 호출·실물 LED·원격 push·배포는 0회다.
- 복구 후보에 없던 최신 실제 Snapshot·Job·감사·동의·개별 사용자 수정은 복구했다고 주장하지 않는다. 승인 시연 데이터만 재구성했다.
- 기존 고정 MinIO 바이너리는 로컬 시연용이다. 운영 환경에 안전한 최신 버전이라는 판정을 하지 않았다. 영속 볼륨과 호스트 백업 모두 이 PC에 있으므로 호스트 자체 장애까지 대비한 외부 백업은 별도 과제이다.
