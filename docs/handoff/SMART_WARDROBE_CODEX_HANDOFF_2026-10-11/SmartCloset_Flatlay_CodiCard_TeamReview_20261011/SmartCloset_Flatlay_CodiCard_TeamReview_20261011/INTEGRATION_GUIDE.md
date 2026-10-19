# 기존 팀 웹 통합 안내

이 ZIP은 **독립 실행·검토용 모듈**입니다. `https://lg-clos-it.vercel.app/`에 통합하거나 배포한 소스가 아닙니다. 팀 저장소·배포 브랜치·프로필/의류/자산/코디의 실제 ID와 저장 API는 아직 확인되지 않았습니다. 아래는 확인된 모듈 계약과 통합 지점입니다. 팀의 실제 목적 파일명이나 DB 스키마를 추정하지 않습니다.

## 1. 가져올 범위와 실행 상태

| 파일 | 역할 | 팀 통합 시 처리 |
|---|---|---|
| `src/card-core.mjs` | 선택·슬롯 교체·자동 배치·불변 조합 snapshot·추천 제안 검사 | 기존 코디 초안에서 호출하는 순수 모듈로 연결 |
| `src/card-renderer.mjs` | Canvas 표시·실제 알파 범위·PNG 출력·공급자용 참조 준비 | 팀 자산 URL/버전과 연결. 원본 사진·피팅 입력을 덮어쓰지 않음 |
| `src/local-session.mjs` | 프로필별 초안/카드를 브라우저 localStorage에 보존 | 독립 시연용. 팀 저장을 이 파일로 교체하지 않음 |
| `src/app.mjs`, `index.html`, `style.css` | 모듈을 조작하는 검수 화면 | 동작 예제만 참고. 팀의 6메뉴·미러 화면 전체에 덮어쓰지 않음 |
| `server.mjs` | Node 내장 HTTP 정적 서버 | 로컬 실행용. API 프록시·인증·DB 서버가 아님 |
| `reference/prototype/data/demo-pack.json`, `reference/prototype/assets/*.webp` | 허구 프로필/의류·제공된 시연 이미지 | 검토용 자료. 운영 데이터에 일괄 적재하지 않음 |
| `reference/prototype/api/openai-recommendation.mjs` | 원본 준비팩의 서버용 Responses 참고 함수 | 앱에서 import/실행하지 않음. 현재 연결된 API로 취급하지 않음 |
| `tests/*.test.mjs`, `tests/browser-check.mjs` | 모듈 계약·브라우저 검수 | 팀의 기존 검사에 추가할 참고 범위 |

실행에 외부 npm 패키지는 필요 없습니다. ES modules, 브라우저 Canvas/Image/FontFaceSet/localStorage와 Node.js 22 이상을 사용합니다. Playwright는 선택적 브라우저 검수 도구이며 제품 실행 의존성이 아닙니다. 최신 패키지에 포함된 실제 검사 결과는 `evidence` 및 `README_FIRST.md`를 따르십시오.

## 2. 기존 코디와 마이에 연결

- **코디의 현재 초안**: 선택한 의류를 정규화해 `replaceSlot`과 `snapshot`에 전달합니다. 카드 탐색/의류 조합/전신 비교 전환은 같은 초안 ID·revision을 유지합니다. 상의 선택은 상의만 교체합니다. 원피스를 선택하면 상·하의를 대체하는 현재 모듈 계약을 확인하십시오.
- **내 코디 저장/재조회**: snapshot을 팀의 기존 저장 형식으로 매핑합니다. 저장할 조합은 이미지 파일만이 아니라 실제 `kind + itemId`, 프로필, 자산 ID/버전, 원본 카드 ID/버전, 배치 정보입니다. PNG 생성 실패가 조합 저장 실패나 두 번째 카드 생성으로 이어지지 않도록 분리합니다.
- **마이의 기존 프로필 선택**: 팀 서버가 현재 로그인 계정에 허용한 프로필만 후보 목록에 넣습니다. 프로필마다 초안/카드 문맥을 분리합니다. 프로필 변경 전에 시작된 이미지/추천/피팅 응답은 새 프로필에 적용하지 않습니다.
- **재사용**: 과거 카드를 그대로 수정하지 않고 새 초안으로 엽니다. 변경 없는 저장은 기존 카드 참조를 재사용할 수 있고, 조합이 달라지면 새 카드로 저장합니다. 과거 기록과 카드의 품목/자산 버전을 보존합니다.

이 모듈에는 팀 홈·달력·LED·실제 착용 기록 UI가 없습니다. 해당 기능을 새로 만든 것으로 보고하지 않습니다. 독립 실행본의 화면과 CSS를 복사해 기존 미러 UI를 대체하지 마십시오.

## 3. ID·자산 대응 계약

`evidence/id-mapping-pending.json`에 시연 프로필 2개와 항목 34개(가상 보유 32개 + 외부 후보 2개)의 출처가 기록되어 있습니다. **team ID는 모두 null**이며 실제 매핑 완료를 뜻하지 않습니다. 이미지 파일은 32개이고 외부 후보는 제공된 시연 이미지를 재사용합니다.

시연 ID `flatlay-demo:*`, 원본 팩 코드 `T01`/`S01`/`H01`, `legacy48:*` 자산 ID를 팀의 Auth/프로필/의류/자산 ID로 그대로 적재하지 않습니다. 특히 raw 코드나 같은 사진만으로 소유자·실물·LED 동일성을 판단하지 않습니다.

정규화 입력은 다음 구조입니다. `id`, `profileId`, `assetId`, 버전은 **확인된 팀 조회 결과**에서 가져와야 합니다.

```js
// card-core.mjs가 받는 한 항목
{
  id, profileId,
  kind: 'owned', // 외부 구매 후보는 'external'
  slot: 'top',   // outer/top/dress/bottom/shoes/bag/hat/accessory
  name,
  sourceVersion: versionOrNull,
  assetId: assetIdOrNull,
  assetVersion: assetVersionOrNull,
  colors: []     // makeApiContext에서 사용하는 선택적 메타데이터
}

// assetId를 키로 갖는 자산 사전
{
  [assetId]: {
    url,           // url/path/src 중 하나. 실제 브라우저에서 읽을 수 있어야 함
    width, height, // 양수 원본 픽셀 크기
    version,
    alphaBounds    // 선택적 {x,y,width,height}; 원본 파일 수정용 아님
  }
}
```

`alphaBounds`는 픽셀 기준이며 `{normalized:true, x,y,width,height}`도 허용합니다. 렌더러는 파일의 실제 알파를 다시 확인하고 의류의 비율·색·불투명도를 유지합니다. 버전은 문자열/숫자를 섞지 말고 항목과 자산에서 동일하게 정규화하십시오. 사진 없는 항목은 선택과 ID를 유지하고 명시적으로 사진 없음을 표시합니다. 다른 옷 사진으로 대체하지 않습니다.

프로필별 동일 상품 인스턴스와 외부 후보는 구별해야 합니다. `itemKey(item)`은 `JSON.stringify([item.kind, item.id])`입니다. 같은 raw ID의 보유·외부 항목도 서로 다릅니다. 현재 모듈은 **슬롯당 한 항목**을 허용하며, 팀이 한 슬롯의 여러 의류를 지원한다면 이 제약을 먼저 검토해야 합니다.

원본 자산의 hash·출처·표시용 파생 이미지 관계는 제공 JSON에 남아 있습니다. 원본 팩 전체를 새로 만들거나 팀의 기존 사진/라벨/물리 위치/LED/케어/착용 이력을 null로 덮어쓰지 않습니다. 이 ZIP의 시연 항목에는 검증된 실물 위치/LED/케어 근거가 없습니다.

## 4. 확인된 모듈 함수

| 함수 | 입력 → 반환 / 주의 |
|---|---|
| `itemKey(item)` | `{kind,id}` → 문자열 복합 키 |
| `assertItems(items, profileId)` | 허용 슬롯·프로필·중복·원피스 충돌 검사, 실패 시 throw |
| `replaceSlot(items, item, profileId)` | 기존 배열을 변경하지 않고 교체한 새 배열 반환 |
| `layout(items, assets = {}, variant = 'natural')` | 정규화 배치 배열. `natural`/`ordered` |
| `snapshot(draft, items, assets = {})` | 깊게 freeze된 조합. 빈 조합은 `EMPTY_OUTFIT` |
| `captureRevision(draft, generation = 0)` | 프로필·초안·revision·generation 토큰 |
| `isCurrentRevision(token, draft, generation = 0)` | 현재 문맥과 일치 여부 |
| `makeApiContext(draft, items, catalog, profile, {lockedSlots = [], generation = 0} = {})` | 허용 후보/선택/고정 조건. `executionApproval:false`이며 실행 승인이 아님 |
| `validateProposal(context, proposal, currentToken)` | 허용 후보·고정 조건·revision 검사 후 후보 반환. 자동 적용/저장 없음 |
| `renderCard(canvas, snapshot, assets, options = {})` | Promise<boolean>. 오래된 렌더 false. `isCurrent`, `onDiagnostics` 지원 |
| `exportCard(snapshot, assets)` | Promise<{blob,diagnostics}>. PNG 1080×1350. 저장 부수효과 없음 |
| `renderProviderReference(canvas, snapshot, assets, options = {})` | 장식/문자/카드 배경/그림자 없는 참조 준비. 실제 API 호출 없음 |

초안의 필드는 `{id, profileId, revision, title, variant, background, sourceCardId, sourceCardVersion}`입니다. `title`은 빈 문자열을 허용하고 실제 품목 이름으로 제목을 만듭니다. `background`는 `sand`/`mist`/`transparent`, `variant`는 `natural`/`ordered`입니다. `layout` 좌표의 x/y는 중앙 위치, width/height는 크기를 1080×1350으로 나눈 값입니다. rotation은 도, z는 겹침 순서입니다.

snapshot에는 위 출처 외에 `schemaVersion`, `compositionKey`, `items`, `layoutVersion`, `layoutVariant`, `titleSource`, `createsWearEvent:false`, `createsPlanEvent:false`가 포함됩니다. `compositionKey`는 안정적 직렬화 식별값이며 암호학적 hash·서버 권한·영구 멱등성 보장값이 아닙니다.

추천 제안 형식은 `{profileId,draftId,revision,itemKeys:[...]}`입니다. 서버 응답을 이 형식으로 검증한 뒤 현재 revision을 다시 비교하고 사용자가 고른 변경만 적용해야 합니다.

### 최소 호스트 연결 예

다음은 **현재 팀 코드의 함수명이 아닌 연결 위치 예제**입니다. `draft`, `selected`, `candidate`, `assets`, `generation`은 팀이 권한 확인한 데이터로 위 계약에 맞춰 준비합니다. 새 ID나 가상 계정을 생성하지 않습니다.

```js
import {
  replaceSlot, snapshot, captureRevision, isCurrentRevision
} from './flatlay/card-core.mjs';
import { renderCard, exportCard } from './flatlay/card-renderer.mjs';

// 팀의 의류 선택 이벤트에서: 다른 슬롯은 그대로 유지
selected = replaceSlot(selected, candidate, draft.profileId);
draft = { ...draft, revision: draft.revision + 1 };
const snap = snapshot(draft, selected, assets);
const token = captureRevision(draft, generation);
await renderCard(canvas, snap, assets, {
  isCurrent: () => isCurrentRevision(token, draft, generation),
  onDiagnostics: showImageErrors,
});

// 명시적 저장 버튼에서 snap을 기존 팀 저장 계약에 변환해 저장합니다.
// 서버는 actor/profile/품목 권한과 중복 operation을 독립적으로 검증합니다.
// 명시적 PNG 버튼에서만 실행하며 저장 또는 VTON을 자동 실행하지 않습니다.
const { blob } = await exportCard(snap, assets);
```

`LocalSession`은 `new LocalSession({data:{profiles,items,assets},storage,key})`로 생성합니다. `storage`는 `getItem`/`setItem`을 갖습니다. `draft()`, `selected()`, `cards()`, `choose(itemKey)`, `remove(itemKey)`, `update({title,variant,background})`, `switchProfile(id)`, `save()`, `reuse(cardId)`, `revisionToken()`, `accepts(token)`을 제공합니다. `save()`는 `{card,created}`를 반환합니다.

이 클래스는 동기 로컬 저장 전용입니다. 원격 저장을 `localStorage`처럼 위장하거나 비동기 fetch를 `setItem`에 삽입하지 마십시오. 팀의 기존 저장 서비스에 별도 호스트 어댑터를 연결하고 로딩·실패·재시도·중복 작업 상태를 기존 방식으로 표시해야 합니다. 시연 저장의 손상/다른 탭 충돌 감지는 단일 브라우저 보호이며 원격 트랜잭션이나 다중 탭 원자적 CAS를 보장하지 않습니다.

## 5. 홈·달력·VTON에 연결할 경계

| 기존 기능 | 전달할 내용 | 보존 조건 |
|---|---|---|
| 홈 추천/코디 카드 | 같은 프로필의 저장 snapshot 또는 현재 초안 조합 | 추천 표시가 좋아요/저장/오늘 선택/실착을 자동 생성하지 않음 |
| 오늘 선택 → 달력 | 기존 팀의 선택 기록에 같은 품목 ID와 카드/초안 출처 연결 | 카드 저장과 오늘 선택, 실제 착용은 각각 별도 동작 |
| 과거 날짜 코디 재사용 | 과거 snapshot에서 새 초안 생성 | 과거 기록·원본 카드 수정 금지 |
| VTON 요청 | 같은 snapshot의 품목/자산 버전 + 승인된 인물/입력 계약 | 카드 PNG를 실제 의류 입력으로 무조건 제출하지 않음 |
| VTON 결과 표시/저장 | 요청 프로필·초안/revision·인물·조합 식별과 연결 | selected/requested/rendered를 구분. 오래된 응답을 최신 선택처럼 표시하지 않음 |
| 위치 LED/케어/이력 | 팀의 기존 실제 의류 ID로 조회 | 외부 후보·시연 ID를 실제 보관 위치나 착용 기록에 승격하지 않음 |

`renderProviderReference`는 `options.assetPolicy(asset,item,snapshot)`이 확인된 서버 정책을 반영해 `{approved:true}`를 반환해야 동작합니다. 빈 승인 콜백을 만들어 차단을 우회하지 않습니다. 이 함수의 Canvas 성공은 공급자 입력 호환성·인물 동일성·실제 피팅 성공의 증거가 아닙니다.

## 6. OpenAI·Decart: 구현과 미연결을 구분

**이 독립 실행본의 유료 호출은 0회입니다. 실제 OpenAI 응답/Decart 결과가 없고 mock 결과를 성공으로 보여주는 경로도 없습니다.** 시작·선택·저장·PNG는 로컬에서만 처리됩니다. `server.mjs`는 GET/HEAD 정적 파일만 허용하고 공급자 요청 endpoint가 없으며 실제 `.env`를 읽지 않습니다. `.env.example`에 값을 넣는 것만으로 API가 연결되지 않습니다.

현재 API 관련 구현은 코어의 입력 문맥/결과 검증과 렌더러의 장식 없는 참조 준비입니다. 별도로 포함된 준비팩의 `requestRecommendation(context,config,gate)`는 **사용하지 않는 참고 코드**이며 실제 HTTP 요청 코드가 있으므로 팀 서버에 무조건 복사해 실행하지 마십시오.

그 참고 helper는 bare `id`로 후보를 비교하지만 현재 코어는 `kind + id`를 사용합니다. 보유/외부 ID가 충돌할 수 있는 팀 데이터에서는 요청별 고유 후보 토큰 ↔ 실제 복합 키 대응을 만들고 서버에서 검증하는 추가 연결이 필요합니다. 원본 helper를 그대로 붙여 형식이 호환된다고 가정하지 않습니다. 참조 함수는 `authorizeAndReserve`, `markSubmitted`, `markComplete`, `markUncertain`, `markFailed`의 **실제 영속 승인/비용 원장 구현**을 요구하며 이 ZIP에는 팀용 구현이 없습니다.

팀의 기존 Agents/Responses/Decart 공급자·모델·저장·인증 경로를 먼저 확인하고 유지해야 합니다. 과거 별도 복원본을 읽은 기록인 `evidence/api-audit.md`는 팀 구현의 증거가 아닙니다. 이번 인계는 새 유료 실행 승인이 아닙니다. 키 존재만으로 실행하지 않습니다.

실연동 전에 필요한 사항은 다음과 같습니다.

1. 배포와 대응하는 팀 저장소·브랜치, 실제 서버 경로와 프로필/자산/카드 저장 계약.
2. 기존 OpenAI USD 1·Decart USD 1 총 승인 범위의 현재 사용액·미정산액·남은 한도, 고정 모델/모드·단건/누적/시간/재시도 제한. 새 USD 1씩으로 재설정하지 않음.
3. 승인된 인물 및 의류 자산 ID/버전·공급자 전송 범위. 시연 이미지의 `providerPermission`은 이 실행에 미확인 상태.
4. 팀 서버에서 사용자 권한·예산 예약·operation 중복·불명확 제출/정산 상태를 처리하는 기존 경로. 영구 키는 서버에서만 취급하고 브라우저/ZIP/로그에 넣지 않음.

실제 호출을 하게 되는 후속 작업에서는 OpenAI의 후보/고정 조건·늦은 응답을 검사하고, Decart는 같은 인물·고정 하의·교체 상의가 실제 영상에 유지되는지 확인해야 합니다. 현재는 이 부분이 미실행입니다. 팀원이 ZIP을 실행하는 단계에는 필요하지 않습니다.

## 7. 충돌 점검과 안전한 통합 순서

1. 팀 소스/배포 커밋을 확인하고 관련 작업 브랜치에서 기존 코디·마이·저장 동작을 기록합니다. 기존 DB/인증을 교체하거나 새 운영 테이블을 먼저 만들지 않습니다.
2. 순수 모듈 2개를 팀의 내부 모듈 경로로 가져온 뒤 위 정규화 어댑터를 작성합니다. 팀의 enum/부분 코디/한 슬롯 다중 품목·자산 버전·인물 소유 권한을 대조합니다.
3. 팀 기존 화면에서 Canvas·선택·저장·재사용만 연결합니다. 시연 `style.css`는 범용 selector가 있으므로 전역 import하지 않습니다. 필요한 UI 스타일은 팀의 컴포넌트 범위 안에 적용합니다. 샘플 화면 ID와 팀 DOM ID 충돌을 피합니다.
4. 팀의 자산 URL 만료/권한·CORS를 확인합니다. 렌더러는 `crossOrigin='anonymous'`를 사용하므로 인증 쿠키만 필요한 이미지나 CORS 미허용 원본은 PNG가 실패할 수 있습니다. 기존 권한 있는 자산 전달 경로를 사용하며 무권한 공개화로 우회하지 않습니다.
5. 저장/재조회 어댑터를 연결하고 프로필 왕복·새로고침·원본 보존·버전 충돌·같은 operation 재시도를 확인합니다. 브라우저의 `profileId`/`compositionKey`만 믿고 원격 쓰기를 허용하지 않습니다.
6. 같은 snapshot을 홈/달력/VTON에 연결하고 기존 사진·LED·케어·이력 회귀검사를 합니다. 실제 API 시험은 위 조건을 충족한 별도 명시 동작에서만 진행합니다.
7. 팀의 승인된 원격/배포 정책 확인 후 검토 브랜치로 공유합니다. 이 ZIP 수령이나 로컬 실행을 merge·운영 배포 승인으로 해석하지 않습니다.

독립 시연의 자동 배치·교체·저장·재사용·PNG·프로필/재시작 검사를 통과했더라도 팀 인증·DB·LED·홈·달력·실제 API의 통합 검사가 통과한 것은 아닙니다. 현 시점의 미완료 범위는 팀 소스 매핑·원격 저장·관련 메뉴 연결·실제 공급자 호출/피팅 결과 검증입니다.
