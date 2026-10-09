import io

import pytest
from PIL import Image

from app.application.assets import validate_image
from app.core.errors import ApiError


@pytest.mark.parametrize(
    "format_name,mime",
    [
        ("PNG", "image/png"),
        ("JPEG", "image/jpeg"),
        ("WEBP", "image/webp"),
    ],
)
def test_actual_image_decoding(format_name, mime):
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "blue").save(output, format_name)
    validate_image(output.getvalue(), mime)
    wrong = "image/jpeg" if mime != "image/jpeg" else "image/png"
    with pytest.raises(ApiError):
        validate_image(output.getvalue(), wrong)


def test_oversized_dimensions_rejected():
    output = io.BytesIO()
    Image.new("RGB", (4097, 1), "blue").save(output, "PNG")
    with pytest.raises(ApiError):
        validate_image(output.getvalue(), "image/png")


def test_invalid_and_truncated_images_rejected():
    with pytest.raises(ApiError):
        validate_image(b"not a PNG", "image/png")
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "blue").save(output, "PNG")
    with pytest.raises(ApiError):
        validate_image(output.getvalue()[:30], "image/png")
