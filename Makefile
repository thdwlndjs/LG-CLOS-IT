PYTHON ?= python
COMPOSE = docker compose --env-file .env -f infra/compose.yaml

.PHONY: bootstrap up migrate seed smoke smoke-sprint1 test-unit test-integration test-contract test-e2e-mock lint down
bootstrap:
	$(PYTHON) scripts/bootstrap.py
up:
	$(COMPOSE) up -d --build postgres redis minio storage-init renderer api worker
migrate:
	$(COMPOSE) exec -T api python -m alembic upgrade head
seed:
	$(COMPOSE) exec -T api python /workspace/scripts/seed.py
smoke:
	$(PYTHON) scripts/smoke.py
smoke-sprint1:
	$(PYTHON) scripts/smoke_sprint1.py
test-e2e-sprint1:
	$(PYTHON) scripts/tasks.py test-e2e-sprint1
smoke-sprint2:
	$(PYTHON) scripts/smoke_sprint2.py
test-e2e-sprint2:
	$(PYTHON) scripts/tasks.py test-e2e-sprint2
smoke-sprint3:
	$(PYTHON) scripts/smoke_sprint3.py
test-e2e-sprint3:
	$(PYTHON) scripts/tasks.py test-e2e-sprint3
smoke-sprint4:
	$(PYTHON) scripts/smoke_sprint4.py
test-e2e-sprint4:
	$(PYTHON) scripts/tasks.py test-e2e-sprint4
test-unit:
	$(COMPOSE) run --rm --no-deps api python -m pytest tests/unit -q
test-integration:
	$(COMPOSE) --profile test run --rm tests
test-contract:
	$(COMPOSE) run --rm --no-deps api python -m pytest tests/contract -q
test-e2e-mock:
	$(PYTHON) scripts/tasks.py test-e2e-mock
lint:
	$(COMPOSE) run --rm --no-deps api python -m ruff check /workspace/backend /workspace/scripts
down:
	$(COMPOSE) --profile test down

smoke-sprint5:
	$(PYTHON) scripts/smoke_sprint5.py
test-e2e-sprint5:
	$(PYTHON) scripts/tasks.py test-e2e-sprint5
smoke-sprint6:
	$(PYTHON) scripts/smoke_sprint6.py
test-e2e-sprint6:
	$(PYTHON) scripts/tasks.py test-e2e-sprint6
smoke-sprint7:
	$(PYTHON) scripts/tasks.py smoke-sprint7
test-e2e-sprint7:
	$(PYTHON) scripts/tasks.py test-e2e-sprint7
observe:
	$(PYTHON) scripts/tasks.py observe
