"""Independent disposable PostgreSQL tests for Stage B access and compartment bindings."""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from tests.integration import test_sprint1_api as existing
from tests.integration.test_handoff import personal
from tests.integration.test_sprint3_api import prepared

pytestmark = pytest.mark.integration


@pytest.fixture
def real_dsn():
    yield from existing.real_dsn.__wrapped__()


def test_database_interests_are_personal_not_owned_or_global(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings):
            ids = {m: uuid4() for m in [existing.OWNER, existing.FAMILY]}
            async with engine.begin() as c:
                image = await c.scalar(
                    text("SELECT image_asset_id FROM wardrobe.garment WHERE id=:g"),
                    {"g": UUID(existing.GARMENT)},
                )
                for member, item in ids.items():
                    await c.execute(
                        text(
                            "INSERT INTO wardrobe.liked_item(id,household_id,member_id,product_id,"
                            "name,"
                            "category,color,image_asset_id,metadata) "
                            "VALUES(:id,:h,:m,'catalog-1','Interest','TOP','WHITE',:a,'{}')"
                        ),
                        {"id": item, "h": UUID(existing.HOUSEHOLD), "m": UUID(member), "a": image},
                    )
            for member, other in [
                (existing.OWNER, existing.FAMILY),
                (existing.FAMILY, existing.OWNER),
            ]:
                await personal(
                    client,
                    engine,
                    settings,
                    member,
                    "OWNER" if member == existing.OWNER else "MEMBER",
                )
                response = await client.get("/api/v1/integration/shopping/liked")
                assert response.status_code == 200
                assert [i["id"] for i in response.json()["items"]] == [str(ids[member])]
                assert response.json()["items"][0]["image_asset"]["asset_id"] == str(image)
                assert (
                    await client.get("/api/v1/integration/shopping/liked/" + str(ids[other]))
                ).status_code == 404
            async with engine.connect() as c:
                assert await c.scalar(text("SELECT count(*) FROM wardrobe.garment")) == 4

    existing.run_case(real_dsn, settings_values, case)


def test_compartment_multiple_items_and_invalid_geometry_fail_closed(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (_, person, resources):
            await personal(client, engine, settings)
            device = (await client.get("/api/v1/integration/devices")).json()["items"][0]["id"]
            async with engine.begin() as c:
                await c.execute(
                    text(
                        "UPDATE wardrobe.asset SET kind='OTHER',metadata="
                        "jsonb_build_object('scene_device_id',CAST(:d AS text),"
                        "'scene_role','clean-plate',"
                        "'visual_approval','approved') WHERE id=:a"
                    ),
                    {"d": device, "a": UUID(person)},
                )
                await c.execute(
                    text(
                        "UPDATE wardrobe.garment_state SET last_seen_at=now(),location_confidence=1"
                    )
                )
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.scene_placement(garment_id,source_location_id,"
                        "compartment_id,geometry,namespace) "
                        "SELECT g.id,s.location_id,s.location_id,"
                        "CAST(:geometry AS jsonb),"
                        "'test-stage-b' FROM wardrobe.garment g "
                        "JOIN wardrobe.garment_state s ON s.garment_id=g.id "
                        "WHERE g.id<>:other"
                    ),
                    {
                        "other": UUID(existing.OTHER_GARMENT),
                        "geometry": '{"approved":true,"x":0.1,"y":0.1,"width":0.2,"height":0.1}',
                    },
                )
            response = await client.get("/api/v1/integration/devices/" + device + "/scene")
            assert response.status_code == 200, response.text
            assert len(response.json()["items"]) == 3
            assert len({i["location_id"] for i in response.json()["items"]}) == 1
            async with engine.begin() as c:
                await c.execute(
                    text(
                        "UPDATE wardrobe.scene_placement SET "
                        "geometry=jsonb_set(geometry,'{x}','1.2')"
                    )
                )
            response = await client.get("/api/v1/integration/devices/" + device + "/scene")
            assert response.status_code == 200 and response.json()["items"] == []
            assert all(i["reason"] == "SLOT_UNAPPROVED" for i in response.json()["blocked"])

    existing.run_case(real_dsn, settings_values, case)
