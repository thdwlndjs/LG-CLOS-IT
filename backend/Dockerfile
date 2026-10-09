FROM python:3.12.9-slim
WORKDIR /workspace
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/workspace/backend
ENV RUFF_CACHE_DIR=/tmp/ruff
COPY backend/requirements.lock /tmp/requirements.lock
RUN python -m pip install --no-cache-dir --require-hashes -r /tmp/requirements.lock
COPY backend /workspace/backend
COPY docs /workspace/docs
COPY scripts /workspace/scripts
COPY infra/compose.yaml infra/env.example /workspace/infra/
RUN groupadd --gid 10001 wardrobe && useradd --uid 10001 --gid wardrobe --create-home wardrobe
USER wardrobe
WORKDIR /workspace/backend
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
