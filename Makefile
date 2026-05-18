# Aivastra — Makefile shortcuts
# Requires: pnpm, docker, node >=20

.PHONY: setup dev build test typecheck lint docker-up docker-down docker-reset db-generate db-migrate

setup:
	cp .env.example .env
	pnpm install
	$(MAKE) docker-up
	$(MAKE) db-generate
	$(MAKE) db-migrate

dev:
	pnpm dev

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
	docker compose -f infra/docker-compose.yml up -d

docker-down:
	docker compose -f infra/docker-compose.yml down

docker-reset:
	docker compose -f infra/docker-compose.yml down -v

db-generate:
	pnpm --filter @aivastra/db run generate

db-migrate:
	pnpm --filter @aivastra/db run migrate

seed-catalog:
	pnpm seed:catalog
