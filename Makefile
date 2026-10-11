.DEFAULT_GOAL := help
.PHONY: help install dev check test build up down logs bots docker-test clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies (frozen lockfile)
	pnpm install --frozen-lockfile

dev: ## Run server (:8080) and client (:5173) with hot reload
	pnpm dev

check: ## Format check, lint, typecheck and all tests
	pnpm check

test: ## Run all unit and integration tests
	pnpm test

build: ## Production build of server and client
	pnpm build

up: ## Build images and run the full stack in Docker (http://localhost:8080)
	docker compose up --build -d
	@echo "Open http://localhost:$${WEB_PORT:-8080}"

down: ## Stop and remove the Docker stack
	docker compose down

logs: ## Follow Docker logs
	docker compose logs -f

bots: ## Connect 16 bots for 20s to a running local server (smoke/load test)
	pnpm --filter @neon/server bots -- --url ws://localhost:$${WEB_PORT:-8080}/ws --count 16 --seconds 20

docker-test: ## Start the stack, run the bot smoke test through nginx, tear down
	MAX_CONNECTIONS_PER_IP=100 docker compose up --build -d --wait
	pnpm --filter @neon/server bots -- --url ws://localhost:$${WEB_PORT:-8080}/ws --count 8 --seconds 8; \
	  status=$$?; docker compose down; exit $$status

clean: ## Remove build output and coverage
	rm -rf apps/*/dist apps/*/coverage packages/*/coverage
