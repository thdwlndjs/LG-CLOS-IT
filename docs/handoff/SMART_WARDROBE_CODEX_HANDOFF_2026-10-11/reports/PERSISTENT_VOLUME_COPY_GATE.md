# 영속 볼륨 복사 사전 검증 — 보류

2026-10-12. 승인 조건: 원본 쓰기 활동·일관성 확인 후에만 복사. 이번에는 일관성 게이트를 통과하지 못해 데이터 복사를 실행하지 않았다.

## 대상과 실측

`/dev/sdd`는 기존 장치8:48이며 `/mnt/docker-desktop-disk`에 ext4로 RW 마운트돼 있다. 저장된 컨테이너 설정14개를 읽어 실제 볼륨 연결을 확인했다.

|원본 볼륨|연결 컨테이너|live 실행 상태|
|---|---|---|
|`/data/docker/volumes/smart-wardrobe_postgres-data/_data`|smart-wardrobe-postgres-1, ID1a92963a7916…|해당cgroup populated0, procs없음|
|`/data/docker/volumes/smart-wardrobe_minio-data/_data`|smart-wardrobe-minio-1, ID186abb429e21…|해당cgroup populated0, procs없음|

metadata의Running=true/PID1259·57788은live상태로취급하지않는다. 원래컨테이너애플리케이션의live쓰기근거는없다. 다만다른namespace·커널파일시스템활동을완전히검증한것은아니다.

ext4 features에`needs_recovery`가있으며filesystem state는`clean`으로표시된다. 이조합을DB정합성이나원본파일시스템손상확정으로해석하지않는다. journal과raw block을읽는debugfs의현재파일뷰가일관된복사원본인지확정하지못했다. 원본journal replay·fsck·remount는실행하지않았다.

디스크stat두관측에서writes completed6,928,889→6,928,904, flush4,009,863→4,009,878; sectors written314,072,688은동일했다. 따라서실제볼륨파일내용쓰기발생이라고단정하지않고, block device의flush활동이지속됐다는관측으로기록한다. 이수치만으로어떤경로가변경됐는지알수없다.

## 결과

- 복사: 보류. 확보한데이터복사본용량0B.
- 복구데이터폴더/ACL: 생성·변경하지않음. 데이터가없으므로접근제한된백업확보성공으로보고하지않음.
- 파일목록·크기·SHA256복사대조: 미실행. 원본일관성이미확정이므로PASS아님.
- PostgreSQL DB정합성·MinIO객체내용: 아직미검증.
- 기존Docker/WSL/볼륨변경·재시작·파일추출·복원·서비스기동없음.

## 다음 격리 검증 절차

별도승인후원본일관성을보장하는host/storage snapshot지원여부를확인하고, 지원되면독립보존본을확보해야한다. 현재사용가능한원자적snapshot경로를확인하지못했으며기존VM종료를대안으로실행하지않는다. live읽기전용전체디스크복사는원자적snapshot이아니므로동등한보존보장을주장하지않는다.

일관된보존본이확보되면immutable보존본과작업용복사본을분리한다. journal복구는독립환경의작업용복사본에서만승인후수행한다. PostgreSQL기동·SQL조회로revision/테이블/104벌/Scene/착용이력을검증하고, MinIO객체전체읽기·해시와asset_key대조를수행한다. 이단계는이번승인밖이다.

증거: Windows `test-results/docker-live-preservation/copy-precheck-device.json`, `copy-volume-consumers.json`, `copy-precheck-live.json`, `copy-precheck-filesystem.json`. 개별명령10초제한·재시도없음. 자격증명Env는출력·보존하지않고선택된mount/state필드만기록했다. 원시진단은Git무시폴더에보관, 외부업로드없음.
