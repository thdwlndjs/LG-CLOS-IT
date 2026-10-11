from dataclasses import dataclass
from typing import Protocol


class ProviderFailure(Exception):
    def __init__(self, code, retryable=False):
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class InputItem:
    kind: str
    id: str
    slot: str
    asset_id: str
    checksum_sha256: str


@dataclass(frozen=True)
class ProviderRequest:
    correlation_id: str
    person: bytes
    garments: tuple[bytes, ...]
    input_manifest: tuple[InputItem, ...] = ()


@dataclass(frozen=True)
class ProviderStatus:
    status: str
    image: bytes | None = None
    is_mock: bool = False


class VtonProvider(Protocol):
    async def submit(self, request: ProviderRequest) -> str: ...
    async def get_status(self, provider_job_id: str) -> ProviderStatus: ...
    async def cancel(self, provider_job_id: str) -> bool: ...
