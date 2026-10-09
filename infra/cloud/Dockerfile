FROM node:24.18.0-bookworm-slim AS node
FROM python:3.12.9-slim-bookworm
WORKDIR /workspace
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/workspace/backend \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright RUFF_CACHE_DIR=/tmp/ruff \
    NODE_ENV=production NODE_OPTIONS=--max-old-space-size=128
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY backend/requirements.lock /tmp/requirements.lock
RUN python -m pip install --no-cache-dir --require-hashes -r /tmp/requirements.lock
COPY renderer/package.json renderer/package-lock.json /workspace/renderer/
RUN cd /workspace/renderer && npm ci --omit=dev \
    && npx playwright install --with-deps chromium \
    && npm cache clean --force && rm -rf /var/lib/apt/lists/*
COPY backend /workspace/backend
COPY docs /workspace/docs
COPY scripts /workspace/scripts
COPY renderer/src /workspace/renderer/src
COPY infra/compose.yaml infra/env.example /workspace/infra/
COPY infra/cloud/supabase-ca.crt /workspace/infra/cloud/supabase-ca.crt
RUN groupadd --gid 10001 wardrobe && useradd --uid 10001 --gid wardrobe --create-home wardrobe
USER wardrobe
WORKDIR /workspace/backend
EXPOSE 10000
CMD ["python", "/workspace/scripts/start_free_cloud.py"]
