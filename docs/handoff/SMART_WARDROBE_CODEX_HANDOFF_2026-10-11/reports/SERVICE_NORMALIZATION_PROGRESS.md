# 서비스 정상화 체크포인트

2026-10-12. 전체 상태 **PARTIAL — 데이터 회수 검증 완료, 독립 컨테이너 실행 대상 미확보**. 기존 장애 VM/볼륨/최초 보존본 변경 없음. 실제 앱 연결은 변경하지 않았다. 다음 세션은 이 파일에서 이어간다.

## A: 실제 회수 검증

관리자 설치·Docker·WSL 없이 EDB PostgreSQL16.8 Windows portable 바이너리와 공식 MinIO Windows 바이너리를 사용했다. PostgreSQL 공식 download/windows의 EDB zip 안내를 확인했고308,649,664B archive의SHA256은 `46903bb56bb0a40a81768703fa7420f0690095685da040bed2c584b900a1124c`. 독립 게시 checksum 검증이라고 주장하지 않는다. MinIO는 공식GitHub2025-04-22release에서 다운로드했으며 official SHA256+Minisign 검증PASS. 도구출처·서명은 ignored `test-results/recovery-tools/`에 기록했다. 두 legacy 버전을 운영 보안 적합으로 판정하지 않는다.

최초 보존본은 `test-results/recovery-candidates/20261012T101130Z/`. 작업본은 `C:/Users/aicam/AppData/Local/SmartWardrobeRecovery/20261012-native-v1/`이며 ACL은 현재 사용자/SYSTEM으로 제한했다. Windows PostgreSQL의 한글 HBA 경로 열기 실패를 확인해 새 ASCII 작업 경로를 사용했다. 실패한 초기 작업본도 별도 보존했고 최초 보존본은 수정하지 않았다. stale postmaster.pid/opts 이동·Windows config·WAL복구는 작업본에서만 수행했다.

검증 서버는 PG57444, MinIO19110/19111 loopback에서 잠시 실행하고 종료했다. PostgreSQL shared_buffers8MB/접속5개, MinIO GOMEMLIMIT192MiB/GOMAXPROCS1. Windows 가용256MiB 미만이면 기동을 차단했다. 메모리 차단은 서비스 검증 실패/성공으로 바꾸지 않는다. 별도 Windows 프로세스이므로 기존 장애 WSL/Engine을 사용하지 않았다. 같은 호스트 메모리는 공유하므로 무영향 가상머신 격리와 동일시하지 않는다.

|검증|실제 결과|증거 `test-results/recovery-phase1/`|
|---|---|---|
|보존본 SHA256 전/후|1,520파일 모두 일치, 차이0|preserved-before.json / preserved-after.json|
|PG 제어파일|PG16, in production, 정상 종료 백업은 아님|pg-control-readonly.txt|
|WAL복구·SQL조회|PASS|native-pg-startup-ascii.log / native-pg-records.json|
|DB 회수|wardrobe revision0004, 의류9·사용자2·에셋7·코디16·카드1·Job1·감사119|native-pg-records.json|
|FK 실제 고아 조회|원본84개 FK 모두 고아0, 미검증constraint0|native-pg-records.json|
|MinIO 객체 전체GET|9객체·4,412,367B, 전체크기일치, 9이미지decode검증PASS|native-minio-objects.json|
|DB 에셋·객체|READY7개 모두 존재·SHA256일치|asset-object-comparison.json|
|회수 의류 이미지|9벌 중6벌 연결,3벌 image_asset_idNULL|garment-image-coverage.json|
|pg_dump -Fc·archive list·실제별도DB복원|PASS, 원본/복원본 모든테이블 row hash 일치|native-backup-restore.json / recovered-archive-list.txt / native-pg-records.json|
|0006호환성|새 DB wardrobe_demo_recovered에0005/0006적용PASS, 기존40테이블전체행해시변경0, FK고아0|native-migration-preservation.json|

회수카드·Job·감사·의류9벌은 기존 기록으로 보존한다. 실제 착용0·케어0·VTON0. 과거dump3개는공식pg_restore16--list통과; cloud archive1.16은16tool의unsupported version으로미완료이며파일손상판정아님.

## 시연 기준 대비 부족분

승인 인벤토리104 = 원래52+승인24+선반신규28. baseline-fingerprints의원래76ID집합과일치하며선반66/행거21을포함한다. `scripts/recovery_approved_inventory.py` 출력은 ignored `test-results/reconstruction-plans/approved104-v1.json`.

- 회수9벌과승인104ID의교집합0: 시연104벌전체미회수. 기존9벌을대체/재할당하지않는다.
- 회수사용자2명은승인시연mom/sonID와불일치: 승인시연프로필2개별도재구성필요.
- 회수wear0: 승인합성wear각54건/총108건 및Context연결부족.
- 회수0004에는Scene/LIKED테이블없음. 작업target0006에새테이블을만들었지만데이터는빈상태: Scene66/사용자별LIKED3건부족.
- 승인시연household104벌과회수household9벌을모두보존하면전체113벌. 전체DB수량을104로맞추기위해회수9벌삭제금지.
- C단계최신Snapshot/Job/FitRoom감사·소진상태는회수하지못했다. 신규시드로실제이력이나권한을임의복제하지않는다.

## B: 구현 완료 및 실제 미검증

새 `infra/compose.demo-recovery.yaml`: 별도project/port 및 PostgreSQL·MinIO·Redis named volumes, RedisAOF, tmpfs없음. API/worker/init/seed/migration자동실행없음. 기존infraCompose/legacy검증환경변경없음.

`recovery_compose_plan.py`는독립성이확인된SSH Engine명령만출력한다. 실행은하지않는다. `recovery_gap_plan.py`는실제target감사·revision/household/무과금/FK조건이충족돼야계획을생성하며DB쓰기없음. 현재stageB핵심4datasets계획이며base76등록은별도인벤토리·연결게이트가필요하다. `stage_b_seed.py`를새target에그대로실행하면안된다(기존엔진주소/0004·0005가드).

- 정적contract테스트10PASS, RuffPASS. Windows 기본pytest tmp경로권한오류는새ignored basetemp에서해결했고시스템권한을바꾸지않았다.
- 독립Engine실기동,104벌등록,시드멱등성,API/브라우저E2E,컨테이너재생성후유지,신규시연환경전체백업/복원은미완료.
- native복구DB의dump/복원PASS를새시연환경전체백업PASS로대체하지않는다.

## 이어서 실행할 순서와 게이트

1. 별도Linux Docker Engine SSH주소와접근권한확보. 현재Hyper-V VM조회는권한거부이고로컬메모리는낮다. 기존Engine을대신사용하지않음. 사용자에게SSH주소를비동기로요청했다(비밀번호/개인키본문요청없음).
2. 신규독립영속환경구축. 회수logicaldump/객체와원본보존본을구분해전송경로·접근권한확인. 서비스전환은별도승인.
3. 회수9벌·기존사용자/코디/카드/감사우선복원하고해시/FK/객체재검증. 추가마이그레이션은신규target에서만.
4. 승인104인벤토리기준household/member/device/location→원본/파생asset→의류→Scene→LIKED→합성wear/Context 순서로누락분전용runner구현·적재. manifest정확한ID를임의API생성ID로대체하지않음. 재실행중복0·회수실제기록해시불변검증.
5. 신규환경에서두프로필·Scene66+21·전체이미지·찾기/VTONMock/코디카드등기존핵심API/브라우저회귀실행. FitRoomlivefalse.
6. 신규컨테이너만재생성하고named volume데이터해시유지검증. 백업생성후또다른복원대상에서실제복원시험.
7. 구체적인로컬앱접속변경안을사용자에게제시하고승인받은후연결전환. 원격push/배포별도승인.

현재localhost5195/18082의앱연결은기존장애환경그대로다. 새시연환경완료/서비스정상화로보고하지않는다.

## 재현·파일

```powershell
.venv/Scripts/python.exe -m pytest backend/tests/contract/test_demo_recovery_storage.py -q --basetemp=test-results/rebuild-next-verify -p no:cacheprovider
.venv/Scripts/ruff.exe check scripts/recovery*.py backend/tests/contract/test_demo_recovery_storage.py
```

native검증재실행은고정된작업본과도구가존재할때 `scripts/recovery_validate.py postgres|minio`로가능하나메모리게이트를유지한다. `--backup-restore-drill`/`--upgrade-working-target`은이미생성한대상덮어쓰기를거부하므로무작정재실행하지않는다.

제품코드·B01에셋·geometry·실제유료API변경없음. 기존VM/원본/보존본·실서비스연결변경없음. 원시자료와secret포함가능한dump는Git제외하고외부업로드하지않았다.
