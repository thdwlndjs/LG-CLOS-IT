import asyncio
import sys
import json

sys.path.insert(0, "scripts")
from remediation_local import engine, PACKAGE, API
from sqlalchemy import text
import httpx
from uuid import uuid4


async def main():
    e = engine()
    async with e.connect() as c:
        rows = [
            dict(r)
            for r in (
                await c.execute(
                    text(
                        "SELECT p.garment_id,p.compartment_id,z.anchor_id,g.category,s.status::text AS status FROM wardrobe.scene_placement p JOIN wardrobe.garment g ON g.id=p.garment_id JOIN wardrobe.garment_state s ON s.garment_id=g.id JOIN wardrobe.lighting_zone z ON z.location_id=p.compartment_id AND z.device_id=g.device_id ORDER BY p.compartment_id,p.garment_id"
                    )
                )
            ).mappings()
        ]
        unused = [
            dict(r)
            for r in (
                await c.execute(
                    text(
                        "SELECT g.category,s.status::text AS status,count(*) AS count FROM wardrobe.garment g JOIN wardrobe.garment_state s ON s.garment_id=g.id LEFT JOIN wardrobe.scene_placement p ON p.garment_id=g.id WHERE p.garment_id IS NULL AND coalesce(g.attributes->>'approved_instance_id','')!~'^[ABC]' GROUP BY g.category,s.status"
                    )
                )
            ).mappings()
        ]
    await e.dispose()
    assert len(rows) == 66 and len({r["anchor_id"] for r in rows}) == 11
    with httpx.Client(timeout=30) as c:
        a = c.post(API + "/integration/demo-login", json={"profile": "son"})
        assert a.status_code == 200
        c.headers["Authorization"] = "Bearer " + a.json()["access_token"]
        device = c.get(API + "/integration/devices").json()["items"][0]["id"]
        command = c.post(
            API + "/integration/led-commands",
            headers={"Idempotency-Key": str(uuid4())},
            json={
                "device_id": device,
                "garment_ids": [str(r["garment_id"]) for r in rows[:2]],
            },
        )
        assert command.status_code == 201, command.text
        d = command.json()
        assert d["controller"] == "MOCK" and len(d["anchor_ids"]) == 1
        result = {
            "zone_count": 11,
            "mapped_items": 66,
            "same_compartment_mock_command": d,
            "unused_existing_categories": unused,
            "note": "Only existing Mock controller; shared compartment dedup checked, 30-second D-stage behavior not tested",
        }
        (PACKAGE / "reports/evidence/stage-b/compartments-led.json").write_text(
            json.dumps(result, default=str, indent=2), encoding="utf-8"
        )
        print(
            "66 items / 11 compartment LED zones; same-zone mock request deduplicated"
        )


asyncio.run(main())
