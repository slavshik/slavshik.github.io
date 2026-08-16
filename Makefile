# Сайт статический, сборки нет. Этот Makefile — не сборка, а набор коротких
# команд, которые иначе приходится помнить наизусть: сервер, проверки, og.png.
#
# Всё держится на том, что уже есть в системе: python3, node, curl. Ставить
# ничего не надо, кроме playwright для `make og` — он один и требует установки.

PORT  ?= 8000
HOST  ?= 127.0.0.1
URL   := http://localhost:$(PORT)

HTML  := index.html lab/tv.html lab/og.html
JS    := tv.js $(wildcard vendor/*.js)

# Пути, которые обязаны отдаваться сервером: страница, модуль телевизора,
# вендор, служебные файлы. Если что-то из этого отвалится — сайт сломан.
SMOKE_PATHS := / /tv.js /favicon.svg /og.png /robots.txt /sitemap.xml \
               /lab/tv.html /vendor/three.module.min.js /vendor/RoundedBoxGeometry.js

.DEFAULT_GOAL := help
.PHONY: help serve serve-lan open lab og-lab og check test smoke sitemap

help: ## Показать этот список
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk -F':.*?## ' '{ printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2 }'
	@echo ""
	@echo "  PORT=$(PORT) — порт сервера, переопределяется: make serve PORT=9000"

## ─── сервер ──────────────────────────────────────────────────────────────

serve: ## Локальный сервер на localhost:PORT
	@echo "$(URL) — Ctrl-C чтобы остановить"
	@python3 -m http.server $(PORT) --bind $(HOST)

serve-lan: ## То же, но видно с телефона в той же сети
	@ip=$$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '?'); \
	echo "http://$$ip:$(PORT) — Ctrl-C чтобы остановить"; \
	python3 -m http.server $(PORT) --bind 0.0.0.0

open: ## Открыть страницу в браузере (сервер должен быть запущен)
	@open $(URL)/

lab: ## Открыть стенд телевизора со всеми ползунками
	@open $(URL)/lab/tv.html

og-lab: ## Открыть исходник карточки превью
	@open $(URL)/lab/og.html

## ─── проверки ────────────────────────────────────────────────────────────

check: ## Синтаксис JS и целостность локальных ссылок — без сервера
	@for f in $(JS); do node --check "$$f" || exit 1; done
	@echo "  js      ok — $(words $(JS)) файла"
	@q="\"'"; fail=0; \
	for ref in $$(grep -ohE "(src|href)=[$$q]/[^$$q]+|from [$$q]/[^$$q]+|import\([$$q]/[^$$q]+|:[[:space:]]*\"/[^\"]+" $(HTML) $(JS) \
	              | grep -oE "/[^$$q]+$$" | sed 's|^/||' | sort -u); do \
	  [ -e "$$ref" ] || { echo "  битая ссылка: /$$ref"; fail=1; }; \
	done; \
	[ $$fail = 0 ] && echo "  ссылки ok — все абсолютные пути существуют"; \
	exit $$fail

smoke: ## Поднять сервер и убедиться, что ключевые URL отдают 200
	@port=8123; \
	python3 -m http.server $$port --bind 127.0.0.1 >/dev/null 2>&1 & \
	pid=$$!; trap "kill $$pid 2>/dev/null" EXIT INT TERM; \
	for i in $$(seq 30); do \
	  curl -sf -o /dev/null http://127.0.0.1:$$port/ && break; sleep 0.2; \
	done; \
	fail=0; \
	for path in $(SMOKE_PATHS); do \
	  code=$$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$$port$$path"); \
	  if [ "$$code" = 200 ]; then echo "  200  $$path"; \
	  else echo "  $$code  $$path"; fail=1; fi; \
	done; \
	exit $$fail

test: check smoke ## Всё вместе: check + smoke

## ─── обслуживание ────────────────────────────────────────────────────────

og: ## Перегенерировать og.png из lab/og.html (нужен playwright)
	@command -v npx >/dev/null || { echo "нужен node/npx"; exit 1; }
	npx --yes playwright screenshot \
	  --viewport-size=1200,630 \
	  "file://$(CURDIR)/lab/og.html" og.png
	@echo "og.png перерисован — проверь глазами перед коммитом"

sitemap: ## Проставить в sitemap.xml сегодняшнюю дату
	@today=$$(date +%F); \
	sed -i '' -E "s|<lastmod>[0-9-]+</lastmod>|<lastmod>$$today</lastmod>|" sitemap.xml; \
	echo "  lastmod → $$today"
