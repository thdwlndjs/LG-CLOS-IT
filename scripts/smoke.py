import json
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


def main():
    for path in ("/health/live", "/health/ready", "/openapi.json", "/docs"):
        try:
            with urlopen("http://localhost:8000" + path, timeout=10) as response:
                data = response.read()
                if path == "/health/ready" and json.loads(data)["status"] != "ready":
                    raise RuntimeError("Dependencies are not ready")
                print(f"{path}: HTTP {response.status}")
        except (HTTPError, URLError) as exc:
            raise SystemExit(f"{path}: FAILED ({type(exc).__name__})") from exc


if __name__ == "__main__":
    main()
