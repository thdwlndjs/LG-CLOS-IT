import asyncio
import io
from uuid import uuid4

import httpx
import pytest
from PIL import Image

from app.domain.vton import InputItem, ProviderFailure, ProviderRequest
from app.infrastructure.adapters.fitroom import AttemptPermit, FitRoomAdapter, prepare_image


def png():
    out = io.BytesIO()
    Image.new("RGBA", (32, 48), (20, 30, 40, 120)).save(out, "PNG")
    return out.getvalue()


def request():
    identity = str(uuid4())
    return ProviderRequest(
        identity,
        png(),
        (png(), png()),
        tuple(
            InputItem("OWNED", str(uuid4()), slot, str(uuid4()), "0" * 64)
            for slot in ("TOP", "BOTTOM")
        ),
    )


def test_preprocess_preserves_source_and_pixels_dimensions():
    source = png()
    with Image.open(io.BytesIO(prepare_image(source))) as image:
        assert image.mode == "RGB" and image.size == (32, 48)
        assert image.getpixel((0, 0)) == (144, 149, 154)
    assert source == png()


@pytest.mark.parametrize("format", ["JPEG", "WEBP", "PNG"])
def test_product_photo_formats(format):
    output = io.BytesIO()
    Image.new("RGB", (64, 96), "blue").save(output, format)
    with Image.open(io.BytesIO(prepare_image(output.getvalue()))) as image:
        assert image.mode == "RGB" and image.size == (64, 96) and image.format == "PNG"


@pytest.mark.parametrize(
    "env,enabled", [("local", True), ("test", True), ("production", False), ("staging", False)]
)
def test_transport_never_constructed_when_blocked(settings, monkeypatch, env, enabled):
    def forbidden(*a, **kw):
        pytest.fail("Network client constructed for blocked request")

    monkeypatch.setattr(httpx, "AsyncClient", forbidden)
    s = settings.model_copy(update=dict(app_env=env, fitroom_live_enabled=enabled))
    r = request()
    with pytest.raises(ProviderFailure, match="PAID_CALL_BLOCKED"):
        asyncio.run(FitRoomAdapter(s).submit(r, AttemptPermit(r.correlation_id, True)))


def test_real_adapter_contract_uses_only_intercepted_transport(settings, monkeypatch):
    requests = []

    def handler(req):
        requests.append(req)
        assert req.url.host == "platform.fitroom.app"
        assert req.headers["x-api-key"] == "synthetic-key-never-real"
        assert b'name="lower_cloth_image"' in req.content
        assert b"combo" in req.content
        return httpx.Response(200, json={"task_id": "fixture-task-1", "status": "CREATED"})

    monkeypatch.setattr(httpx, "AsyncHTTPTransport", lambda **kw: httpx.MockTransport(handler))
    from pydantic import SecretStr

    s = settings.model_copy(
        update=dict(
            app_env="staging",
            fitroom_live_enabled=True,
            fitroom_api_key=SecretStr("synthetic-key-never-real"),
            fitroom_status_read_unbilled_verified=True,
        )
    )
    r = request()
    assert (
        asyncio.run(FitRoomAdapter(s).submit(r, AttemptPermit(r.correlation_id, True)))
        == "fixture-task-1"
    )
    assert len(requests) == 1  # Intercepted HTTP envelope, zero upstream traffic.
    with pytest.raises(ProviderFailure, match="STATUS_COST_UNVERIFIED"):
        asyncio.run(
            FitRoomAdapter(
                s.model_copy(update={"fitroom_status_read_unbilled_verified": False})
            ).status("fixture-task-1")
        )
    assert len(requests) == 1


def test_timeout_does_not_retry(settings, monkeypatch):
    calls = []

    def handler(req):
        calls.append(req)
        raise httpx.ReadTimeout("synthetic timeout")

    monkeypatch.setattr(httpx, "AsyncHTTPTransport", lambda **kw: httpx.MockTransport(handler))
    from pydantic import SecretStr

    s = settings.model_copy(
        update=dict(
            app_env="production",
            fitroom_live_enabled=True,
            fitroom_api_key=SecretStr("synthetic-key-never-real"),
            fitroom_status_read_unbilled_verified=True,
        )
    )
    r = request()
    with pytest.raises(httpx.ReadTimeout):
        asyncio.run(FitRoomAdapter(s).submit(r, AttemptPermit(r.correlation_id, True)))
    assert len(calls) == 1
