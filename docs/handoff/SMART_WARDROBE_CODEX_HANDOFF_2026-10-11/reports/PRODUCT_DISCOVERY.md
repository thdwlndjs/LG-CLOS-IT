# PRODUCT_DISCOVERY

검사일: 2026-10-11 (KST)  
검사 저장소/브랜치: LG-CLOS-IT / main / c17e5e6  
실행 범위: P0 저장소 읽기, P1 공식 제품 조사, P2 설계·CSV 작성만  
신뢰 수준: verified=파일/공식 페이지 확인, proposed=미승인 설계, blocked=근거·권한 부족  
미확인 사항: 실행 DB 현황, 배포 상태, 실기기, 유료 VTON, 신규 화면 E2E, 이미지 재사용 허가.  
DB 연결·적재·마이그레이션·제품 코드/운영 에셋 수정·원격 push·배포 없음.

## 조사 결과

13개 후보를 조사했다. 11개는 공식 페이지 본문 또는 공식 검색 추출에서 모델·색·소재를 확인했고, PC12·13은 미검증 또는 식별 불일치다. 모든 후보는 미승인이다. 공식 이미지 사용 권한은 전건 미해결이며, 상품 실재 확인은 소유·권리·적재 승인을 뜻하지 않는다. 검색 결과에는 캐시가 포함되어 현재 가격·재고·국내 판매를 보증하지 않는다.

| 시연 목적 | 후보 | 확인 사실/남은 조건 |
|---|---|---|
| 엄마 여름 보관 3개 | PC01 탱크, PC02 쇼츠, PC03 반팔 | 형태·소재 확인. 여름 사용은 추론이며 사용 기록 없음 |
| 겨울 회수 2개 | PC04 엄마 다운, PC05 아들 다운 | 공식 다운 소재 확인. 소유자·외부 위치는 합성 시연 제안 |
| 아들 기본 코디 | PC06 반팔, PC07 플리스, PC08 검정 데님, PC11 신발 | 제품 후보이며 실제 보유 등록 전 추천/VTON 입력 금지 |
| 등록 소품 | PC09 백팩, PC10 비니, PC11 신발, PC12 장갑 | 장갑은 상품 본문 조회 실패. 비니는 야구모자 대체 완료가 아님 |
| 추가 니트 | PC13 캐시미어 | URL 품번·표시 품번·feature 이미지 품번 불일치로 적재 금지 |

## 공식 출처와 함정

후보별 URL·검사일·사실·상태·이미지 링크는 [product_candidates.csv](../templates/product_candidates.csv)에 기재했다. 제품별 facts를 variant 단위로 보존하고 query 값으로 색상을 추측하지 않았다.

- PC01: [공식 탱크](https://www.patagonia.com/product/womens-capilene-cool-daily-tank-top/45296.html?cgid=womens-tops-tanks-sleeveless). 실제 본문 AQBX/45296, 폴리에스터 100%(재활용 50%). 이미지 링크는 1×1 placeholder로 원본 확보 실패.
- PC02: [공식 쇼츠](https://www.patagonia.com/product/womens-baggies-shorts-5-inch/57059.html?cgid=web-specials-womens&dwvar_57059_color=CNGR). 57059/Canopy Green, 본체 재활용 나일론. 검색 추출 검증이며 원본 이미지 미확보.
- PC03: [공식 반팔](https://www.patagonia.com/product/womens-capilene-cool-daily-shirt/45226.html?cgid=web-specials-womens&dwvar_45226_color=FEA). 요청 FEA와 달리 본문 PCHS, 45226. 확인된 Peach Sherbet만 기록.
- PC04: [여성 다운](https://www.patagonia.com/product/womens-down-sweater-jacket/195699583979.html). 84684/Marion Red, 재활용 나일론 쉘·다운. 원본 이미지 확보 별도.
- PC05: [남성 다운](https://www.patagonia.com/product/mens-down-sweater-insulated-jacket/84675.html?dwvar_84675_color=BLK). 84675/Black, 나일론 쉘·다운. T3의 후드 패딩과 동일 상품으로 보지 않음.
- PC08: [501 데님](https://www.levi.com/US/en_US/clothing/men/jeans/straight/501-original-mens-jeans/p/005012456). 본문 Punk Rock 검정/면99%·엘라스테인1%. swatch 링크는 다른 00501-3719 모델이어서 미채택.
- PC09: [백팩](https://www.patagonia.com/product/black-hole-pack-25-liters/49298.html?cgid=web-specials-packs-gear&dwvar_49298_color=PGTA). 요청 PGTA와 달리 본문 Noble Grey NGRY. T4의 COVERNAT 가방이 아님.
- PC11: [1461 신발](https://www.drmartens.com/us/en/1461-smooth-leather-oxford-shoes-black/p/11838002). Black/11838002/Smooth leather. 공식 CDN 이미지 URL 확인했으나 공개 이용 허가는 미확인.

## 카드 품목과 규모 제안

T1의 버건디 크루넥 니트·슬랙스·벨트, T2의 털 트리밍 토글 외투, T3의 후드 패딩·갈색 바지, T4의 네이비 후디·야구모자·데님·백팩을 모두 확보한 것은 아니다. 카드 사진의 상표만으로 정확한 SKU를 만들지 않았다. 부족한 역할별 대체는 최대 2개까지 추후 조사하며 Gate B는 해소 전 blocked다. PC07 플리스를 울 니트로, PC10 비니를 야구모자로 바꾸어 통과 처리하지 않는다.

엄마·아들 2명을 최초 최소셋으로 제안한다. PC01–05 + 권리 확보된 아들 1룩을 첫 승인 단위로 하고 기존 실제 고객 보유 의류는 유지한다. 4인/51개/내부35+외부8+소품8은 전부 미승인이다. 13후보 자체도 일괄 적재 수량 확정이 아니다. 실제 사용 이력·세탁·구매·위치를 임의 생성하지 않는다.

## 검증 수준

공식 본문 open 확인: PC01/03/08/09/10/11. 공식 검색 추출 확인: PC02/04/05/06/07. PC12는 open 시 대기 페이지로 실패했고 소재·색을 공란으로 유지. PC13은 표시 식별 불일치로 blocked. 제품 사진 원본 해상도·허가·모든 variant canonical URL은 추가 검증 필요. 공식 이미지 대량 다운로드는 하지 않았다.
