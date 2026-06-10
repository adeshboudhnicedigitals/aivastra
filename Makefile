# Aivastra — Makefile shortcuts
# Requires: pnpm, docker, node >=20

.PHONY: setup dev dev-api dev-web dev-dispatcher dev-admin build test typecheck lint docker-up docker-down docker-reset db-generate db-migrate seed-catalog health

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
