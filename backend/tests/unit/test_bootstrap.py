import importlib.util

from app.core.paths import PROJECT_ROOT


def test_bootstrap_creates_secrets_once_and_preserves_existing_file(tmp_path, capsys):
    spec = importlib.util.spec_from_file_location(
        "bootstrap", PROJECT_ROOT / "scripts/bootstrap.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    (tmp_path / "infra").mkdir()
    example = (PROJECT_ROOT / "infra/env.example").read_text(encoding="utf-8")
    (tmp_path / "infra/env.example").write_text(example, encoding="utf-8")
    module.ROOT = tmp_path
    module.main()
    original = (tmp_path / ".env").read_bytes()
    values = [line for line in original.splitlines() if not line.lstrip().startswith(b"#")]
    assert all(b"CHANGE_ME" not in line for line in values)
    module.main()
    assert (tmp_path / ".env").read_bytes() == original
    output = capsys.readouterr().out
    assert "Created private .env" in output
    assert "Existing .env preserved" in output
    assert "JWT_SECRET=" not in output
