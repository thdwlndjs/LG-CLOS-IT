"""Run the recovered loopback demo; original endpoints and paid providers untouched."""
import json
import os
import sys
from pathlib import Path
from remediation_local import identity

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

runtime = json.loads((ROOT / "test-results/recovery-normalization/runtime.json").read_text())
os.environ.update(
    APP_ENV="test", PUBLIC_DEPLOYMENT="false", AUTH_MODE="DEMO",
    DEMO_AUTH_ENABLED="true", PUBLIC_DEMO_LOGIN_ENABLED="false",
    DATABASE_URL=f"postgresql+asyncpg://wardrobe:{runtime['postgres_password']}@127.0.0.1:57433/wardrobe_demo_recovered",
    REDIS_URL="redis://127.0.0.1:16479/0",
    CELERY_BROKER_URL="redis://127.0.0.1:16479/0", CELERY_RESULT_BACKEND="redis://127.0.0.1:16479/1",
    STORAGE_PROVIDER="MINIO", STORAGE_ENDPOINT="http://127.0.0.1:19100",
    STORAGE_PUBLIC_BASE_URL="http://localhost:9000", STORAGE_BUCKET="wardrobe-assets",
    STORAGE_ACCESS_KEY=runtime["storage_access"], STORAGE_SECRET_KEY=runtime["storage_secret"],
    JWT_SECRET=runtime["jwt_secret"], LOCAL_DEMO_MEMBER_ID=str(identity("son")),
    LOCAL_DEMO_MOTHER_MEMBER_ID=str(identity("mom")), LOCAL_DEMO_STATION_ID=str(identity("station")),
    VTON_PROVIDER="MOCK", WORKER_EXECUTION="INLINE", FITROOM_LIVE_ENABLED="false",
    FITROOM_API_KEY="", DECART_API_KEY="", FITROOM_STATUS_READ_UNBILLED_VERIFIED="false",
    CARD_RENDERER_URL="http://127.0.0.1:3301",
)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:create_app", factory=True, host="127.0.0.1", port=18083)
