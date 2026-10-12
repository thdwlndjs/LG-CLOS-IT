# Docker 내부 생존성 실측 및 L2 승인 게이트

2026-10-12 약18:50 KST 이후. 기존 RCA의 로그 재분석·시뮬레이션 없이 L0/L1만 실행했다. 증거는 Windows `test-results/docker-live-preservation/`에 저장했다.

## 새 실측

- 직전 `wsl --list --verbose`에서 docker-desktop Running을 재확인한 뒤에만 L1 shell 실행. 정지 배포판은 실행하지 않는 조건을 적용했다. 확인과 진입 사이 상태 변화의 가능성은 완전히 제거할 수 없다.
- 조회 프로세스 추가와 소량 메모리 부하를 사전 평가했다. 각 subprocess10초 timeout. 모든 조회는 제한 안에 종료했고 timeout·재시도·정리용 프로세스 종료는 없었다.
- 실제 배포판 PID namespace는 `4026532219`, mount namespace는 `4026532217`. 보이는 기존 프로세스는 init/relay/vpnkit-bridge이며 Engine·PostgreSQL·MinIO·Redis PID는 보이지 않았다. 과거PID5996/18593/13721도 이 namespace에 없음.
- 이후 `/sys/fs/cgroup/docker/<기존 컨테이너 전체 ID>`의 live cgroup을 읽었다. PG77f9c8d47811, MinIOf73431e228e7, Redisf31215cc5523 모두 `populated 0`, 빈 `cgroup.procs`, `frozen 0`이었다. Docker 상위 cgroup도 populated0이다.
- 이는 PID namespace에서 숨겨진 프로세스 때문에 빈 PID 목록이 나온 경우와 구분된다. [Linux 공식 cgroup v2 문서](https://docs.kernel.org/admin-guide/cgroup-v2.html#un-populated-notification)에 따르면 populated0은 해당 하위 계층에 live process가 없음을 의미한다.
- 세 컨테이너 모두 `anon/file/shmem/file_mapped`0, `memory.swap.current`0. PG memory.current20480B, MinIO16384B, Redis4096B의 잔여 accounting만 관측됐다. 각 memory.events의 oom/oom_kill0. 과거OOM이나 다른계층의 사건을 배제하지 않음.
- 현재 VM MemAvailable7,307,444kB(약6.97GiB), 메모리 pressure avg10/60/300 모두0. cgroup root에는 memory.max/current/events 파일이 없어 root 제한을 숫자로 확인하지 못했다. 컨테이너 memory.max는 max이나 상위 계층/VM 제한이 무제한임을 뜻하지 않는다.
- 배포판 mountinfo에서 컨테이너 데이터 tmpfs는 보이지 않았고, 확인 가능한 기존프로세스의 namespace FD는 동일 mount namespace뿐이었다. 다른 namespace의 mount 존재·보유핸들까지 완전히 조사한 것은 아니다.
- 조회 후 Windows wsl.exe 목록은 원래 Docker backend가 띄운 vpnkit-bridge11956/21184만 남았다. 이번 명령 자식 잔류는 관측되지 않음. 원본 서비스·마운트 변경 없음.

## 판정

|대상|판정|직접 근거|한계·다음 조치|
|---|---|---|---|
|WSL VM|ALIVE-READABLE(L1)|기존Running배포판에서proc/meminfo/cgroup 읽기 성공|서비스 데이터 읽기 성공이라는 의미 아님|
|Docker Engine|UNKNOWN|접근한namespace에Engine없음, Docker컨테이너cgroup전체비어있음|실제EnginePID/실행namespace별생존은미확인|
|PostgreSQL|DEAD(기존컨테이너실행범위)|기존IDcgroup populated0/procs없음|프로세스가다른cgroup으로이동했는지완전추적하지못함; 데이터자체판정은아래참조|
|MinIO|DEAD(기존컨테이너실행범위)|동일|동일|
|Redis|DEAD(기존컨테이너실행범위)|동일|영속RDB는별도이며이번에읽지않음|

프로세스 없음과 데이터 소실을 동일시하지 않는다. 원래 ID의 실행 계층에는 프로세스 및 데이터 페이지가 남아 있지 않다는 직접 근거를 확보했다. PG/MinIO tmpfs의 원래 cgroup에 shmem/file/swap도0이므로 살아 있는 서비스의 네트워크 문제만으로 보기는 어렵고, 원래 tmpfs 데이터 소실 가능성이 높아졌다. 다만 다른 namespace/외부 보유핸들/다른 계층 메모리 accounting의 잔존까지 배제하지 못해 데이터의 전역 소실은 확정하지 않는다. 실제 데이터 ALIVE-READABLE 판정 대상은 아직 없다.

## 막힌 계층 및 다음 게이트

현재 막힌 지점은 Docker Engine→기존 컨테이너 실행 namespace이다. 배포판 진입은 성공했지만 기존 서비스의 실행 cgroup이 비어 있다. 따라서 pg_dump/객체 목록을 실행할 live 서비스 경로가 확보되지 않았다. 네트워크포트 응답만 기다리는 진단은 반복하지 않는다.

가장 안전한 다음 L2 후보는 **기존 디스크의 Redis RDB 메타데이터 읽기**다. live PG/MinIO를 새로 띄우는 조치는 포함하지 않는다.

```text
wsl -d docker-desktop -u root --exec /usr/sbin/debugfs -R "stat /data/docker/volumes/bf37edf0792e66b808e31f7c38640463b189b66717c2925f92ff01ff822db506/_data/dump.rdb" /dev/sdd
```

실행 전 Running을 재확인하고, 기존 block device 식별이 변하지 않았는지 확인해야 한다. debugfs는 -w 없이 기본읽기전용, stat만실행. 추가프로세스·디스크읽기I/O와현재활성파일시스템의일관성제약이 있어L2로분류하며 **아직 실행하지 않았다.** 10초timeout, 응답없으면반복하지않고자식잔류확인. 기존볼륨에출력쓰지않음. 기대결과는RDB존재·크기·inode정보이며객체/DB백업이나RDB내용추출은포함하지않는다.

이 승인은 실제백업·재시작·원본수정 허가가 아니다. 추가live namespace를 조사할 경우에도 distro기동가능성·새프로세스위험을 별도평가해야 하며 L3 조치를 포함하지 않는다.

## 백업·손실 범위

PG/MinIO live백업은현재실행불가. 접근확보시만 pg_dump -Fc/MinIO읽기전용다운로드를 별도승인요청한다. Windows호스트 여유239,461,097,472B(약223GiB). 백업경로는Docker저장소외부 `test-results/recovery-backups/<UTC>/`로제안하며 아직생성하지않았다.

Redis영속RDB는과거자료상존재했으므로디스크메타데이터확인후별도추출승인을요청할수있다. 원본에서BGSAVE/SAVE/redis-cli--rdb는실행하지않음.

원래tmpfs가실제로소실됐다면과거dump와로컬manifest·에셋·시드로재구성할수있는부분만남으며, B/C이후실제Snapshot/Job/카드/변경이력은보존보장불가. 새데이터나유료호출권한으로자동대체하지않음. 이번확인만으로정확한소실시각/RPO를갱신하지않는다.

## 명령 기록

`l0-wsl.json`, `l0-processes.json`: 호스트상태.
`l1-proc-mount.json`: UTC·명령·exit·프로세스·메모리·mountinfo.
`l1-namespace-map.json`: namespace·cgroup존재·보유FD.
`l1-service-cgroups.json`: 원래ID의live cgroup상태/제한/events.
`l1-data-memory.json`: 데이터메모리·swap·pressure.
`evidence-hashes.json`: 각증거의SHA256.

Windows명령은host에만파일을썼으며VM/tmpfs/볼륨은변경하지않았다. L2·L3·유료API·push·배포는실행하지않았다.

## 후속 승인 L2: Redis RDB 메타데이터 조회

사용자의 조건부 승인 후 정확한 대상에 읽기 전용 `debugfs stat`을 1회 실행했다. 실제 백업·복원·재시작은 승인 범위에서 제외했다.

- 실행 직전 docker-desktop Running 확인.
- `/sys/class/block/sdd/dev`는 `8:48`, size는2,147,483,648 sectors. 커널 mountinfo는 동일 장치가 `/mnt/docker-desktop-disk`에 ext4로 마운트됨을 확인. 기존 기록과 일치한다.
- 보조 `/usr/sbin/blkid -p /dev/sdd`는 바이너리가 없어 exit127. 재시도·설치하지 않았다. 파일시스템 확인 근거는 커널 mountinfo다.
- 기존 Redis 볼륨의 정확한 `_data/dump.rdb` 경로에 `debugfs -R stat ... /dev/sdd` 실행. `-w` 없음, 10초 상한, 재시도0, 정상종료.
- 파일 존재: regular file. inode235737, size4247B, mode0600, UID999/GID1000, links1, blockcount16. extents8857497~8857498.
- mtime은2026-10-12 03:15:59 UTC / 12:15:59 KST. ctime/atime/crtime도 같은 초로 표시됐다. 이는 파일 생성·수정 메타데이터이며 RDB 내용 완전성 검증이 아니다.
- 파일 내용 다운로드·해시·redis-check-rdb는 실행하지 않았다. 따라서 Redis RDB는 메타데이터 존재 확인이며 ALIVE-READABLE 서비스 판정으로 바꾸지 않는다.
- 이번 자식 wsl.exe 잔류 없음. 확인된 기존11956/21184만 유지.
- 증거: `redis-l2-running.json`, `redis-l2-device.json`, `redis-l2-rdb-stat.json`. 원본 디스크·볼륨에 출력 파일을 쓰지 않았다.
