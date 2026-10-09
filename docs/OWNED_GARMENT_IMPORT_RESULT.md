# 로컬 실제 보유 의류 적재 결과

검증일: 2026-10-09. **사용자 보유 목록의 등록 후보 6벌을 로컬 DB에 저장하고 사진 표시·중복 방지를 검증했다. 원래 URL 입력 10건 중 4개 참조는 보류.** 검증 범위는 DB·API·이미지·화면 동작이며 구매 옵션이나 물리적 위치를 확인한 결과가 아니다. 전체 입력을 모두 적재한 것으로 판정하지 않는다. 클라우드 DB에는 적재하지 않았다.

## 실제 변경

- 시연 계정과 기존 접근 가능한 물리 옷장 기기에 기존 등록 API로 6벌을 등록했다. 상품당 1벌이며 사이즈를 요구하거나 저장하지 않았다.
- 사용자가 이미지 동의 때문에 미실행이었다는 설명 후 “다시 적재해”라고 재요청한 것을 사진 포함 로컬 적재 승인으로 해석했다. 별도의 “동의합니다” 답변을 받은 것은 아니다. 시연 계정의 설정 API에서 `image_upload_consent=true`를 기록하고 업로드했다. 사용자 인물 이미지(`PERSON_VTON`)는 등록하지 않았다.
- 공식 상품 사진 6개를 기존 upload intent → signed PUT → SHA256 finalize 계약으로 MinIO에 저장했다. 상품 원본 사진의 출처는 `CATALOG_REFERENCE`로 비공개 원장에 보관하며 실제 소유 의류 촬영 사진이나 위치 증거로 취급하지 않는다.
- Seed 의류 3건은 기존 DELETE API로 retire 처리했다. 저장된 Seed 코디 1건은 ARCHIVED로 변경했다. 물리 삭제하지 않았고 과거 DRAFT 코디 2건은 보존했다.
- 위치·태그·공유·착용·세탁 이력을 임의 생성하지 않았다. 보류 상품을 대체 상품으로 만들지 않았다.

## 발견한 결함과 수정

기존 API가 `location_id=null`을 받으면 위치가 없어도 `last_seen_at=now()`를 저장했다. 등록 후 추가 DB 검증에서 발견했다. 위치가 없는 등록·위치 제거 시 마지막 확인 시각을 NULL로 유지하도록 수정하고 실DB 회귀 테스트를 추가했다.

수정된 로컬 API로 적재한 6건의 불필요한 시각을 version 기반 PATCH로 제거했다. 직접 SQL UPDATE나 이력 조작으로 우회하지 않았다. 최초 수정안은 PostgreSQL NULL 파라미터 타입 오류로 새 회귀 테스트 2건이 실패했으며, 명시적인 timestamp 값을 바인딩하는 최종 수정 후 Sprint 1 API 테스트 11건이 통과했다. 적재 도구에도 시각·위치 신뢰도가 NULL인지 확인하는 조건을 추가했다.

## 검증 증거

| 검사 | 결과 |
| --- | --- |
| 실제 DB 전체 의류 | 9건: 활성 6 + retired Seed 3 |
| 활성 의류 API 조회 | 6건, owner/device/상품명/category/color/이미지 계획 일치 |
| 준비 완료 이미지 | 연결된 READY 이미지 6건 |
| 이미지 GET | 6건 모두 다운로드 SHA256이 검증된 원본과 일치 |
| 미확인 값 | 6건 모두 UNKNOWN, location_id/location_confidence/last_seen_at NULL |
| 실제 이력 | wear_event 0, care_event 0, garment_observation 0 |
| 동일 계획 재실행 | 신규 등록 0, 전체 9·활성 6 유지 |
| 로컬 Chromium | 시연용 로그인 → 옷장 6벌 → 이미지 6개 naturalWidth > 0, 사진 없음 0, 이미지 요청 실패 0 |
| readiness | database/redis/storage/renderer 모두 ok |
| 실행 OpenAPI | 56개 경로 validator 통과 |
| 적재 도구 단위 테스트 | 6개 통과 |
| Sprint 1 실DB API 회귀 | 11개 통과, NULL 위치 신규/제거 검증 2개 포함 |
| 전체 integration 디렉터리 실DB 회귀 | 104개 통과 |
| 계정 credential 테스트 | 2개 통과 |

브라우저 증적은 Git 제외 `test-results/owned-import-browser-20261009.json` 및 PNG, DB 집계는 `test-results/owned-import-db-20261009.json`에 보관한다. 개인 상품 URL·상세·사진·DB 식별자는 공개 문서에 포함하지 않는다.

최초 적재 전 백업: `test-results/wardrobe-before-owned-import-20261009T123956Z.dump`, SHA256 `7b254e266de34a494a1eb6c530f97955f402bc12bd869ac384865e1b4ecdc8ec`.

시각 정정 전 추가 백업: `test-results/wardrobe-before-owned-import-20261009T124948Z.dump`, SHA256 `5963e0301ce25ea6bf11de49fdcc48c8075b3f7428ba89b0e728f33b3e78d55a`.

최초 적재 코드 revision은 `2538c4a`, 최종 시각 결함 수정은 `b8228fa`다. 비공개 적재 원장은 실행 및 재검증 revision·시각을 기록한다. `.env`·인증정보·DB 덤프·개인 원장은 Git에 포함하지 않는다.

## 보류와 재현

원래 입력 2·8은 같은 최종 URL을 가리키지만 공식 상품 식별과 전달된 상품 설명이 충돌한다. 입력 5·9는 상품 본문을 확인하지 못했다. 이 4개 참조는 등록하지 않았다.

등록한 후보 1건의 BEIGE 색상은 공식 대표 사진 관찰에 근거하며, 해당 링크가 실제 구매한 옵션을 고정한다는 증거는 없다. 이 한계를 비공개 상품별 원장에도 기록했다. 사진 저장 검증이 구매 옵션 검증을 의미하지 않는다.

로컬 화면: http://localhost:5173 → 마이 → 내 계정 → 시연용 로그인 → 옷장. 기존 화면의 오래된 목록이 남아 있으면 새로고침 후 다시 로그인한다.

같은 로컬 DB·비공개 계획에서 멱등 검증:

```powershell
python scripts/import_owned_garments.py --plan data/imports/owned-plan-20261009.json --with-images --replace-seed --execute
```

이미 동의가 기록됐으므로 재실행에 `--grant-image-consent`를 반복해서 사용할 필요가 없다. 비공개 계획과 원장을 다른 DB에 그대로 복사해 동일 결과를 보장하지 않으며, 클라우드 이전은 별도 작업이다.
