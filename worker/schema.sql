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
	tex           INTEGER NOT NULL DEFAULT 0  -- 1 = просьба показать передачу
);

-- Почти все вопросы к этой таблице начинаются с «за какой период», поэтому
-- время — первый индекс.
CREATE INDEX IF NOT EXISTS visits_at      ON visits (at);
CREATE INDEX IF NOT EXISTS visits_visitor ON visits (visitor, at);
CREATE INDEX IF NOT EXISTS visits_country ON visits (country, at);
