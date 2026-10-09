import io

from PIL import Image, ImageDraw

from app.domain.vton import ProviderFailure, ProviderStatus


class MockVtonProvider:
    async def submit(self, request):
        return "mock:" + request.correlation_id

    async def get_status(self, provider_job_id):
        output = io.BytesIO()
        image = Image.new("RGB", (320, 240), "#eeeeee")
        ImageDraw.Draw(image).text((20, 100), "MOCK - NOT A REAL TRY-ON", fill="black")
        image.save(output, "PNG")
        return ProviderStatus("SUCCEEDED", output.getvalue(), True)

    async def cancel(self, provider_job_id):
        return True


class DecartAdapter:
    async def submit(self, request):
        raise ProviderFailure("PROVIDER_CAPABILITY_UNAVAILABLE")

    async def get_status(self, provider_job_id):
        raise ProviderFailure("PROVIDER_CAPABILITY_UNAVAILABLE")

    async def cancel(self, provider_job_id):
        return False


def provider_for(mode):
    return MockVtonProvider() if mode == "MOCK" else DecartAdapter()
