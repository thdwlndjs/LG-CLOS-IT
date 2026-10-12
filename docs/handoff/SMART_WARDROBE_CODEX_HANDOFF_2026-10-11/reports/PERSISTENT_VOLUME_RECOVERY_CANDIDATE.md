# 영속 볼륨 복구 후보 확보

2026-10-12. 사용자의 일관성 미보장 `debugfs rdump` 승인에 따라 실행했다. **일관성 미보장 복구 후보**이며 운영 가능한 DB 백업이나 논리적 정합성 PASS가 아니다.

## 보존 경로

원본 장치 `/dev/sdd`는 장치8:48, 기존 ext4 마운트와 일치했다. 원본 경로:

- PostgreSQL: `/data/docker/volumes/smart-wardrobe_postgres-data/_data`
- MinIO: `/data/docker/volumes/smart-wardrobe_minio-data/_data`

Windows 복사본 루트: `test-results/recovery-candidates/20261012T101130Z/`.
각 데이터는 `postgres/_data/`, `minio/_data/`에 있다. 현재 Windows 사용자와 SYSTEM만 상속 가능한 full control을 부여하고 상위 권한 상속을 제거했다. 폴더와 표본 하위 경로 ACL 조회를 기록했다. 원시 데이터·자격증명 가능 파일은 Git 무시 폴더에 있으며 외부 전송하지 않았다.

## 실행 및 검증

사전 조회는 각10초, 복사는 볼륨별600초 상한. `debugfs`에 `-w` 없이 원본을 읽고 Windows 호스트 출력 경로에만 썼다. PostgreSQL 복사는10:12:56~10:13:08 UTC에 완료했고 이어 MinIO도 정상 완료했다. 자동 재시도·timeout·부분 실패 없음. stderr에는 debugfs 버전 배너 외 오류가 없었다.

|대상|복사 결과|파일 수|데이터 바이트|원본 재조회 대조|
|---|---|---:|---:|---|
|PostgreSQL|exit0|1,487|67,837,870|7개 표본 크기·SHA256 일치|
|MinIO|exit0|33|4,440,056|복사한 일반 파일33개 모두 크기·SHA256 일치|
|합계|완료|1,520|72,277,926|40개 대조 일치|

두 복사본 모두 전체 일반 파일의 목록·크기·SHA256을 기록했다. 파일 수는 물리 파일 수이며 MinIO 논리 객체 수가 아니다. 심볼릭 링크0건. PostgreSQL PG_VERSION은16. PostgreSQL 전체1,487개의 원본 해시를 대조한 것은 아니다. MinIO33개 파일의 대조도 동시 시점의 원자적 snapshot이나 객체 의미 검증을 보장하지 않는다.

증거는 복사본 루트의 `precheck.json`, `filesystem-capacity.txt`, `copy-plan.json`, `copy-results.json`, `*-rdump.stdout/stderr`, `*-files-sha256.json`, `source-comparison.json`, `verification-summary.json`, `acl-*.json`, `metadata-hashes.json`에 있다. classification 파일도 함께 저장했다. 조회 후 남은 wsl.exe는 기존11956/21184뿐이었다.

## 다음 검증 게이트

이 자료로 PostgreSQL16 클러스터와 MinIO 객체를 독립 환경에서 검사할 후보를 확보했다. 최신104벌·Scene·착용 이력의 포함 여부는 아직 미확정이다.

별도 승인 후 최초 복사본을 보존하고 작업용 복사본만 생성한다. 독립 환경의 작업본에서 journal/DB 복구 및 PostgreSQL16 기동·revision/테이블/레코드 조회, MinIO 객체 읽기·DB asset_key 대조를 수행한다. 원래 Docker Engine·공유WSL에서 서비스를 실행하지 않는다. 파일 해시 일치를 DB 정합성으로 판정하지 않는다.

기존 Docker/WSL 재시작·원본 쓰기·복원·서비스 기동·마이그레이션·시드·앱 전환·유료 호출·push·배포 없음.
