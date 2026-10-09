import asyncio
import io

import pytest
from PIL import Image

from app.domain.vton import ProviderFailure, ProviderRequest
from app.infrastructure.adapters.vton import DecartAdapter, MockVtonProvider


def test_mock_capability_is_explicit_placeholder():
    async def run():
        provider = MockVtonProvider()
        reference = await provider.submit(ProviderRequest("fixture", b"person", (b"garment",)))
        result = await provider.get_status(reference)
        assert result.is_mock and result.status == "SUCCEEDED"
        with Image.open(io.BytesIO(result.image)) as image:
            assert image.size == (320, 240) and image.format == "PNG"
        assert await provider.cancel(reference)

    asyncio.run(run())


def test_decart_never_substitutes_mock_for_unverified_live_contract():
    async def run():
        provider = DecartAdapter()
        with pytest.raises(ProviderFailure) as error:
            await provider.submit(ProviderRequest("fixture", b"person", ()))
        assert error.value.code == "PROVIDER_CAPABILITY_UNAVAILABLE" and not error.value.retryable
        assert not await provider.cancel("unsupported")

    asyncio.run(run())
