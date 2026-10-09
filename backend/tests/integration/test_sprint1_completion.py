"""Acceptance against real API handlers, PostgreSQL, Redis and private MinIO."""

import hashlib
import io
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
import pytest
from PIL import Image
from sqlalchemy import text

from app.application.assets import cleanup_assets
from app.core.security import issue_token
from app.infrastructure.adapters.object_storage import storage_client
from tests.integration import test_sprint1_api as existing
from tests.integration.test_sprint1_api import (
    BOX,
    FAMILY,
    LOCATION,
    OTHER_MEMBER,
    OWNER,
    run_case,
)

pytestmark = pytest.mark.integration


@pytest.fixture
def real_dsn():
    yield from existing.real_dsn.__wrapped__()


def key():
    return {"Idempotency-Key": str(uuid4())}


def png():
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "blue").save(output, "PNG")
    return output.getvalue()


async def login_as(client, settings, member=FAMILY, role="MEMBER"):
    _, token, _ = issue_token(
        settings, UUID(member), UUID("10000000-0000-4000-8000-000000000001"), role
    )
    client.headers["Authorization"] = "Bearer " + token


def test_sharing_delete_locations_and_tag_identity(real_dsn, settings_values):
    async def case(client, engine, settings, first, *unused):
        owner_auth = client.headers["Authorization"]
        payload = dict(
            owner_id=OWNER,
            category="TOP",
            color="GREEN",
            care_label="cold wash",
            location_id=LOCATION,
            shared_with_member_ids=[FAMILY],
            tag_value=uuid4().hex,
        )
        created = await client.post("/api/v1/garments", json=payload, headers=key())
        assert created.status_code == 201, created.text
        item = created.json()
        target = item["id"]
        assert item["care_label"] == "cold wash" and item["location_label"] == "Main Wardrobe"
        assert item["location_confidence"] == 1 and item["stale"] is False
        assert item["care_guide_available"] is True
        assert item["care_guide_url"] == f"/api/v1/garments/{target}/care-guide"
        await login_as(client, settings)
        assert (await client.get(f"/api/v1/garments/{target}")).status_code == 200
        listing = (await client.get("/api/v1/garments")).json()
        assert [g["id"] for g in listing["items"]] == [target]
        assert (
            await client.patch(
                f"/api/v1/garments/{target}",
                json={**payload, "owner_id": FAMILY},
                headers={"If-Match": "1"},
            )
        ).status_code == 404
        assert (
            await client.delete(f"/api/v1/garments/{target}", headers={"If-Match": "1"})
        ).status_code == 404
        client.headers["Authorization"] = owner_auth
        bad = await client.patch(
            f"/api/v1/garments/{target}",
            json={**payload, "shared_with_member_ids": [OTHER_MEMBER]},
            headers={"If-Match": "1"},
        )
        assert bad.status_code == 404
        observation = dict(
            tag_value=payload["tag_value"],
            observation_id=str(uuid4()),
            location_id=BOX,
            sensor_type="MOCK",
            confidence=1.0,
            observed_at=(datetime.now(UTC) - timedelta(seconds=1)).isoformat(),
            source_id="mock-tag",
        )
        # Initial manual location is newer: history retained without projection replacement.
        observed = await client.post(
            "/api/v1/garment-observations", json=observation, headers=key()
        )
        assert observed.status_code == 201 and not observed.json()["state_updated"]
        assert observed.json()["observation_id"] == observation["observation_id"]
        assert (
            await client.post("/api/v1/garment-observations", json=observation, headers=key())
        ).json() == observed.json()
        assert (
            await client.post(
                "/api/v1/garment-observations",
                json={**observation, "confidence": 0.5},
                headers=key(),
            )
        ).status_code == 409
        assert (
            await client.post(
                "/api/v1/garment-observations",
                json={**observation, "tag_value": "unknown"},
                headers=key(),
            )
        ).status_code == 404
        patched = await client.patch(
            f"/api/v1/garments/{target}",
            json={**payload, "shared_with_member_ids": []},
            headers={"If-Match": "1"},
        )
        assert patched.status_code == 200
        await login_as(client, settings)
        assert (await client.get(f"/api/v1/garments/{target}")).status_code == 404
        client.headers["Authorization"] = owner_auth
        assert (
            await client.delete(f"/api/v1/garments/{target}", headers={"If-Match": "1"})
        ).status_code == 409
        assert (
            await client.delete(f"/api/v1/garments/{target}", headers={"If-Match": "2"})
        ).status_code == 200
        assert (await client.get(f"/api/v1/garments/{target}")).status_code == 404
        async with engine.connect() as conn:
            assert (
                await conn.scalar(
                    text("SELECT status::text FROM wardrobe.garment_state WHERE garment_id=:id"),
                    {"id": UUID(target)},
                )
                == "RETIRED"
            )
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.garment_observation")) == 1
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0

    run_case(real_dsn, settings_values, case)


def test_assets_consent_integrity_immutable_storage_and_revocation(real_dsn, settings_values):
    async def case(client, engine, settings, first, *unused):
        data = png()
        upload = dict(
            file_name="shirt.png", content_type="image/png", size_bytes=len(data), purpose="GARMENT"
        )
        assert (
            await client.post("/api/v1/assets/upload-intents", json=upload, headers=key())
        ).status_code == 403
        body = (await client.get("/api/v1/settings")).json()
        consent = {**body, "image_upload_consent": True}
        assert (await client.put("/api/v1/settings", json=consent)).status_code == 200
        headers = key()
        intent = (
            await client.post("/api/v1/assets/upload-intents", json=upload, headers=headers)
        ).json()
        assert (
            await client.post("/api/v1/assets/upload-intents", json=upload, headers=headers)
        ).json() == intent
        target = intent["asset_id"]
        digest = hashlib.sha256(data).hexdigest()
        async with httpx.AsyncClient(timeout=10) as storage:
            assert (
                await storage.put(
                    intent["upload_url"], content=data, headers=intent["required_headers"]
                )
            ).status_code == 200
            bad = await client.post(
                f"/api/v1/assets/{target}/finalize",
                json={"checksum_sha256": "0" * 64},
                headers=key(),
            )
            assert bad.status_code == 422
            finalized = await client.post(
                f"/api/v1/assets/{target}/finalize", json={"checksum_sha256": digest}, headers=key()
            )
            assert finalized.status_code == 201, finalized.text
            asset = finalized.json()
            assert (await storage.get(asset["read_url"])).content == data
            # Presigned PUT cannot mutate the published final object.
            altered = bytearray(data)
            altered[-1] ^= 1
            assert (
                await storage.put(
                    intent["upload_url"], content=bytes(altered), headers=intent["required_headers"]
                )
            ).status_code == 200
            assert (await storage.get(asset["read_url"])).content == data
            unsigned = asset["read_url"].split("?")[0]
            assert (await storage.get(unsigned)).status_code == 403
            owner_auth = client.headers["Authorization"]
            await login_as(client, settings)
            assert (
                await client.post(
                    f"/api/v1/assets/{target}/finalize",
                    json={"checksum_sha256": digest},
                    headers=key(),
                )
            ).status_code == 403
            client.headers["Authorization"] = owner_auth
            garment = await client.post(
                "/api/v1/garments",
                json=dict(owner_id=OWNER, category="TOP", color="BLUE", image_asset_id=target),
                headers=key(),
            )
            assert garment.status_code == 201
            assert (await storage.get(garment.json()["image"]["read_url"])).content == data
            # Corrupt data with valid SHA is rejected by the decoder.
            bad_intent = (
                await client.post("/api/v1/assets/upload-intents", json=upload, headers=key())
            ).json()
            assert (
                await storage.put(
                    bad_intent["upload_url"],
                    content=b"x" * len(data),
                    headers=bad_intent["required_headers"],
                )
            ).status_code == 200
            invalid = await client.post(
                f"/api/v1/assets/{bad_intent['asset_id']}/finalize",
                json={"checksum_sha256": hashlib.sha256(b"x" * len(data)).hexdigest()},
                headers=key(),
            )
            assert invalid.status_code == 422
            assert (await client.put("/api/v1/settings", json=body)).status_code == 200
            assert (await storage.get(asset["read_url"])).status_code == 404
            assert (await client.get(f"/api/v1/garments/{garment.json()['id']}")).json()[
                "image"
            ] is None
            assert (
                await client.post(
                    f"/api/v1/assets/{target}/finalize",
                    json={"checksum_sha256": digest},
                    headers=key(),
                )
            ).status_code == 403
        history = (await client.get("/api/v1/settings/consent-history")).json()["items"]
        assert [item["granted"] for item in history] == [True, False]
        async with engine.connect() as conn:
            assert (
                await conn.scalar(
                    text("SELECT status::text FROM wardrobe.asset WHERE id=:id"),
                    {"id": UUID(target)},
                )
                == "DELETED"
            )

    run_case(real_dsn, settings_values, case)


def test_retention_cleanup_and_child_role(real_dsn, settings_values):
    async def case(client, engine, settings, first, *unused):
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE wardrobe.member SET role='CHILD' WHERE id=:id"), {"id": UUID(FAMILY)}
            )
        await login_as(client, settings, role="CHILD")
        response = await client.post(
            "/api/v1/sessions",
            json=dict(
                household_id="10000000-0000-4000-8000-000000000001",
                member_id=FAMILY,
                demo_mode=True,
            ),
            headers=key(),
        )
        assert response.status_code == 201 and response.json()["member"]["role"] == "CHILD"
        body = (await client.get("/api/v1/settings")).json()
        assert (
            await client.put("/api/v1/settings", json={**body, "image_upload_consent": True})
        ).status_code == 200
        data = png()
        intent = (
            await client.post(
                "/api/v1/assets/upload-intents",
                json=dict(
                    file_name="expiry.png",
                    content_type="image/png",
                    size_bytes=len(data),
                    purpose="GARMENT",
                ),
                headers=key(),
            )
        ).json()
        async with httpx.AsyncClient(timeout=10) as storage:
            assert (
                await storage.put(
                    intent["upload_url"], content=data, headers=intent["required_headers"]
                )
            ).status_code == 200
            result = await client.post(
                f"/api/v1/assets/{intent['asset_id']}/finalize",
                json={"checksum_sha256": hashlib.sha256(data).hexdigest()},
                headers=key(),
            )
            assert result.status_code == 201
            asset = result.json()
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        "UPDATE wardrobe.asset SET retention_expires_at=now()-interval '1 second' "
                        "WHERE id=:id"
                    ),
                    {"id": UUID(intent["asset_id"])},
                )
            from sqlalchemy.ext.asyncio import async_sessionmaker

            s3 = storage_client(settings)
            try:
                await cleanup_assets(settings, async_sessionmaker(engine), s3)
            finally:
                s3.close()
            assert (await storage.get(asset["read_url"])).status_code == 404

    run_case(real_dsn, settings_values, case)
