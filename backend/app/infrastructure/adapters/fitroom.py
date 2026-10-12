"""No retries, redirects, input-check calls or configurable upstream origin."""

import io
from dataclasses import dataclass

import httpx
from PIL import Image, ImageOps

from app.application.assets import MAX_BYTES, validate_image
from app.domain.vton import ProviderFailure, ProviderRequest

ORIGIN = "https://platform.fitroom.app"


def live_allowed(settings):
    return (
        settings.fitroom_live_enabled
        and settings.fitroom_status_read_unbilled_verified
        and settings.app_env in {"staging", "production"}
        and bool(settings.fitroom_api_key.get_secret_value())
    )


def prepare_image(data):
    """Keep source untouched; flatten alpha on white without stretching/upscaling."""
    if len(data) > MAX_BYTES:
        raise ProviderFailure("INPUT_TOO_LARGE")
    with Image.open(io.BytesIO(data)) as source:
        if source.format not in {"PNG", "JPEG", "WEBP"} or getattr(source, "n_frames", 1) != 1:
            raise ProviderFailure("INVALID_IMAGE")
        if max(source.size) > 4096:
            raise ProviderFailure("INVALID_IMAGE")
        image = ImageOps.exif_transpose(source).convert("RGBA")
        background = Image.new("RGBA", image.size, "white")
        background.alpha_composite(image)
        image = background.convert("RGB")
        image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.save(output, "PNG")
        result = output.getvalue()
        validate_image(result, "image/png")
        return result


@dataclass(frozen=True)
class AttemptPermit:
    job_id: str
    consumed: bool


class FitRoomAdapter:
    def __init__(self, settings):
        self.settings = settings

    async def submit(self, request: ProviderRequest, permit: AttemptPermit, hd_mode=False):
        if (
            not live_allowed(self.settings)
            or not permit.consumed
            or permit.job_id != request.correlation_id
        ):
            raise ProviderFailure("PAID_CALL_BLOCKED")
        items = dict(zip((i.slot for i in request.input_manifest), request.garments, strict=True))
        if set(items) == {"TOP", "BOTTOM"}:
            kind = "combo"
            files = {
                "cloth_image": ("top.png", prepare_image(items["TOP"]), "image/png"),
                "lower_cloth_image": ("bottom.png", prepare_image(items["BOTTOM"]), "image/png"),
            }
        elif set(items) == {"DRESS"}:
            kind = "full_set"
            files = {"cloth_image": ("dress.png", prepare_image(items["DRESS"]), "image/png")}
        else:
            raise ProviderFailure("UNSUPPORTED_COMPOSITION")
        files["model_image"] = ("person.png", prepare_image(request.person), "image/png")
        async with httpx.AsyncClient(
            timeout=self.settings.fitroom_timeout_seconds,
            follow_redirects=False,
            trust_env=False,
            transport=httpx.AsyncHTTPTransport(retries=0),
        ) as client:
            response = await client.post(
                ORIGIN + "/api/tryon/v2/tasks",
                files=files,
                data={"cloth_type": kind, "hd_mode": str(hd_mode).lower()},
                headers={"X-API-KEY": self.settings.fitroom_api_key.get_secret_value()},
            )
        if response.status_code != 200:
            raise ProviderFailure("PROVIDER_SUBMISSION_UNCERTAIN")
        reference = response.json().get("task_id")
        if not isinstance(reference, str) or not reference or len(reference) > 200:
            raise ProviderFailure("PROVIDER_SUBMISSION_UNCERTAIN")
        return reference

    async def status(self, reference):
        if (
            not live_allowed(self.settings)
            or not self.settings.fitroom_status_read_unbilled_verified
        ):
            raise ProviderFailure("STATUS_COST_UNVERIFIED")
        # IDs are opaque path components; never accept arbitrary URLs or path injection.
        if not reference.replace("-", "").replace("_", "").isalnum():
            raise ProviderFailure("PROVIDER_INVALID_RESULT")
        async with httpx.AsyncClient(
            timeout=self.settings.fitroom_timeout_seconds,
            follow_redirects=False,
            trust_env=False,
            transport=httpx.AsyncHTTPTransport(retries=0),
        ) as client:
            response = await client.get(
                ORIGIN + "/api/tryon/v2/tasks/" + reference,
                headers={"X-API-KEY": self.settings.fitroom_api_key.get_secret_value()},
            )
        if response.status_code != 200:
            raise ProviderFailure("STATUS_UNAVAILABLE")
        return response.json()
