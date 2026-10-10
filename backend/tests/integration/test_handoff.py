import hashlib
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.application.card_worker import process_cards
from app.core.passwords import hash_password
from app.core.security import issue_token
from tests.integration import test_sprint1_api as existing
from tests.integration.test_sprint1_api import FAMILY, HOUSEHOLD, OWNER, run_case
from tests.integration.test_sprint2_api import key
from tests.integration.test_sprint3_api import prepared
from tests.integration.test_sprint4_api import draft, render
from tests.integration.test_sprint6_api import SECOND, analyzed, confirm, decide, setup, success

pytestmark = pytest.mark.integration


@pytest.fixture
def real_dsn():
    yield from existing.real_dsn.__wrapped__()


async def personal(client, engine, settings, member=OWNER, role="OWNER"):
    async with engine.begin() as c:
        for m in (OWNER, FAMILY):
            await c.execute(
                text(
                    "INSERT INTO wardrobe.account_credential(member_id,login,password_hash) "
                    "VALUES(:id,:login,:hash) ON CONFLICT(member_id) DO NOTHING"
                ),
                {"id": UUID(m), "login": str(m), "hash": hash_password(str(uuid4()))},
            )
    _, token, _ = issue_token(settings, UUID(member), UUID(HOUSEHOLD), role, personal_account=True)
    client.headers["Authorization"] = "Bearer " + token


def test_scene_blocks_unapproved_frame_and_cross_device(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        await personal(client, engine, settings)
        device = (await client.get("/api/v1/integration/devices")).json()["items"][0]["id"]
        r = await client.get(f"/api/v1/integration/devices/{device}/scene")
        assert r.status_code == 200, r.text
        assert r.json()["frame"] is None and r.json()["items"] == []
        assert r.json()["total"] == len(r.json()["blocked"]) == 3
        assert (await client.get(f"/api/v1/integration/devices/{uuid4()}/scene")).status_code == 404
        capabilities = await client.get("/api/v1/integration/vton-capabilities")
        assert capabilities.status_code == 200, capabilities.text
        assert capabilities.json()["decart"]["live_verified"] is False

    run_case(real_dsn, settings_values, case)


def test_scene_positive_synthetic_approved_slot(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (_, person, resources):
            await personal(client, engine, settings)
            device = (await client.get("/api/v1/integration/devices")).json()["items"][0]["id"]
            async with engine.begin() as c:
                await c.execute(
                    text(
                        "UPDATE wardrobe.asset SET kind='OTHER', metadata="
                        "jsonb_build_object('scene_device_id',CAST(:d AS text),"
                        "'scene_role','clean-plate',"
                        "'visual_approval','approved','fixture','synthetic') WHERE id=:a"
                    ),
                    {"d": device, "a": UUID(person)},
                )
                await c.execute(
                    text("UPDATE wardrobe.garment_state SET location_id=NULL WHERE garment_id<>:g"),
                    {"g": UUID(existing.GARMENT)},
                )
                await c.execute(
                    text(
                        "UPDATE wardrobe.storage_location SET attributes="
                        "attributes || CAST(:geometry AS jsonb)"
                    ),
                    {
                        "geometry": '{"display_slot":{"approved":true,"x":0.1,"y":0.1,'
                        '"width":0.2,"height":0.3}}'
                    },
                )
                await c.execute(
                    text(
                        "UPDATE wardrobe.garment_state SET location_confidence=1,"
                        "last_seen_at=now() WHERE garment_id=:g"
                    ),
                    {"g": UUID(existing.GARMENT)},
                )
            response = await client.get(f"/api/v1/integration/devices/{device}/scene")
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["frame"] is not None
            assert len(data["items"]) == 1, data
            item = data["items"][0]
            assert item["garment_id"] == existing.GARMENT
            assert item["image"]["asset_id"] is not None
            assert item["geometry"]["width"] == 0.2
            assert len(data["blocked"]) == 2

    run_case(real_dsn, settings_values, case)


def test_family_manager_moves_accessible_son_item_without_changing_owner(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        await setup(engine)
        async with engine.begin() as c:
            await c.execute(
                text("UPDATE wardrobe.garment SET owner_id=:m WHERE id=:id"),
                {"m": UUID(FAMILY), "id": UUID(SECOND)},
            )
        await personal(client, engine, settings)
        _, action = await analyzed(client, settings, garment_ids=[SECOND])
        assert action is not None
        approved = await decide(client, action)
        assert approved.status_code == 201, approved.text
        completed = await confirm(client, approved.json(), [success(SECOND)])
        assert completed.status_code == 201, completed.text
        async with engine.connect() as c:
            assert await c.scalar(
                text("SELECT owner_id FROM wardrobe.garment WHERE id=:id"), {"id": UUID(SECOND)}
            ) == UUID(FAMILY)
            assert await c.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0
        # The son cannot execute a write plan for mom's garment.
        await personal(client, engine, settings, FAMILY, "MEMBER")
        response = await client.post(
            "/api/v1/storage-optimization-jobs",
            headers=key(),
            json={
                "household_id": HOUSEHOLD,
                "member_id": FAMILY,
                "mode": "WEAR_PATTERN",
                "dry_run": False,
                "season": "WINTER",
                "garment_ids": [existing.GARMENT],
            },
        )
        assert response.status_code == 404, response.text

    run_case(real_dsn, settings_values, case)


@pytest.mark.parametrize("template", ["T1-v1", "T2-v1", "T3-v1", "T4-v1"])
def test_independent_template_real_png_storage_save(real_dsn, settings_values, template):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (_, person, resources):
            card = await draft(client, template_id=template)
            assert card.status_code == 201, card.text
            assert card.json()["data"]["template_version"] == template
            queued = await render(client, card.json(), output_format="PNG")
            assert queued.status_code == 202, queued.text
            assert await process_cards(settings, resources) == 1
            fetched = await client.get("/api/v1/cards/" + card.json()["id"])
            assert fetched.json()["status"] == "READY", fetched.text
            image = fetched.json()["image_asset"]
            stored = resources.storage.get_object(
                Bucket=settings.storage_bucket, Key=image["asset_key"]
            )
            content = stored["Body"].read()
            stored["Body"].close()
            assert content.startswith(b"\x89PNG\r\n\x1a\n")
            evidence = (
                Path(__file__).resolve().parents[3]
                / "docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/evidence"
            )
            evidence.mkdir(parents=True, exist_ok=True)
            (evidence / (template + "-synthetic-test.png")).write_bytes(content)
            saved = await client.post(
                "/api/v1/cards/" + card.json()["id"] + "/save",
                headers=key(),
                json={"visibility": "PRIVATE", "reuse_outfit": False},
            )
            assert saved.status_code == 201, saved.text
            print(template, "synthetic PNG SHA256", hashlib.sha256(content).hexdigest())

    run_case(real_dsn, settings_values, case)
