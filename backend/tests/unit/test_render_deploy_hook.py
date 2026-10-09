import importlib.util
from pathlib import Path

import httpx
import pytest


def module():
    path = Path(__file__).resolve().parents[3] / "scripts/trigger_render_deploy.py"
    spec = importlib.util.spec_from_file_location("render_deploy_hook", path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def test_exact_revision_is_requested_without_printing_secret(capsys):
    secret = "private-test-hook"
    revision = "a" * 40

    def respond(request):
        assert request.method == "POST"
        assert request.url.params["ref"] == revision
        return httpx.Response(202)

    module().trigger("https://api.render.com/deploy/srv-test?key=" + secret,
                     revision, httpx.MockTransport(respond))
    assert secret not in capsys.readouterr().out


@pytest.mark.parametrize("hook", ["", "http://api.render.com/deploy/srv-test?key=x",
    "https://api.render.com.evil.example/deploy/srv-test?key=x",
    "https://user:secret@api.render.com/deploy/srv-test?key=x",
    "https://api.render.com/deploy/srv-test?key=x&key=y"])
def test_untrusted_hooks_are_rejected(hook):
    with pytest.raises(ValueError):
        module().target(hook, "a" * 40)


def test_network_error_does_not_expose_hook_url():
    def fail(request):
        raise httpx.ConnectError("secret-provider-url", request=request)

    with pytest.raises(RuntimeError) as error:
        module().trigger("https://api.render.com/deploy/srv-test?key=private-test-hook",
                         "a" * 40, httpx.MockTransport(fail))
    assert "private-test-hook" not in str(error.value)
    assert "secret-provider-url" not in str(error.value)
