# Smart Wardrobe Docker Desktop / WSL2 RCA 및 데이터 보존

조사일: 2026-10-12. 기준 코드 `2dc8e40`(제품 변경 없음). 보고서는 Windows 프로젝트 폴더에 있으며 Docker 저장소 외부다. 원시 증거는 Git에서 무시되는 `test-results/docker-rca-20261012/`에 보관한다. 개인정보·인증 관련 로그 가능성이 있어 원시 파일은 원격 전송하지 않는다.

## 결론 및 데이터 보존 게이트

확인된 장애는 host backend에서 내부 Engine `192.168.65.7:2376`에 접근하지 못하는 현상이다. 최초 촉발 원인은 미확정이다. PostgreSQL·MinIO tmpfs 데이터 생존도 미확정이다. 현재 자료로 안전한 재시작을 보장할 수 없다.

이번 조사에서 `wsl -d`, docker exec/stats/cp, pg_dump, 서비스/VM 재시작·종료, 마운트 변경, 복원·시드, 유료 호출은 실행하지 않았다. WSL 내부 메타데이터에 대한 과거 관측은 재검증된 현재 사실과 구분한다. Gate A는 데이터 접근 경로 미확보로 열리지 않았다. 데이터 추출은 별도 승인 전 실행하지 않는다.

## Phase 0: 증거 보존과 시각

- Windows에서 Docker·WSL 관련 프로세스 및 서비스 상태 조회, `wsl --list --verbose`만 실행. 목록 조회는 distro 기동 명령이 아니다.
- host/vm Docker 로그 25개, 총23,274,637바이트를 호스트 증거 폴더에 복사. `log-manifest.json`에 원본 경로·복사 경로·SHA256·바이트 수·원본 mtime UTC 기록. 라이브 원본은 복사 중 변할 수 있으므로 해시는 복사본의 증거 식별값이며 원자적 스냅샷 보장이 아니다.
- System79건, Application270건, Hyper-V VmSwitch 최신4000건을 JSON으로 보존. VmSwitch는 제한으로 앞부분이 빠질 수 있어 전체12시 이후 로그가 아니다. Resource Exhaustion Detector/Resolver는 조회 구간0건. 기존 Sprint0 storage-init 증적도 `prior/`에 복사.
- 최종 파일 해시는 `evidence-hashes.json`. 원시 복사본·명령 결과·정규화 timeline·dump/asset 분석을 식별한다.
- `normalized-timeline.json`: 12:15~12:20 host/vm 관련 사건129건, UTC/KST 및 출처. 같은 사건이 host/monitor에 중복 기록되므로 독립 증거로 중복 계산하지 않는다.
- Windows 이벤트에서01:13:32KST에 약-1.658초 시계 보정 확인. 조사 중심12:15~12:20에 시계 변경 이벤트는 확인하지 못함. `w32tm /query /status`는 W32Time 중지로 실패. NTP 오차는 현재 검증 불가. VM·host의 동일 event 전달 시각은 밀리초 수준으로 가깝지만 정확한 전역 시계 동기화를 증명하지 않는다.
- 과거 커널 monotonic→호스트 시각 환산상 Interop 오류는 약13:50:19KST. 시계 오차 영향을 받는 추정이며 최초12:18 장애와 구분한다.

## Phase 1: 계층별 생존

| 계층 | 이번 관측 | 한계 |
|---|---|---|
| Windows host | Docker backend PID2036/2096 및 GUI·wslhost 존재 | 프로세스 존재가 내부 서비스 정상 의미 아님 |
| WSL VM | 목록상 docker-desktop Running, vmmemWSL PID13260 존재 | namespace·Engine·tmpfs 생존 미확인 |
| Windows 서비스 | WslService·vmcompute·hns Running; W32Time·com.docker.service Stopped | com.docker.service 중지를 원인으로 단정하지 않음 |
| Engine | docker version10초 timeout, 재시도하지 않음 | Engine 종료/정체/경로 단절을 단독 구분 불가 |
| 컨테이너 | 과거 디스크 metadata상 PostgreSQL5996·MinIO18593·Redis13721, RestartCount0, Running=true | stale metadata이며 이번 live 검증 아님 |
| tmpfs | 과거 실제 저장 설정 및 생성 스크립트에 PG/MinIO tmpfs 확인 | live mount·내용 미확인; Engine/VM 종료 시 소실 위험 |

과거 프로토콜 검사에서 Redis16379·PG56433·MinIO19000 모두 TCP 수락 후 무응답. 수락 프로세스는 Docker backend2036였다. 이번에는 같은 timeout 요청을 반복하지 않았다. 안전한 live 데이터 추출 경로는 아직 확보되지 않았다. tmpfs가 살아 있을 가능성은 남지만 시간 경과만으로 생존/소실 판정하지 않는다.

## storage-init-1

현재 `infra/compose.yaml`의 storage-init은 backend 이미지로 `python /workspace/scripts/init_storage.py`를 실행하고 MinIO healthy에 의존하며 restart policy는 `no`다. `scripts/init_storage.py`는 local/test 환경만 허용하고 HEAD bucket 후404/NoSuchBucket/NotFound일 때만 create bucket 한다. DB 접근·버킷/객체 삭제·기존 데이터 재생성 동작은 없다. 실행하면 존재하지 않는 빈 버킷을 생성하는 변경은 가능하다.

기존 `sprint0-minio-evidence.json`에는 storage-init exited/exit0, 별도 replay 증적에는 수동 compose run --rm --no-deps 실행 exit0이 있다. 이는 과거 실행 기록이다. 정확한 현재 `smart-wardrobe-storage-init-1` ID·FinishedAt·실제 restart policy·최근 재실행 시각은 Engine 접근 실패 및 WSL 내부 진입 보류로 미검증이다. 복사한12일 로그에 storage-init 이름 검색 결과0건이나, ID 기반 기록을 놓칠 수 있어 재실행 없음을 증명하지 않는다.

시연 데이터는 별도 `wardrobe-handoff-*` 컨테이너이며 Compose MinIO9000/PG5432와 다른19000/56433을 사용한다. 현재 소스상 storage-init은 이 별도 시연 DB를 초기화하지 않는다. 실행 당시 이미지 digest·실제 환경값을 확인하지 못해 완전한 무관성 판정은 보류한다.

## Phase 2: 장애 타임라인

| UTC (2026-10-12) | KST | 관측·출처 | 의미 |
|---|---|---|---|
|03:15:41|12:15:41|VM apiproxy stream shutdown 오류|이후 정상 요청 기록, 최초 중단 증거 아님|
|03:15:59|12:15:59|과거 읽은 Redis 로그: RDB 저장 성공|그때 서비스 동작 지지, 현재 상태 증명 아님|
|03:18:43.077|12:18:43.077|VM init.log: PG/MinIO/Redis stats 요청 반환, .102 이후 로그 중단|실제 각 서비스 프로토콜 health 검증은 아님|
|03:18:47.110|12:18:47.110|과거 읽은 PG 로그: client EOF3건|연결 단절, 원인/결과 미구분|
|03:18:52.978|12:18:52.978|host monitor: Engine dial context canceled|최초 지속 host→Engine 실패 관측|
|03:18:57.061|12:18:57.061|backend IPC GET/ping deadline|후속 내부 통신 실패|
|03:19:07.430|12:19:07.430|wsl-bootstrap unshare expected signal interrupt|신호 대상·발신자·runtime 종료 관계 미확인|
|03:19:39.103|12:19:39.103|backend apiproxy: no route to host|내부 주소 접근 경로 장애 강한 증거|
|약04:50:19|약13:50:19|과거 WSL kernel Interop broken pipe/signal6|최초 장애보다 늦어 촉발 원인으로 사용하지 않음|
|09:12 이후|18:12 이후|host monitor dial/IPC/network timeout 지속|장애 지속|

관측상 전환 구간12:18:43~12:18:52. 로그 반환 시각이 종료/정지 시각과 같다고 단정하지 않는다. 마지막 정상 사용자 API 응답 시각은 이 로그만으로 확정 불가.

## 가설별 시그니처·증거·반증

| 가설 | 예상 시그니처 | 실제 증거 | 반증 조건/필요 정보 | 판정·확신 |
|---|---|---|---|---|
|Engine 정체/종료|daemon exit/panic, runtime exit, blocked task 또는 직접 socket 무응답|VM 로그 중단, bootstrap signal, Engine 무응답|Engine live PID·socket 정상 응답이면 종료 가설 반증; daemon 종료 기록 없음|미확정 Low|
|backend↔WSL/Engine 단절|dial/IPC failure, 내부 host unreachable|dial 실패·no route to host·IPC deadline|기존 namespace 내 Engine 정상 접근과 host 실패를 비교 필요|단절 현상 확인 High, 촉발 원인 미확정|
|내부 network/proxy 장애|route/interface 소실, packet loss, proxy timeout|no route to host, 과거 세 포트 수락/무응답|namespace 내부 경로·실행 환경 확인 필요; Engine 종료도 같은 증상 가능|유력 Medium|
|OOM/disk/I/O|OOM kill·resource event·no-space·I/O error|과거 Windows 여유0.52GiB, 현재 vmmem working set약139MiB|조사구간 자원 고갈 이벤트0; 과거 WSL avail6.97GiB, C 여유223GiB; 장애시점 시계열 없음|미확정 Low|
|절전/최대절전/Modern Standby|Kernel-Power42/107/506/507, resume event|선별한당일 System에서 해당 사건 미관측|이벤트 누락·보존 범위/VM별 상태 확인 필요|미확정 Low, 지지 근거 없음|
|업데이트/VPN/보안|설치·driver/network 변경·VPN/방화벽 전환과 직접 로그|CrossDevice 업데이트 실패12:26:51(발생 이후); Docker backend 시작일10/8 유지|Docker 업데이트 직접 증거 없음; 보안/VPN 변경 감사 미확보|미확정 Low|
|storage-init 재실행|container start/exit, bucket operation 시간 일치|과거exit0 및 수동 replay, 현재 소스 삭제없음|현재ID/종료시각/실행이미지/환경 미확인, 이름검색0은 배제 근거 아님|미확정 Low, 파괴적 원인 지지 없음|

Hyper-V285 경고는11:59:55에도 존재하므로 최초 장애 원인으로 확정하지 않는다. backend와monitor 중복은 독립 증거가 아니다. WSL 목록·GUI Running도 Engine 생존 근거가 아니다. `.wslconfig`는 사용자 홈에 없었다. 실제 적용 기본 설정·다른 관리 정책은 미확인. 호스트 swap 현재 약5.1GiB/29GiB는 이전 측정이며 장애 시점 고갈을 배제하지 않는다.

가장 유력한 설명은 내부 Docker 실행/통신 경로가 끊어진 상태다. 현상 확신High, 최초 촉발 원인Low. Engine 자체 종료와 내부 network/runtime 탈락은 현재 증거로 분리 불가다.

## Phase 3: 백업 및 격리 실험

`dump-analysis.json`은 custom archive TOC/data block을 읽고 zlib 해제·block ID를 검증한 분석이다. 복원 없음. 공식 `pg_restore --list`와 동등한 검증이라고 주장하지 않는다. Windows PATH 및 Program Files PostgreSQL에서 pg_restore를 찾지 못했다. 설치·다운로드·기존 Docker 실행은 하지 않아 공식 list 검증은 미완료다.

|dump 파일 축약|헤더 생성 wall-clock(시간대 미포함)|revision|전체 테이블|garment/asset/member/wear|
|---|---|---|---|---|
|cloud-before-import-a93b1b298160|10/9 19:29:06|0004|79|0/0/0/0|
|before-integration…081429Z|10/9 08:14:32|0003|33|3/0/2/0|
|before-owned-import…123956Z|10/9 12:39:56|0004|41|3/0/2/0|
|before-owned-import…124948Z|10/9 12:49:49|0004|41|9/6/2/0|

각 dump에는 scene_placement·liked_item·0006 FitRoom 테이블이 없다. 클라우드 dump의 79개 테이블에는 auth/storage 등도 포함되며 wardrobe 데이터는 0건이다. 헤더의 wall-clock에는 시간대가 없어 UTC로 확정하지 않는다. 파일명의 Z 시각을 UTC로 해석하면 최신 로컬 dump부터 10/12 12:18:43 KST까지 약 62시간 29분이다. 헤더 시각을 KST로 해석하면 약 71시간 29분이다. 이를 시간대 미검증 RPO 범위로 기록한다. 클라우드 dump는 시연 DB의 유효 복구 지점이 아니므로 그 생성 시각을 시연 RPO로 쓰지 않는다.

실질적으로 B/C 작업과 이후 사용자 변경 이력은dump에 없어 해당 구간 복구 불가다. 로컬manifest/seed는 재구성 근거이며 그 시점의 실제 사용자 상태 백업은 아니다.

`asset-analysis.json`: 승인manifest24개(행거21+K3) 모두존재·해시일치, B01 신규35개 모두존재·해시일치, 나머지31개간접참조, 상품원본52개모두존재·해시일치. 객체 전체 백업은 아님. 과거 읽은 Redis RDB4247바이트 존재/12:15:59저장 기록은 있으나 이번 접근·redis-check-rdb 미실행으로 완전성·최신성 미검증. 생성 카드·VTON 결과·Snapshot·Job·grant소진/감사이력은 원본 DB/객체에 접근해야 보존 가능하다. 재구성 시 유료 호출 권한 자동 복구 금지.

독립VM/물리머신/클라우드 실험환경을 확인하지 못해 시뮬레이션 미실행. 공유WSL/Engine에는 실험하지 않았다. 승인된독립환경 실험계획:

1. 합성DB/객체로 tmpfs/영속저장 비교. 개인정보·시크릿 미사용.
2. proxy경로 차단만 재현: host TCP수락/무응답+내부Engine생존 여부 비교. 내부 접근까지 실패하면 단독proxy가설 반증.
3. Engine/runtime중단 및 네트워크경로 소실을 각각 재현해 log/route/container생존 시그니처 비교. 원본과 유사하다고 역사적 원인 확정하지 않음.
4. VM절전/메모리압박은 그 독립환경에서만 각각 재현. 최초실패계층·OOM/Power사건 유무로 비교.
5. 호스트의 별도 pg_restore바이너리 또는 독립VM에서4개dump --list, 후속독립DB복원검증. 외부이동 전dump의계정해시·사용자이력·시크릿 가능성 검토, 공개서비스 업로드 금지.

## Phase 4: 복구 선택과 승인

|옵션|조건|손실 위험·가역성|승인|
|---|---|---|---|
|추가host읽기전용로그조사|현상유지|낮음, 원본변경없음|현재허용범위|
|기존실행namespace진입·socket검사|이미살아있는runtime임을확인해야함|wsl-d가정지된distro를기동할위험과부하. 위험사전평가필요|추가진단계획승인후|
|PGdump/MinIO다운로드|실제접근복구|원본읽기부하, 호스트파일생성; 원본삭제없음|Gate A 명시승인|
|proxy/backend수정·재시작|영향범위와컨테이너독립생존검증|VM/runtime종료연쇄위험, 가역성보장불가|보존성입증및명시승인|
|Docker/WSL재시작|백업완료 또는손실수용|tmpfs소실위험High, 무손실가역아님|현재금지|
|별도영속환경재구성|최신이력손실범위수용|원본을보존하며구축가능, 최신상태복원보장불가|별도승인|

접근확보시먼저제안할백업경로: Windows `test-results/recovery-backups/<UTC>/` 아래 PG custom dump 및 MinIO bucket/key 객체와 해시목록. 기존볼륨/tmpfs밖에저장. 기존서버읽기전용, 버킷생성/동기화삭제옵션금지. 실행전실제DB명·접속대상·여유공간·키안전관리·읽기부하확인후승인요청.

현재 승인 권고는 이미 Running으로 표시되는 기존 VM/runtime에 대한 최소 읽기 전용 namespace 진단의 위험 평가와 실행 범위 확정이다. 안전한 진입 경로가 확정되지 않으면 진입하지 않는다. 공식 dump 검증은 독립 환경을 확보한 뒤 수행한다. 이번 단계에서는 추출·복구를 실행하지 않았다.

## 실행 명령과 증거 목록

|명령/작업|목적·결과|증거|
|---|---|---|
|Get-Process/Get-Service/CIM|비기동호스트상태·메모리조사|host-processes.json, host-memory.json|
|wsl --list --verbose, subprocess timeout10s|목록만조회, 성공|wsl-list.txt|
|docker version, subprocess timeout10s|Engine조회, timeout, 반복없음|docker-version.txt|
|Python shutil.copyfile+SHA256|host/vm로그보존|logs/, log-manifest.json|
|Get-WinEvent 제한조회|Windows이벤트보존|System/Application/Hyper-V/Resource JSON|
|w32tm /query /status|현재시계동기화확인, 서비스중지오류|본보고서 및 power-resource-clock-events.json|
|Get-NetAdapter|네트워크adapter목록만조회|network-adapters.json|
|Test-Path .wslconfig|파일없음|본보고서|
|Python dump바이트분석|TOC/data행수·revision·SHA256|dump-analysis.json|
|Python manifest/파일해시비교|이미지누락검증|asset-analysis.json|
|Python UTC/KST변환|핵심로그정규화|normalized-timeline.json|

명령은기본10~15초상한을적용했고Engine timeout은반복하지않았다. 증거보존·분석은호스트파일에만썼다. 원시로그에는개인정보가포함될수있어Git추가/원격전송하지않는다. 컨테이너/tmpfs실측과공식dump list는미완료이며PASS로처리하지않는다.
