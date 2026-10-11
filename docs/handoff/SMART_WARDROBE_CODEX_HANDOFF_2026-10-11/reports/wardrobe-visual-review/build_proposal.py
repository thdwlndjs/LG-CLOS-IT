"""Approval-only catalogue and native HTML placement diagram; never connects to the app DB."""

import hashlib
import html
import json
from pathlib import Path
from shutil import copyfile

import httpx

ROOT = Path(__file__).resolve().parents[5]
OUT = Path(__file__).resolve().parent
CACHE = ROOT / "test-results/remediation/visual-proposal"
REFERENCE = ROOT / "web/public/assets/mirror-final/wardrobe-base-led-off.png"
REFERENCE_SHA = "abc5cdf750a55f8054ddf1c8d77875d3c99d2006ebeffc2e211f169dbd521a26"

# Human proposal, not inventory, purchase history, or existing physical slot assignments.
CHOICES = [
    ("A1", "엄마", "women-new-arrivals", "(W) WOOL TAILORED DOUBLE-BREASTED MAXI COAT_ CAMEL"),
    ("A2", "아빠", "men", "FELTED WOOL TAILORED COAT_ CHARCOAL"),
    ("A3", "휘재", "men", "HERRINGBONE WOOL RAGLAN OVERCOAT_ PATINA TAUPE"),
    ("A4", "휘재", "men", "HERRINGBONE WOOL DOUBLE-BREASTED COAT_ MOSS BROWN"),
    ("A5", "휘재", "men", "WOOL AND CASHMERE DOUBLE-BREASTED COAT_ BLACK"),
    ("A6", "휘재", "men", "WOOL AND CASHMERE TAILORED COAT_ DEEP BROWN"),
    ("A7", "엄마", "women-new-arrivals", "(W) HIGH-NECK BELTED WOOL COAT_ HEATHER GREY"),
    ("B1", "휘재", "men-shirts-tops", "HIGH DENSITY STRIPED COTTON SHIRT_ WHITE"),
    ("B2", "휘재", "men-shirts-tops", "HIGH DENSITY STRIPED COTTON SHIRT_ SKY COBALT"),
    ("B3", "휘재", "men-shirts-tops", "DENIM WESTERN SHIRT_ VINTAGE INDIGO"),
    ("B4", "휘재", "men", "WOOL FLANNEL BELTED STAND COLLAR BOMBER_ CHARCOAL ANTHRACITE"),
    ("B5", "휘재", "men", "HIGH NECK MERINO WOOL BUTTON-UP KNITTED BLOUSON_ TAUPE"),
    ("B6", "휘재", "men", "LEATHER COLLAR PADDED HUNTING JACKET_ BLACK"),
    ("C1", "휘재", "men-denim", "SLIM-STRAIGHT DENIM JEANS_ RINSED BLACK"),
    ("C2", "휘재", "men-trousers", "CROSS TUCK WIDE TROUSERS_ GREY PINSTRIPE"),
    ("C3", "휘재", "men-trousers", "COTTON DRILL PLEATED CHINO PANTS_ NAVY"),
    ("C4", "휘재", "men-trousers", "COTTON DRILL PLEATED CHINO PANTS_ BEIGE"),
    ("C5", "휘재", "men-trousers", "RE-CUT WIDE LEG CARGO PANTS_ BLACK"),
    ("C6", "휘재", "men-denim", "LOOSE STRAIGHT BUCKLE-BACK JEANS_ ECRU"),
    ("C7", "휘재", "men-trousers", "FLOCKED DENIM LOOSE FLARED PANTS_ BROWN"),
    ("C8", "휘재", "men-trousers", "WOOL CARPENTER TROUSERS_ NAVY"),
    ("K1", "아빠", "men-knitwear", "MERINO WOOL HALF-ZIP JUMPER_ SAND"),
    ("K2", "아빠", "men-knitwear", "MERINO WOOL HALF-ZIP JUMPER_ NAVY"),
    ("K3", "아빠", "men-knitwear", "SUPER FINE MERINO WOOL CREW-NECK KNIT_ CHARCOAL"),
    ("K4", "아빠", "men-knitwear", "WOOL AND CASHMERE LAYERED KNIT_ NAVY/GREY"),
    ("K5", "아빠", "men-knitwear", "SHETLAND WOOL RAW CARDIGAN_ SAGE GREEN"),
    ("K6", "아빠", "men-knitwear", "BRUSHED SHAGGY DOG V-NECK KNIT_ CAMEL"),
    ("K7", "엄마", "women-knitwear", "(W) WOOL BLEND OVERSIEZED TURTLENECK_ ECRU/BEIGE"),
    ("K8", "엄마", "women-knitwear", "(W) WOOL BLEND CREW-NECK KNIT_ GREY"),
    ("K9", "엄마", "women-knitwear", "(W) SUPERFINE MERINO WOOL RIB CARDIGAN_ BLACK"),
    ("K10", "딸", "women-knitwear", "(W) SUPERFINE WOOL CROPPED SWEATER_ WARM GREY"),
    ("K11", "딸", "women-knitwear", "(W) CONVERTIBLE RIB-BAND KNIT TOP_ IVORY"),
    ("K12", "딸", "women-knitwear", "(W) MOHAIR BLEND RAGLAN CARDIGAN_ GREEN"),
]


def main():
    assert hashlib.sha256(REFERENCE.read_bytes()).hexdigest() == REFERENCE_SHA
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "candidate-photos").mkdir(exist_ok=True)
    copyfile(REFERENCE, OUT / "reference-unchanged.png")
    items = []
    with httpx.Client(timeout=40, follow_redirects=True) as client:
        for item_id, persona, collection, title in CHOICES:
            data = json.loads((CACHE / f"{collection}.json").read_text(encoding="utf-8"))
            matches = [p for p in data["products"] if p["title"].casefold() == title.casefold()]
            if len(matches) != 1:
                raise ValueError(f"Unresolved official product: {item_id}: {title}")
            product = matches[0]
            image_index = -4 if item_id == "B5" else -2
            image_url = product["images"][image_index]["src"]
            separator = "&" if "?" in image_url else "?"
            downloaded = client.get(image_url + separator + "width=450")
            downloaded.raise_for_status()
            extension = ".png" if "png" in downloaded.headers.get("content-type", "") else ".jpg"
            image_path = "candidate-photos/" + item_id + extension
            (OUT / image_path).write_bytes(downloaded.content)
            items.append(dict(
                id=item_id, proposed_persona=persona, brand=product["vendor"],
                title=product["title"], official_url="https://tonywack.tv/products/" + product["handle"],
                evidence_url="https://tonywack.tv/collections/" + collection,
                checked_on="2026-10-11", source_product_id=str(product["id"]),
                official_photo_url=image_url, local_photo=image_path,
                photo_sha256=hashlib.sha256(downloaded.content).hexdigest(),
                status="CANDIDATE_NOT_IMPORTED", ownership_basis="proposed_demo_only",
            ))
    hooks = {
        "A": ([120, 157, 192, 229, 266, 303, 341], 145),
        "B": ([434, 477, 517, 559, 603, 645], 145),
        "C": ([429, 460, 491, 523, 555, 587, 618, 650], 497),
    }
    placements = [dict(id=letter + str(i + 1), hook_x=x, hook_y=y,
                       kind="coat" if letter == "A" else "short_top" if letter == "B" else "pants",
                       geometry_basis="manual trace of original; not sensor observation")
                  for letter, (xs, y) in hooks.items() for i, x in enumerate(xs)]
    # Each stack has three visible layers, with original layer contours retained later.
    stacks = []
    for cabinet, xs, rows in (
        ("D", [126, 249], [(772, 844)]),
        ("E", [1007, 1130], [(99, 150), (215, 266), (328, 385), (440, 503)]),
        ("F", [1309, 1431], [(99, 150), (214, 266), (328, 385), (440, 503),
                             (552, 615), (658, 721), (763, 844)]),
    ):
        for row, (top, bottom) in enumerate(rows, 1):
            for side, x in zip(("L", "R"), xs, strict=True):
                owner = "아빠" if cabinet == "E" or (cabinet == "F" and row in {2, 4, 7}) else "엄마" if cabinet == "D" or row in {1, 3, 6} else "딸"
                stacks.append(dict(id=f"{cabinet}{row}-{side}", x=x, y=top,
                                   width=110, height=bottom-top, layers=3,
                                   proposed_persona=owner, product_assignment="PENDING_FULL_MANIFEST"))
    manifest = dict(status="AWAITING_USER_APPROVAL", reference_sha256=REFERENCE_SHA,
                    stage={"width": 1672, "height": 941}, candidates=items,
                    hanger_positions=placements, folded_stacks=stacks,
                    visible_structure={"hanger":21,"right_folded":66,"left_bottom_folded":6,"total":93},
                    imported=False, generated_replacement_assets=False)
    (OUT / "proposal.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    markers = []
    for p in placements:
        markers.append(f'<a class="mark hanger" href="#{p["id"]}" style="left:{p["hook_x"]/16.72:.4f}%;top:{(p["hook_y"]-58)/9.41:.4f}%">{p["id"]}</a>')
    for s in stacks:
        markers.append(f'<div class="mark stack" style="left:{s["x"]/16.72:.4f}%;top:{(s["y"]-16)/9.41:.4f}%">{s["id"]} · {s["proposed_persona"]} · 3벌</div>')
    cards = []
    for item in items:
        cards.append(f'<article id="{item["id"]}"><img src="{item["local_photo"]}" alt="{html.escape(item["title"])}"><div><b>{item["id"]} · {item["proposed_persona"]}</b><p>{html.escape(item["title"])}</p><a href="{html.escape(item["official_url"])}" target="_blank" rel="noreferrer">공식 상품 확인 ↗</a></div></article>')
    document = '''<!doctype html><html lang="ko"><meta charset="utf-8"><title>원본 보존 옷장 배치 승인 시안</title>
<style>body{margin:0;background:#f4f1eb;color:#24352c;font:15px system-ui}header,main{max-width:1672px;margin:auto}header{padding:20px}h1{font-size:25px}button{padding:10px;margin-right:8px}.stage{position:relative;width:100%;aspect-ratio:1672/941}.stage>img{width:100%;height:100%;display:block}.mark{position:absolute;background:#213d30e8;color:white;padding:4px;font:12px system-ui;text-decoration:none;transform:translateX(-25%);border-radius:3px}.stack{font-size:10px;background:#65533fe8}.off .mark{display:none}.lamp{position:absolute;left:29.8%;top:10.7%;width:12px;height:12px;border-radius:50%;background:#ffe4a5;box-shadow:0 0 18px 8px #ffd886,0 80px 80px 35px #ffdc7a80;display:none}.lit .lamp{display:block}.notice{padding:20px;background:#fff}.cards{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;padding:20px}article{background:white;scroll-margin-top:10px}article img{width:100%;height:230px;object-fit:contain}article div{padding:12px}article p{font-size:12px;min-height:50px}article a{font-size:12px;color:#2e5e48}.tag{font-size:13px;color:#68583c}@media(max-width:900px){.cards{grid-template-columns:repeat(3,1fr)}.mark{font-size:8px;padding:2px}.stack{font-size:7px}}</style>
<header><span class="tag">승인 대기 · 현재 앱/DB에 미적용</span><h1>원본 구조를 보존하는 상품 교체 배치안</h1><p>아래 옷장은 변경 전 원본 그대로입니다. 위치 표시는 교체 계획이며, 교체 후 합성 결과는 아직 생성하지 않았습니다.</p><button onclick="document.querySelector('.stage').classList.toggle('off')">위치 표시 / 원본 보기</button><button onclick="document.querySelector('.stage').classList.toggle('lit')">B3 의류 찾기 조명 시안</button></header><main><div class="stage"><img src="reference-unchanged.png" alt="변경 전 원본 옷장"><span class="lamp" aria-hidden="true"></span>MARKERS</div><div class="notice"><b>왼쪽 A 7벌 · B 6벌 · C 8벌 / 21벌 중 휘재 후보 18벌</b><p>원본 옷걸이 각도·중첩·간격·옷자락 길이를 각 위치의 틀로 사용합니다. 오른쪽 E 4단 / F 7단은 선반마다 좌우 2묶음 × 3벌. 93벌은 원본의 시각적 자리 수이며 실제 적재 수량이 아닙니다.</p><p>B3 점등은 보고서의 CSS 연출안으로 실제 LED/센서 연결을 검증한 결과가 아닙니다. 상품 후보는 아래 33개이며 선반 전체 72벌의 개별 상품 배정은 미확정입니다.</p></div><div class="cards">CARDS</div></main></html>'''
    (OUT / "proposal.html").write_text(document.replace("MARKERS", "".join(markers)).replace("CARDS", "".join(cards)), encoding="utf-8")
    print(f"Approval proposal: {len(items)} verified catalogue candidates; 21 hanger positions; 24 stacks x 3")


if __name__ == "__main__":
    main()
