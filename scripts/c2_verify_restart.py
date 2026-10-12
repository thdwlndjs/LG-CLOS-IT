"""After local API restart, replay only spent FIXTURE attempts; never approve LIVE."""

import asyncio
import json

import httpx
from remediation_local import PACKAGE, engine
from sqlalchemy import text


async def main():
    folder = PACKAGE / "reports/evidence/c2-fitroom"
    evidence = json.loads((folder / "browser.json").read_text(encoding="utf-8"))
    results = []
    async with httpx.AsyncClient(
        base_url="http://127.0.0.1:18082", timeout=30
    ) as client:
        for entry, profile in zip(evidence, ["mother", "son"], strict=True):
            login = await client.post(
                "/api/v1/integration/demo-login", json={"profile": profile}
            )
            assert login.status_code == 200
            client.headers["Authorization"] = "Bearer " + login.json()["access_token"]
            path = "/api/v1/integration/fitroom/reviews/" + entry["fixture_job_id"]
            response = await client.get(path)
            assert response.status_code == 200
            row = response.json()
            assert (
                row["mode"] == "FIXTURE" and row["consumed"] and not row["authorized"]
            )
            before = row["result_asset"]["asset_id"]
            repeat = await client.post(
                path + "/execute",
                json={
                    "fingerprint": row["fingerprint"],
                    "confirmed": True,
                    "person_asset_id": row["request_snapshot"]["person"]["asset_id"],
                },
            )
            assert repeat.status_code == 409
            after = (await client.get(path)).json()
            assert after["result_asset"]["asset_id"] == before
            results.append(
                dict(
                    profile=entry["profile"],
                    job_id=row["job_id"],
                    consumed_survives_restart=True,
                    replay_status=409,
                    same_result_asset=True,
                )
            )
    e = engine()
    try:
        async with e.connect() as c:
            live = (
                (
                    await c.execute(
                        text(
                            "SELECT count(*) FILTER(WHERE approved_at IS NOT NULL) approved,"
                            "count(*) FILTER(WHERE consumed_at IS NOT NULL) consumed,"
                            "count(*) FILTER(WHERE provider_job_id IS NOT NULL) provider_jobs "
                            "FROM wardrobe.fitroom_request WHERE mode='LIVE'"
                        )
                    )
                )
                .mappings()
                .one()
            )
            assert all(n == 0 for n in live.values())
        (folder / "restart.json").write_text(
            json.dumps(
                dict(profiles=results, live=dict(live)), ensure_ascii=False, indent=2
            )
            + "\n",
            encoding="utf-8",
        )
        print(
            "After process restart: two spent Fixture requests blocked; LIVE grants/attempts/jobs zero"
        )
    finally:
        await e.dispose()


if __name__ == "__main__":
    asyncio.run(main())
