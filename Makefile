# Aivastra — Makefile shortcuts
# Requires: pnpm, docker, node >=20

.PHONY: setup dev dev-api dev-web dev-dispatcher dev-admin build test typecheck lint docker-up docker-down docker-reset db-generate db-migrate seed-catalog health prod-up prod-down prod-restart prod-bootstrap prod-logs prod-ps

setup:
	cp .env.example .env
	pnpm install
	$(MAKE) docker-up
	$(MAKE) db-generate
	$(MAKE) db-migrate

dev:
	pnpm dev

dev-api:
	pnpm --filter @aivastra/api dev

dev-web:
	pnpm --filter @aivastra/web dev

dev-dispatcher:
	pnpm --filter @aivastra/dispatcher dev

dev-admin:
	pnpm --filter @aivastra/admin dev

health:
	curl -s http://localhost:4000/health

build:
	pnpm build

test:
	pnpm -r run test

test-api:
	pnpm --filter @aivastra/api test

test-api-pattern:
	pnpm --filter @aivastra/api test -- $(pattern)

typecheck:
	pnpm typecheck

lint:
	pnpm lint

docker-up:
	docker compose -f infra/docker-compose.yml --profile apps --profile observability up -d

docker-down:
	docker compose -f infra/docker-compose.yml --profile apps --profile observability down

docker-reset:
	docker compose -f infra/docker-compose.yml --profile apps --profile observability down -v

db-generate:
	pnpm --filter @aivastra/db run generate

db-migrate:
	pnpm --filter @aivastra/db run migrate

seed-catalog:
	pnpm seed:catalog

# ── Production (VPS only) ──────────────────────────────────────────────────
# Always pass --env-file .env.production so Compose var-substitution (${VAR}
# in docker-compose.prod.yml, e.g. minio's MINIO_ROOT_USER) reads the same
# file as each service's `env_file:` directive. Without it, Compose silently
# falls back to a stray root .env and services boot with mismatched creds.
PROD_COMPOSE = docker compose --env-file .env.production -f infra/docker-compose.prod.yml

prod-up:
	$(PROD_COMPOSE) up -d

prod-down:
	$(PROD_COMPOSE) down

prod-restart:
	$(PROD_COMPOSE) up -d --force-recreate $(service)

prod-bootstrap:
	$(PROD_COMPOSE) run --rm minio-bootstrap

prod-logs:
	$(PROD_COMPOSE) logs -f $(service)

prod-ps:
	$(PROD_COMPOSE) ps
