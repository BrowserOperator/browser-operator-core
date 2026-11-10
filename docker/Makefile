# Makefile for Browser Operator Core
# Provides DevTools frontend + Agent Server deployments

.PHONY: help build devtools-up up down logs status chrome chrome-clean

# Chrome binary detection with cross-platform fallbacks
# Override with: CHROME_BINARY=/path/to/chrome make chrome
CHROME_BINARY ?= $(shell \
	if command -v google-chrome >/dev/null 2>&1; then echo "google-chrome"; \
	elif command -v chromium >/dev/null 2>&1; then echo "chromium"; \
	elif command -v chromium-browser >/dev/null 2>&1; then echo "chromium-browser"; \
	elif [ -x "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" ]; then echo "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"; \
	elif [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; \
	else echo "chrome-not-found"; \
	fi)

# Chrome profile directory (cleaned before each run)
CHROME_PROFILE ?= /tmp/browser-operator-chrome-profile

help: ## Show this help
	@echo "Browser Operator Core - Docker Deployments"
	@echo "==========================================="
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'
	@echo ""
	@echo "Deployment options:"
	@echo "  Type 1: make devtools-up  # DevTools only (AUTOMATED_MODE=true by default)"
	@echo "  Type 2: make up           # DevTools + Agent Server (lightweight)"
	@echo ""
	@echo "Full build (includes agent-server in image):"
	@echo "  make build && docker-compose up -d"
	@echo ""
	@echo "For manual debugging mode (Type 1 without API key bypass):"
	@echo "  docker-compose build --build-arg AUTOMATED_MODE=false && make devtools-up"

build: ## Build full image (DevTools + Agent Server baked in)
	docker-compose build

devtools-up: ## Start DevTools only (Type 1)
	docker-compose up -d
	@echo ""
	@echo "DevTools UI: http://localhost:8000"

up: ## Start DevTools + Agent Server (Type 2 - lightweight)
	docker-compose -f docker-compose.lightweight.yml up -d
	@echo ""
	@echo "Services:"
	@echo "  DevTools:   http://localhost:8000"
	@echo "  Agent API:  http://localhost:8080"
	@echo "  Agent WS:   ws://localhost:8082"

down: ## Stop all containers
	docker-compose -f docker-compose.lightweight.yml down 2>/dev/null || true
	docker-compose down 2>/dev/null || true

logs: ## Show logs
	docker-compose -f docker-compose.lightweight.yml logs -f 2>/dev/null || docker-compose logs -f

status: ## Show container status
	@docker ps --filter "name=browser-operator"

chrome-clean: ## Remove Chrome debug profile
	@rm -rf "$(CHROME_PROFILE)"
	@echo "Cleaned Chrome profile: $(CHROME_PROFILE)"

chrome: chrome-clean ## Launch Chrome with custom DevTools (clean profile)
	@if [ "$(CHROME_BINARY)" = "chrome-not-found" ]; then \
		echo "Error: No Chrome/Chromium binary found."; \
		echo "Set CHROME_BINARY=/path/to/chrome make chrome"; \
		exit 1; \
	fi
	@echo "Using Chrome: $(CHROME_BINARY)"
	@echo "Profile: $(CHROME_PROFILE)"
	"$(CHROME_BINARY)" \
		--remote-debugging-port=9222 \
		--remote-allow-origins="*" \
		--auto-open-devtools-for-tabs \
		--user-data-dir="$(CHROME_PROFILE)" \
		--custom-devtools-frontend=http://localhost:8000/
