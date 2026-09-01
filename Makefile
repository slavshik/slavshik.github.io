# Короткие команды, которые иначе приходится помнить наизусть: сервер,
# проверки, эталоны, og.png. Под ними живут обычные npm-скрипты — Makefile
# им не замена, а список того, что вообще можно сделать в этом репозитории.
#
# Нужны node 22 (см. .nvmrc) и `npm ci`. Скриншотные тесты гоняются в
# официальном контейнере Playwright, поэтому для них нужен ещё и docker:
# локальная macOS и Linux в CI рисуют по-разному, и эталон имеет смысл только
# там, где он снят.

PORT   ?= 5173
URL    := http://localhost:$(PORT)

PW_IMAGE := mcr.microsoft.com/playwright:v1.62.1-noble
DOCKER   := docker run --rm -v "$(CURDIR)":/repo -v /repo/node_modules -w /repo

.DEFAULT_GOAL := help
.PHONY: help install dev lan preview lab look og-lab render check test unit e2e e2e-update \
        baselines size syntax build og sitemap format lint stats

help: ## Показать этот список
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk -F':.*?## ' '{ printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2 }'
	@echo ""
	@echo "  PORT=$(PORT) — порт dev-сервера, переопределяется: make dev PORT=9000"

## ─── работа ──────────────────────────────────────────────────────────────

install: ## Поставить зависимости строго по локу
	npm ci

dev: ## Dev-сервер с горячей перезагрузкой
	@echo "$(URL) — Ctrl-C чтобы остановить"
	@npx vite --port $(PORT) --strictPort

lan: ## Dev-сервер, открытый в локальную сеть — тюнить облик с планшета
	@echo "с этой машины: $(URL)"
	@ipconfig getifaddr en0 2>/dev/null \
	  | sed 's|^|  с планшета:  http://|; s|$$|:$(PORT)/lab/look.html|' || true
	@npx vite --host --port $(PORT) --strictPort

preview: build ## Отдать собранный сайт — ровно то, что уедет на Pages
	@npx vite preview --port $(PORT) --strictPort

lab: ## Открыть стенд телевизора со всеми ползунками
	@open $(URL)/lab/tv.html

look: ## Открыть стенд облика: форма, материалы и свет
	@open $(URL)/lab/look.html

og-lab: ## Открыть исходник карточки превью
	@open $(URL)/lab/og.html

render: ## Поднять просмотрщик 3D-моделей скилла /render
	@bash .claude/skills/render/setup.sh
	@lsof -i :3123 -t >/dev/null 2>&1 \
	  || (.claude/skills/render/.venv/bin/python3 \
	        .claude/skills/render/viewer/serve.py &>/tmp/render-viewer.log &)
	@sleep 1 && open http://localhost:3123

build: ## Собрать сайт в dist/
	npm run build

## ─── проверки ────────────────────────────────────────────────────────────

check: ## Типы и линтер — быстро и без браузера
	npm run typecheck
	npm run lint
	npm run format:check

unit: ## Юнит-тесты физики: без браузера и без WebGL
	npm run test:unit

e2e: build ## Скриншотные тесты в контейнере: desktop, tablet, mobile
	$(DOCKER) $(PW_IMAGE) bash -lc "npm ci --no-audit --no-fund && npx playwright test"

e2e-update: build ## Перезаписать эталоны текущим состоянием сайта
	$(DOCKER) $(PW_IMAGE) bash -lc \
	  "npm ci --no-audit --no-fund && npx playwright test --update-snapshots"
	@echo "  эталоны перезаписаны — посмотри глазами перед коммитом"

baselines: ## Снять эталоны с коммита REF (по умолчанию — с main)
	@ref=$${REF:-main}; tmp=$$(mktemp -d); \
	echo "  эталоны снимаются с $$ref"; \
	git archive "$$ref" | tar -x -C "$$tmp"; \
	docker run --rm -v "$(CURDIR)":/repo -v /repo/node_modules \
	  -v "$$tmp":/pristine:ro -w /repo $(PW_IMAGE) \
	  bash -lc "npm ci --no-audit --no-fund && node test/capture-baselines.mjs"; \
	code=$$?; rm -rf "$$tmp"; exit $$code

stats: ## Сводка по визитам из D1: make stats DAYS=30
	@node scripts/stats.mjs

size: build ## Проверить бюджет веса
	@node test/size.mjs

syntax: build ## Проверить, что собранное разберётся в старых браузерах
	@node test/syntax.mjs

test: check unit e2e size syntax ## Всё вместе

## ─── обслуживание ────────────────────────────────────────────────────────

format: ## Причесать всё prettier'ом
	npm run format

lint: ## Только линтер
	npm run lint

og: build ## Перегенерировать og.png из lab/og.html
	npx playwright screenshot \
	  --viewport-size=1200,630 \
	  "file://$(CURDIR)/dist/lab/og.html" public/og.png
	@echo "og.png перерисован — проверь глазами перед коммитом"

sitemap: ## Проставить в sitemap.xml сегодняшнюю дату
	@today=$$(date +%F); \
	sed -i '' -E "s|<lastmod>[0-9-]+</lastmod>|<lastmod>$$today</lastmod>|" public/sitemap.xml; \
	echo "  lastmod → $$today"
