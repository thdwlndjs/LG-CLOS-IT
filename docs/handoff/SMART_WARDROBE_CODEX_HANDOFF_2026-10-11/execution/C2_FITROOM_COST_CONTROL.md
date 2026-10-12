# C-2 FitRoom 실행 계약

2026-10-12 사용자 비용 통제 지시를 기준으로 한다. A1·B-01 승인 화면·B-02 DEFERRED와 기존 C Mock 계약을 유지한다. D~G·운영 DB·원격 push·배포는 승인 범위 밖이다.

## 실행 권한

이번 Codex 작업의 실제 FitRoom 호출 예산은 **0회**다. 입력 검사·생성·상태 조회를 포함한 실제 공급자 엔드포인트를 호출하지 않는다. 실제 공급자 응답을 기록한 Fixture는 확보되지 않았으며 합성 응답만 사용한다. 무과금 PASS는 실제 시착 품질 PASS가 아니다.

기본값은 `FITROOM_LIVE_ENABLED=false`, `FITROOM_STATUS_READ_UNBILLED_VERIFIED=false`이며 키는 서버 `FITROOM_API_KEY` SecretStr로만 읽는다. local/test는 활성화 플래그가 있어도 LIVE 전송을 차단한다. CI·서버 기동·백그라운드 Worker는 FitRoom 생성 요청을 하지 않는다.

LIVE 생성은 다음 조건을 모두 충족해야 한다.

1. 사용자가 화면의 프로필·인물·의류·모드·예상 1credit을 확인한다.
2. 별도 사용자 승인 후 서버 DB 접근 권한을 가진 팀 담당자가 정확한 review ID·fingerprint에 오프라인 1회 권한을 부여한다. 승인 시각부터 10분 이내 최초 소진만 허용하며 재승인·기간 연장은 제공하지 않는다. 웹 API에는 권한 발급 기능이 없다.
3. staging/production의 실행 환경, 활성화 설정 및 키가 준비된다. 현재 배포는 수행하지 않는다.
4. 사용자가 직접 실행 버튼을 누른다. Codex가 대신 실행하지 않는다.
5. 서버가 권한을 원자적으로 소진하고 commit한 다음 최초 전송을 시도한다. 입력·전송·응답·저장 실패나 프로세스 재시작으로 권한을 복구하지 않는다.

중복 제출은 동일 review에서 차단된다. 같은 입력·모드·HD 조합은 같은 review로 재조회한다. 입력 변경으로 새 review를 만들더라도 별도 승인 없이 LIVE 권한을 얻지 않는다. 생성은 재시도·redirect·백그라운드 재실행하지 않는다. 전송 결과가 불명확하면 FAILED/SUBMISSION_UNCERTAIN으로 기록하고 재생성하지 않는다.

## 입력과 결과

- additive `/api/v1/integration/fitroom/reviews` 경로 사용.
- 이번 지원 조합은 TOP+BOTTOM `combo` 또는 DRESS `full_set`이다. OUTER·SHOES·ACCESSORY는 자동 제외하지 않고 요청을 거부한다. 기존 6슬롯 C Mock 선택 정책을 축소하지 않는다.
- 기존 OWNED/LIKED 권한·동의·READY·체크섬·버전 검사를 재사용한다.
- 원본을 덮어쓰지 않고 인메모리 파생 입력에서 EXIF 회전·흰 배경 알파 합성·비율 유지 축소만 수행한다. 윤곽 색 번짐 제거와 시각 품질 검수는 별도다.
- 최초 실행 Snapshot에 person/item ID·체크섬·출처·전처리 버전·HD·비용을 고정한다. 이후 선택 변경은 이미 준비한 요청을 바꾸지 않는다.
- 결과 PNG는 MinIO와 기존 asset/job에 저장하며 Snapshot에 연결한다. Fixture는 실제 시착이 아니라고 표시한다. LIVE 결과도 품질 검수 전 상태로 표시한다.
- 화면 이탈·프로필 전환 시 임시 상태와 늦은 결과 유입을 차단한다. 서버의 소비 기록은 유지한다.

## 상태 조회와 남은 게이트

일반 review GET은 DB/MinIO만 읽는다. 공급자 작업 ID를 받은 뒤에도 상태 조회는 별도 수동 POST이며 과금 여부가 확인되기 전에는 차단한다. `FITROOM_STATUS_READ_UNBILLED_VERIFIED`는 공급자 문서 또는 계정 조건을 확인한 후에만 설정한다. 현재 확인·활성화하지 않았다. 자동 폴링은 없다.

실제 호출 승인 전 계정의 달러 요금·최소 충전액·실패 과금·상태 조회 과금·데이터 보존 조건을 확인해야 한다. 1credit은 공개 계약에 따른 예상치이며 계정 과금 조건 검증을 대체하지 않는다. 상태 조회 과금 확인 플래그가 없으면 승인 도구와 생성 전송도 차단한다. 생성 권한은 해당 review의 최초 POST만 승인하며, 이후 상태 조회는 과금 없음 확인 후 사용자가 수동 요청하는 별도 행위다.

사용자는 원본과 별도로 **실제로 전송할 전처리 PNG**를 확인한다. review는 그 PNG를 표시하고 파생 체크섬·전처리 버전을 fingerprint/Snapshot에 포함한다. 실행 직전 같은 변환 결과를 대조한다. 색 번짐 정리 등 후속 이미지 변경은 새 review·별도 승인 대상이다. 원본 파일과 DB asset ID는 유지한다.

작업 ID 없는 불명확한 전송은 사용자가 공급자 계정 내역으로 확인하기 전까지 정지한다. 생성 재전송이나 자동 추측 복구는 하지 않는다. 담당자의 수동 비용·작업 내역 확인도 이번 Codex 작업에서는 수행하지 않는다. 실모델 품질·TOP+BOTTOM+OUTER·다중 액세서리 시착은 미검증이며 이 계약의 완료 판정에 포함하지 않는다.

## 독립 검증

PostgreSQL의 원자적 claim·별도 commit, MockTransport의 HTTP envelope, 네트워크에 연결하지 않는 stub, 실제 로컬 브라우저·MinIO를 구분해 증적을 남긴다. 생성 중복·동시 요청·타임아웃·재기동·미승인·교차 사용자·UI 확인을 검증한다. 합성 Fixture를 실제 공급자 사례로 기재하지 않는다.

최종 결과는 [C-2 완료 보고서](../reports/C2_FITROOM_IMPLEMENTATION_REPORT.md), 재개 상태는 [체크포인트](../reports/C2_FITROOM_CHECKPOINT.md)에 기록한다. 실제 최초 호출은 별도 승인 이후 사용자가 직접 1회 실행한다.
