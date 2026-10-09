import pytest

from app.api.storage_relay import permitted

U = "10000000-0000-4000-8000-000000000001"
QUERY = (
    "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=test"
    "&X-Amz-Date=20261009T000000Z&X-Amz-Expires=60"
    "&X-Amz-SignedHeaders=host&X-Amz-Signature=" + "a" * 64
)


@pytest.mark.parametrize(
    "method,key",
    [
        ("GET", f"assets/{U}/{U}/{U}/" + "a" * 32),
        ("PUT", f"staging/{U}/{U}/{U}"),
    ],
)
def test_expected_capability_shapes(method, key):
    assert permitted(method, key, QUERY)


@pytest.mark.parametrize(
    "method,key,query",
    [
        ("GET", "", QUERY),
        ("GET", f"staging/{U}/{U}/{U}", QUERY),
        ("PUT", f"assets/{U}/{U}/{U}/result.png", QUERY),
        ("GET", f"assets/{U}/{U}/{U}/../secret", QUERY),
        ("GET", f"assets/{U}/{U}/{U}/result.png", QUERY.replace("Expires=60", "Expires=3600")),
        ("GET", f"assets/{U}/{U}/{U}/result.png", QUERY + "&X-Amz-Expires=60"),
        ("GET", f"assets/{U}/{U}/{U}/result.png", ""),
    ],
)
def test_reject_listing_admin_wrong_method_and_unsafe_capability(method, key, query):
    assert not permitted(method, key, query)
