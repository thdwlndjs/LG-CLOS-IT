# ASSET_PLAN

검사일: 2026-10-11 (KST)  
검사 저장소/브랜치: LG-CLOS-IT / main / c17e5e6  
실행 범위: P0 저장소 읽기, P1 공식 제품 조사, P2 설계·CSV 작성만  
신뢰 수준: verified=파일/공식 페이지 확인, proposed=미승인 설계, blocked=근거·권한 부족  
미확인 사항: 실행 DB 현황, 배포 상태, 실기기, 유료 VTON, 신규 화면 E2E, 이미지 재사용 허가.  
DB 연결·적재·마이그레이션·제품 코드/운영 에셋 수정·원격 push·배포 없음.

## 実画像確認

제공 이미지 5개를 실제로 육안 확인했다. 의류 이미지를 상품 특정이나 소유 증명에 사용하지 않는다.

| 원본 | 크기 | SHA256 |
|---|---|---|
| T1_reference.png | 1440x1800 | `96cf9617bdcbb859915073610333f011da32840de4020a77d92f1398dcffe39c` |
| T2_reference.png | 1440x1800 | `c156e925a80f4b974d4a5f565661d59eabed2ada641502ca18793878d4961c61` |
| T3_reference.png | 1440x1800 | `d390f7f950a5e38731126762b25839c99f4b438d53926985eb4c4137fa5faece` |
| T4_reference.png | 1440x1800 | `9d1fc74f050bc774ded943e729080f342ba7d7c2fc95b5216f80ac327ebc6554` |
| wardrobe_ui_original.png | 1920x1080 | `6b8ad5c98d71fa8380557f0dc307536e25da351e109ef815167158e13fa42b37` |

옷장 원본에는 Chrome UI/주소창/작업표시줄, 고정 의류 픽셀, 중앙 UI가 들어 있다. clean plate가 아니다. 중앙 거울의 방·커튼·식물 반사 효과는 보존 대상이다. 먼저 원본 옷장 사진/사용 허가를 확보하고 브라우저·DOM 텍스트와 의류 영역 제거 마스크를 분리한다. 원본 확보 실패 시 재구성 영역과 생성/편집 이력을 명시하고 사용자 시각 승인을 받는다. 이번에는 제거·생성하지 않았다.

## 카드별 관찰과 작업

| 카드 | 관찰 | 독립 작업/Gate A |
|---|---|---|
| T1 | 버건디 니트/대각 검정 바지/좌측 가방·신발, 제목·하단 어둠 | 독립 bbox/transform/alpha/z 및 바지-상의 겹침, 텍스트 마스크 |
| T2 | 중앙 토글 외투와 큰 겹침, 검정 소품 | 외투 털·지퍼·가림 마스크; 숨은 부분 복원 불확실성 기록 |
| T3 | 중앙 후드 패딩/갈색 하의/모자·장갑, 강한 방향 그림자 | 후드 내부 모자 깊이와 별도 광원/그림자 레이어 |
| T4 | 펼친 후디/중앙 큰 백팩/하의·검정 신발·모자 | 소매와 백팩 가림 순서, 독립 geometry; 로고 보존 |

가려진 실제 픽셀을 무손실 복원할 수 없다. 텍스트와 어두운 오버레이 제거는 원본 질감 전체를 평탄화하는 작업과 구분한다. 기준 픽셀 좌표·가림 경계는 아직 측정하지 않았으므로 CSV 좌표를 공란으로 두었다. 카드 참고 이미지의 로고는 정확한 품번/권한 근거가 아니다.

Gate A: 템플릿마다 독립 마스크·좌표·변환·복원 영역·샘플 PNG와 원본 대조 승인. Gate B: 승인된 보유 상품 이미지 치환, 로고/색/패턴/실루엣/겹침/배경 누출 평가. Gate C: 배포 환경 React+Playwright PNG 생성→asset 저장→read_url 조회→공유 품질/메모리/시간 검증. 현재 renderer/src/template.mjs:6의 minimal-v1 job pipeline은 보존하되 평균 CSS 4종 변형으로 대체하지 않는다.

## 에셋 생산·폴백

원본→checksum/권한→cutout→hanger/folded/card 파생→슬롯 레이어. asset_manifest.csv의 source_asset_id로 이력 연결. 없는 접힘/뒤쪽을 생성하면 edited/generated 및 도구·버전·프롬프트·부정확 영역을 기록한다. 품질 실패는 manual-review-required 또는 unmodified-cutout; 동의 없는 대체품/로고 변경으로 통과하지 않는다. 원본 라이선스 미해결이면 공개 배포/파생 생산 gate blocked.

각 파생물은 새 asset ID와 불변 key 사용. garment.image_asset_id는 기존 대표 이미지, 추가 파생은 승인 후 attributes 내 versioned asset map 또는 정규화 선택. Signed URL을 manifest/DB에 박제하지 않는다. A–G 구획+선반+슬롯 계층을 측정하고 lighting_zone이 구획 단위라면 한 벌만 실제 점등했다고 표기하지 않는다.

이번 검증: 5개 로컬 PNG 육안·크기·SHA256, 공식 이미지 링크 일부 확인. clean plate/컷아웃/렌더 PNG/권리/브라우저 품질/모바일 회귀는 미검증.
