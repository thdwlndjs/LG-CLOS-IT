import pytest
from pydantic import ValidationError

from app.schemas.sprint4 import CardPrepareRequest, CardRenderRequest


def test_fixed_renderer_contract_rejects_arbitrary_templates_and_dimensions():
    identity = "60000000-0000-4000-8000-000000000001"
    with pytest.raises(ValidationError):
        CardPrepareRequest(outfit_id=identity, template_id="file:///etc/passwd")
    with pytest.raises(ValidationError):
        CardRenderRequest(card_id=identity, width=1081)
    with pytest.raises(ValidationError):
        CardRenderRequest(card_id=identity, output_format="HTML")
