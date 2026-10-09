import argparse
import importlib.util
import json
from pathlib import Path

import pytest


def importer():
    path = Path(__file__).resolve().parents[3] / "scripts/import_owned_garments.py"
    spec = importlib.util.spec_from_file_location("owned_import", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def private_plan(tmp_path):
    folder = tmp_path / "data/imports"
    folder.mkdir(parents=True)
    path = folder / "plan.json"
    item = dict(source_key="fixture:item", garment=dict(category="TOP", color="WHITE"))
    plan = dict(
        owner_id="20000000-0000-4000-8000-000000000001",
        device_id="30000000-0000-4000-8000-000000000001",
        items=[item],
        held=[],
    )
    path.write_text(json.dumps(plan), encoding="utf-8")
    return path, plan


def args(path):
    return argparse.Namespace(plan=str(path), with_images=False, execute=False)


def local(module, monkeypatch, tmp_path):
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module, "dotenv_values", lambda unused: {"APP_ENV": "local"})


def test_prepare_never_writes_api_or_database(tmp_path, monkeypatch):
    module = importer()
    local(module, monkeypatch, tmp_path)
    path, plan = private_plan(tmp_path)
    monkeypatch.setattr(module, "backup", lambda: pytest.fail("Preparation must not back up DB"))
    module.run(args(path))
    first = json.loads(path.with_suffix(".journal.json").read_text())
    module.run(args(path))
    assert json.loads(path.with_suffix(".journal.json").read_text()) == first
    assert len(first["items"]) == 1 and not path.with_suffix(".lock").exists()


def test_duplicate_identity_refused_before_journal(tmp_path, monkeypatch):
    module = importer()
    local(module, monkeypatch, tmp_path)
    path, plan = private_plan(tmp_path)
    plan["items"] *= 2
    path.write_text(json.dumps(plan))
    with pytest.raises(ValueError, match="repeated"):
        module.run(args(path))
    assert not path.with_suffix(".journal.json").exists()


def test_corrupt_journal_does_not_leave_lock(tmp_path, monkeypatch):
    module = importer()
    local(module, monkeypatch, tmp_path)
    path, plan = private_plan(tmp_path)
    path.with_suffix(".journal.json").write_text("{")
    with pytest.raises(json.JSONDecodeError):
        module.run(args(path))
    assert not path.with_suffix(".lock").exists()


@pytest.mark.parametrize(
    "url",
    ["http://image.msscdn.net/a", "https://evil.example/a", "https://user:password@tonywack.com/a"],
)
def test_untrusted_image_url_refused(url, tmp_path):
    with pytest.raises(ValueError, match="Official HTTPS"):
        importer().image({"image_url": url}, tmp_path)
