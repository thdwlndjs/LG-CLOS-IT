"""Stage B local database/API evidence. No recommendation or VTON requests."""

import asyncio
import hashlib
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
from sqlalchemy import text

from remediation_local import API, PACKAGE, engine, identity, login

OUT = PACKAGE / "reports/evidence/stage-b"


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, default=str).encode()
    ).hexdigest()


async def inspect():
    e = engine()
    async with e.connect() as c:
        garments = [
            dict(r)
            for r in (
                await c.execute(
                    text(
                        "SELECT g.*,s.location_id,s.status::text AS storage_status "
                        "FROM wardrobe.garment g JOIN wardrobe.garment_state s ON s.garment_id=g.id "
                        "WHERE g.household_id=:h ORDER BY g.id"
                    ),
                    {"h": identity("household")},
                )
            ).mappings()
        ]
        baseline = json.loads(
            (OUT / "baseline-fingerprints.json").read_text(encoding="utf-8")
        )
        old = baseline["original_garments"]
        current = {str(r["id"]): r for r in garments}
        preserved = [
            gid for gid, expected in old.items() if expected == digest(current.get(gid))
        ]
        assert len(old) == len(preserved) == 76, "Original garment records changed"
        asset_changed = []
        for aid, expected in baseline["original_assets"].items():
            found = (
                (
                    await c.execute(
                        text("SELECT * FROM wardrobe.asset WHERE id=:id"),
                        {"id": UUID(aid)},
                    )
                )
                .mappings()
                .one()
            )
            if expected != digest(dict(found)):
                asset_changed.append(aid)
        assert not asset_changed, "Existing asset records changed"
        shelf = [
            dict(r)
            for r in (
                await c.execute(
                    text(
                        "SELECT p.garment_id,p.compartment_id,l.name,count(*) OVER(PARTITION BY p.compartment_id) AS quantity "
                        "FROM wardrobe.scene_placement p JOIN wardrobe.storage_location l ON l.id=p.compartment_id"
                    )
                )
            ).mappings()
        ]
        assert len(shelf) == len({r["garment_id"] for r in shelf}) == 66
        assert len({r["compartment_id"] for r in shelf}) == 11
        assert all(r["quantity"] == 6 for r in shelf)
        originals_left = [current[gid] for gid in baseline["left_garment_ids"]]
        assert len(originals_left) == 21
        assert not (
            {str(r["id"]) for r in originals_left}
            & {str(r["garment_id"]) for r in shelf}
        )
        profiles = {}
        for who in ["mom", "son"]:
            rows = [
                dict(r)
                for r in (
                    await c.execute(
                        text(
                            "SELECT w.id,w.worn_at,w.items_snapshot,c.member_id,c.captured_at,c.weather,c.schedule "
                            "FROM wardrobe.wear_event w JOIN wardrobe.context_snapshot c ON c.id=w.context_snapshot_id "
                            "WHERE w.member_id=:m AND w.confirmation_ref=:ref"
                        ),
                        {
                            "m": identity(who),
                            "ref": "poc-stage-b-v1:synthetic-experience",
                        },
                    )
                ).mappings()
            ]
            assert len(rows) == 54
            assert all(
                datetime.now(UTC) - timedelta(days=90)
                <= r["worn_at"]
                <= datetime.now(UTC)
                for r in rows
            )
            assert all(
                r["member_id"] == identity(who)
                and r["captured_at"] == r["worn_at"]
                and r["schedule"]
                and r["weather"]["_provenance"]["source"] == "SYNTHETIC_PAST_EXPERIENCE"
                for r in rows
            )
            assert all(
                current[i["garment_id"]]["owner_id"] == identity(who)
                for r in rows
                for i in r["items_snapshot"]
            )
            ctx = (
                (
                    await c.execute(
                        text("SELECT * FROM wardrobe.context_snapshot WHERE id=:id"),
                        {"id": identity("poc-stage-b-v1:current-context:" + who)},
                    )
                )
                .mappings()
                .one()
            )
            assert (
                len(ctx["schedule"]) == 2
                and ctx["weather"]["_provenance"]["source"] == "SYNTHETIC_DEMO_CURRENT"
            )
            profiles[who] = {
                "wear": len(rows),
                "context_linked": len(rows),
                "future_schedule": len(ctx["schedule"]),
            }
        counts = {
            t: (
                await c.execute(text("SELECT count(*) FROM wardrobe." + t))
            ).scalar_one()
            for t in [
                "garment",
                "wear_event",
                "context_snapshot",
                "liked_item",
                "scene_placement",
                "outfit",
                "outfit_card",
                "vton_job",
            ]
        }
        bad_household = (
            await c.execute(
                text(
                    "SELECT count(*) FROM wardrobe.liked_item i JOIN wardrobe.member m ON m.id=i.member_id "
                    "JOIN wardrobe.asset a ON a.id=i.image_asset_id WHERE i.household_id<>m.household_id OR i.household_id<>a.household_id"
                )
            )
        ).scalar_one()
        assert bad_household == 0
    await e.dispose()
    # Only login and read APIs; do not execute C-G flows.
    clients = {
        who: httpx.Client(
            headers={"Authorization": "Bearer " + login(who)["access_token"]},
            timeout=60,
        )
        for who in ["mom", "son"]
    }
    api_result = {}
    try:
        liked_ids = {}
        for who, client in clients.items():
            liked = client.get(API + "/integration/shopping/liked")
            assert liked.status_code == 200, liked.text
            data = liked.json()["items"]
            assert len(data) == 3
            liked_ids[who] = [i["id"] for i in data]
            assert not set(liked_ids[who]) & set(current)
            for item in data:
                assert item["product_id"] and item["category"] and item["color"]
                # The isolated Vite storage proxy preserves the signed localhost:9000 Host.
                img = httpx.get(
                    item["image_asset"]["read_url"].replace(
                        "http://localhost:9000", "http://127.0.0.1:19000"
                    ),
                    headers={"Host": "localhost:9000"},
                    timeout=30,
                )
                assert img.status_code == 200 and img.content
            current_context = client.get(
                API
                + "/context-snapshots/"
                + str(identity("poc-stage-b-v1:current-context:" + who))
            )
            assert current_context.status_code == 200
            assert (
                current_context.json()["source_status"]["weather"]["source"]
                == "SYNTHETIC_DEMO_CURRENT"
            )
            historical_context = client.get(
                API
                + "/context-snapshots/"
                + str(identity("poc-stage-b-v1:context:" + who + ":0"))
            )
            assert historical_context.status_code == 200
            assert (
                historical_context.json()["source_status"]["weather"]["source"]
                == "SYNTHETIC_PAST_EXPERIENCE"
            )
            device = client.get(API + "/integration/devices").json()["items"][0]["id"]
            sc = client.get(API + "/integration/devices/" + device + "/scene")
            assert sc.status_code == 200, sc.text
            scene = sc.json()
            assert (
                len(scene["items"])
                == len({i["garment_id"] for i in scene["items"]})
                == 87
            ), str({"items": len(scene["items"]), "blocked": scene["blocked"]})
            left = {
                i["garment_id"]: i
                for i in scene["items"]
                if i["garment_id"] in {str(r["id"]) for r in originals_left}
            }
            manifest = json.loads(
                (PACKAGE / "templates/approved_scene_manifest.json").read_text(
                    encoding="utf-8"
                )
            )
            for original in originals_left:
                approved = next(
                    i
                    for i in manifest["items"]
                    if i["id"] == original["attributes"]["approved_instance_id"]
                )
                bounds = approved["bounds"]
                geo = left[str(original["id"])]["geometry"]
                assert all(
                    abs(geo[k] - v) < 1e-8
                    for k, v in zip(
                        ["x", "y", "width", "height"],
                        [
                            bounds[0] / 1672,
                            bounds[1] / 941,
                            bounds[2] / 1672,
                            bounds[3] / 941,
                        ],
                    )
                )
            api_result[who] = {
                "liked": 3,
                "scene_items": len(scene["items"]),
                "left": len(left),
                "blocked": scene["blocked"],
            }
        for who, other in [("mom", "son"), ("son", "mom")]:
            assert (
                clients[who]
                .get(API + "/integration/shopping/liked/" + liked_ids[other][0])
                .status_code
                == 404
            )
            api_result[who]["foreign_liked_status"] = 404
    finally:
        for client in clients.values():
            client.close()
    OUT.mkdir(parents=True, exist_ok=True)
    result = {
        "original_count": 76,
        "preserved_ids": sorted(preserved),
        "original_rows_unchanged": True,
        "existing_assets_unchanged": True,
        "counts": counts,
        "shelf": shelf,
        "profiles": profiles,
        "api": api_result,
        "household_mismatches": bad_household,
        "scope": "isolated local database; not production; C-G not exercised",
    }
    (OUT / "db-api.json").write_text(
        json.dumps(result, ensure_ascii=False, default=str, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {k: v for k, v in result.items() if k not in ["preserved_ids", "shelf"]},
            default=str,
        )
    )


if __name__ == "__main__":
    asyncio.run(inspect())
