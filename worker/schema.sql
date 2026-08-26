-- События визитов. Заводится один раз:
--   npx wrangler d1 create tvset-events
--   npx wrangler d1 execute tvset-events --remote --file worker/schema.sql
--
-- Хранятся сырые события, а не сводки: свести их запросом можно как угодно и
-- когда угодно, а разложить обратно уже нельзя.
--
-- Чего здесь нет намеренно: IP-адреса. Посетитель опознаётся дневным хешем,
-- который в полночь меняется, поэтому связать его визиты между сутками
-- невозможно даже нам. Кук нет, значит и согласия спрашивать не о чем.

CREATE TABLE IF NOT EXISTS visits (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	at            TEXT    NOT NULL,  -- ISO-8601, UTC
	visitor       TEXT    NOT NULL,  -- дневной хеш, 8 байт в hex
	country       TEXT,              -- от эджа, не от страницы
	asn           INTEGER,
	ua            TEXT,
	referrer      TEXT,              -- origin и путь; строка запроса отброшена
	path          TEXT    NOT NULL,
	utm_source    TEXT,
	utm_medium    TEXT,
	utm_campaign  TEXT,
	viewport      TEXT,
	dpr           TEXT,
	theme         TEXT,
	tex           INTEGER NOT NULL DEFAULT 0, -- 1 = просьба показать передачу
	why           TEXT               -- отчего нет телевизора; пусто — всё в порядке
);

-- Столбец why добавлен позже схемы. На заведённой базе:
--   npx wrangler d1 execute tvset-events --remote \
--     --command "ALTER TABLE visits ADD COLUMN why TEXT"
--
-- Значения закрытым списком (src/analytics.ts): dom, rm, net, mem, gl, err.
-- err — это не отказ, а поломка: кусок с телевизором не загрузился или упал
-- при запуске. Такая строка приезжает вторым запросом того же визита, так что
-- при подсчёте визитов её надо исключать: WHERE why IS NULL OR why <> 'err'.

-- Почти все вопросы к этой таблице начинаются с «за какой период», поэтому
-- время — первый индекс.
CREATE INDEX IF NOT EXISTS visits_at      ON visits (at);
CREATE INDEX IF NOT EXISTS visits_visitor ON visits (visitor, at);
CREATE INDEX IF NOT EXISTS visits_country ON visits (country, at);
