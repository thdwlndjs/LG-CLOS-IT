"""Synthetic examples, never representations of verified customer purchases."""

from copy import deepcopy

PURCHASES = (
    dict(id="mock-purchase-top", name="Mock navy top", category="TOP", color="NAVY",
         quantity=1, status="PURCHASED"),
    dict(id="mock-purchase-bottom", name="Mock black trousers", category="BOTTOM", color="BLACK",
         quantity=2, status="PURCHASED"),
    dict(id="mock-cancelled", name="Mock cancelled order", category="TOP", color="WHITE",
         quantity=1, status="CANCELLED"),
    dict(id="mock-returned", name="Mock returned order", category="OUTER", color="GRAY",
         quantity=1, status="RETURNED"),
    dict(id="mock-missing-color", name="Mock incomplete order", category="TOP", color=None,
         quantity=1, status="PURCHASED"),
    dict(id="mock-unknown-quantity", name="Mock uncertain quantity", category="SHOES",
         color="BLACK", quantity=None, status="PURCHASED"),
)
LIKED = (dict(id="mock-liked-top", name="Mock liked top", category="TOP", color="WHITE"),)


def list_items(kind):
    return [dict(deepcopy(row), provider="MOCK", is_mock=True,
                 source_label="Synthetic Mock Provider", image_source="GENERATED_MOCK")
            for row in (PURCHASES if kind == "PURCHASED" else LIKED)]
