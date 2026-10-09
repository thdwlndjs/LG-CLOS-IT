"""The nine original FSD journeys. Real infrastructure; explicit Mock VTON only."""

import pytest

from app.application.card_worker import process_cards
from app.application.vton_worker import process_jobs
from tests.integration import test_sprint1_api as existing
from tests.integration import test_sprint2_api as sprint2
from tests.integration import test_sprint3_api as sprint3
from tests.integration import test_sprint4_api as sprint4
from tests.integration import test_sprint5_api as sprint5
from tests.integration import test_sprint6_api as sprint6
from tests.integration import test_sprint7_api as sprint7
from tests.integration.test_sprint1_api import GARMENT, OWNER, run_case
from tests.integration.test_sprint2_api import composition, key

pytestmark = [pytest.mark.e2e, pytest.mark.integration]


@pytest.fixture
def real_dsn():
    yield from existing.real_dsn.__wrapped__()


def test_e2e_01_today_outfit_home_context_reason(real_dsn, settings_values):
    sprint7.test_home_today_context_recommendation_read_only_and_scope(real_dsn, settings_values)


def test_e2e_02_recommend_mock_vton_final_card_save_reuse(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with sprint3.prepared(client, engine, settings) as (_, person, resources):
            context = (await sprint2.capture(client)).json()
            r = await client.post(
                "/api/v1/outfit-recommendations",
                headers=key(),
                json=dict(member_id=OWNER, context_snapshot_id=context["id"], limit=1),
            )
            assert r.status_code == 201, r.text
            candidate = r.json()["candidates"][0]["outfit"]
            r = await sprint3.new_session(
                client,
                outfit_id=candidate["id"],
                person_asset_id=person,
                context_snapshot_id=context["id"],
                source_screen="HOME",
            )
            assert r.status_code == 201, r.text
            session = r.json()
            r = await sprint3.submit(client, session, person)
            assert r.status_code == 202, r.text
            assert await process_jobs(settings, resources) == 1
            job = (await client.get("/api/v1/jobs/" + r.json()["job_id"])).json()
            assert job["status"] == "SUCCEEDED" and job["provider_mode"] == "MOCK"
            ended = await client.post(
                "/api/v1/vton-sessions/" + session["id"] + "/end",
                headers=key(),
                json=dict(
                    expected_revision=session["revision"],
                    final_outfit_id=session["outfit_id"],
                    save_outfit=True,
                ),
            )
            assert ended.status_code == 201, ended.text
            entry = ended.json()["card_entry_payload"]
            r = await sprint4.draft(client, **entry)
            assert r.status_code == 201, r.text
            card = r.json()
            r = await sprint4.render(client, card)
            assert r.status_code == 202, r.text
            assert await process_cards(settings, resources) == 1
            job = (await client.get("/api/v1/jobs/" + r.json()["job_id"])).json()
            assert (
                job["status"] == "SUCCEEDED" and job["result_asset"]["content_type"] == "image/png"
            )
            saved = await client.post(
                "/api/v1/cards/" + card["id"] + "/save",
                headers=key(),
                json=dict(visibility="PRIVATE", reuse_outfit=True, title="Accepted journey"),
            )
            assert saved.status_code == 201, saved.text
            reused = await client.get("/api/v1/outfits/" + saved.json()["linked_outfit_id"])
            assert reused.status_code == 200 and reused.json()["items"] == session["items"]

    run_case(real_dsn, settings_values, case)


def test_e2e_03_manual_outfit_to_common_vton_initial_values(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        r = await client.post(
            "/api/v1/outfits",
            headers=key(),
            json=dict(items=composition(), title="Manual outfit", status="SAVED"),
        )
        assert r.status_code == 201, r.text
        manual = r.json()
        r = await sprint3.new_session(client, outfit_id=manual["id"], source_screen="OUTFIT_EDITOR")
        assert r.status_code == 201, r.text
        assert r.json()["items"] == manual["items"] and r.json()["source_outfit_id"] == manual["id"]

    run_case(real_dsn, settings_values, case)


def test_e2e_04_session_end_is_not_wear_explicit_history(real_dsn, settings_values):
    sprint5.test_session_selection_is_not_wear_and_confirmation_unique(real_dsn, settings_values)


def test_e2e_05_location_confidence_observed_and_unknown(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        r = await client.post("/api/v1/garments/locate", json={"garment_id": GARMENT})
        assert r.status_code == 201, r.text
        found = r.json()["items"][0]
        assert found["location_id"] and found["confidence"] > 0 and found["last_seen_at"]
        r = await client.post(
            "/api/v1/garments",
            headers=key(),
            json=dict(owner_id=OWNER, category="TOP", color="BLUE"),
        )
        assert r.status_code == 201, r.text
        located = await client.post("/api/v1/garments/locate", json={"garment_id": r.json()["id"]})
        assert located.status_code == 201 and located.json()["items"][0]["status"] == "UNKNOWN"
        assert located.json()["items"][0]["location_id"] is None

    run_case(real_dsn, settings_values, case)


def test_e2e_06_proposal_approval_actual_move_only(real_dsn, settings_values):
    sprint6.test_full_confirmation_and_idempotent_concurrent_requests(real_dsn, settings_values)


def test_e2e_07_care_guide_schedule_complete_calendar(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        guide = await client.get("/api/v1/garments/" + GARMENT + "/care-guide")
        assert guide.status_code == 200
        r = await sprint5.schedule(client)
        assert r.status_code == 201, r.text
        r = await sprint5.complete(client, r.json())
        assert r.status_code == 201, r.text
        history = (await client.get("/api/v1/history?kind=CARE")).json()
        assert history["page"]["total"] == 1 and history["items"][0]["status"] == "COMPLETED"

    run_case(real_dsn, settings_values, case)


def test_e2e_08_style_source_reference_then_outfit_editor(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        r = await client.post(
            "/api/v1/style-references",
            headers=key(),
            json=dict(
                member_id=OWNER,
                source="INSTAGRAM",
                title="Reference link",
                source_url="https://example.com/style",
            ),
        )
        assert r.status_code == 201, r.text
        assert (
            len((await client.get("/api/v1/style-references?source=INSTAGRAM")).json()["items"])
            == 1
        )
        assert (await client.get("/api/v1/style-references?source=SHOPPING")).json()["items"] == []
        manual = await client.post(
            "/api/v1/outfits",
            headers=key(),
            json=dict(items=composition(), title=r.json()["title"], status="DRAFT"),
        )
        assert manual.status_code == 201, manual.text
        r = await sprint3.new_session(
            client, outfit_id=manual.json()["id"], source_screen="OUTFIT_EDITOR"
        )
        assert r.status_code == 201 and r.json()["items"] == composition()

    run_case(real_dsn, settings_values, case)


def test_e2e_09_external_failure_retry_and_honest_mock_sources(real_dsn, settings_values):
    sprint3.test_provider_failures_bounded_retry_timeout_and_lease(
        real_dsn, settings_values, "retry"
    )
    sprint4.test_failure_retry_lease_cleanup_and_input_policy(
        real_dsn, settings_values, "unavailable"
    )
    sprint2.test_partial_context_without_fake_live_provider(real_dsn, settings_values)
