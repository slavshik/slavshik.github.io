import './styles.css';

/* ── Акцент ─────────────────────────────────────────────────────────────
 * Меняется по местному времени посетителя: рассвет, день, закат, ночь.
 * Единственная «живая» деталь страницы — и она честная: никаких выдуманных
 * статусов и фейковых данных, только время у того, кто смотрит.
 * Без JS страница остаётся полностью рабочей с дневным акцентом.
 */
{
  // ?aqa=1 — прогон скриншотных тестов. Время суток там сломало бы эталоны:
  // один и тот же коммит давал бы четыре разные картинки за сутки. Акцент
  // фиксируется дневным — ровно по той же причине он намертво зашит в
  // og.png и favicon.svg, куда время суток тоже не передать.
  const h = new URLSearchParams(location.search).get('aqa') === '1' ? 12 : new Date().getHours();
  const accent =
    h >= 5 && h < 9
      ? '#c2643f' // рассвет — терракота
      : h >= 9 && h < 17
        ? '#2f6b57' // день — глубокий зелёный
        : h >= 17 && h < 21
          ? '#b07d2b' // закат — охра
          : '#6f86c9'; // ночь — индиго
  document.documentElement.style.setProperty('--accent', accent);
}

/* ── Переключатель темы ─────────────────────────────────────────────────
 * По умолчанию тема системная, и кнопка её только перебивает. Если выбранное
 * совпало с системным, override снимается совсем — иначе страница навсегда
 * перестала бы следовать за системой, хотя посетитель ничего такого не просил.
 */
{
  const btn = document.getElementById('theme');
  if (btn) {
    const root = document.documentElement;
    const sysDark = matchMedia('(prefers-color-scheme: dark)');

    // Цвет адресной строки на мобильных задан двумя мета-тегами через media.
    // Пока тема системная, пусть каждый остаётся при своём; как только выбор
    // сделан руками, обоим проставляется один цвет — media их больше не
    // разводит, потому что выбор сильнее системы.
    const paintMeta = (forced: string | null): void => {
      for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
        m.setAttribute(
          'content',
          forced
            ? forced === 'dark'
              ? '#101014'
              : '#f4f1ec'
            : /dark/.test(m.media)
              ? '#101014'
              : '#f4f1ec',
        );
      }
    };

    const effective = (): string => root.dataset.theme || (sysDark.matches ? 'dark' : 'light');

    const apply = (mode: string): void => {
      if (mode === (sysDark.matches ? 'dark' : 'light')) {
        delete root.dataset.theme;
        try {
          localStorage.removeItem('theme');
        } catch {
          /* приватный режим — просто не запоминаем */
        }
      } else {
        root.dataset.theme = mode;
        try {
          localStorage.setItem('theme', mode);
        } catch {
          /* приватный режим — просто не запоминаем */
        }
      }
      paintMeta(root.dataset.theme || null);
    };

    paintMeta(root.dataset.theme || null);
    (btn as HTMLButtonElement).hidden = false;
    btn.addEventListener('click', () => {
      apply(effective() === 'dark' ? 'light' : 'dark');
    });
  }
}

/* ── Телевизор ──────────────────────────────────────────────────────────
 * Необязательная деталь. Грузится только после того, как страница отрисована,
 * и только туда, где ему рады. Всё, что он умеет сломать в худшем случае —
 * это не появиться.
 */
{
  const stage = document.getElementById('tv-stage');

  // ?aqa=1 — ключ для скриншотных тестов: он не включает телевизор, а
  // запрещает всему двигаться. Страницу без телевизора эталонам теперь даёт
  // prefers-reduced-motion, а не отдельный ключ.
  const q = new URLSearchParams(location.search);
  const aqa = q.get('aqa') === '1';

  // Экономия трафика и совсем слабые машины — мимо
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
    deviceMemory?: number;
  };
  const net = nav.connection;

  const wanted =
    !!stage &&
    // Просили меньше движения — значит, никакого телевизора. Показывать
    // вместо него статичную картинку было бы хуже, чем не показывать ничего.
    !matchMedia('(prefers-reduced-motion: reduce)').matches &&
    !(net && (net.saveData || /(^|-)2g$/.test(net.effectiveType || ''))) &&
    !(nav.deviceMemory !== undefined && nav.deviceMemory < 2) &&
    hasWebgl2();

  // WebGL2 проверяем до импорта: не тянуть три четверти мегабайта туда,
  // где нечем рисовать. С r163 three умеет только WebGL2.
  function hasWebgl2(): boolean {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  }

  if (wanted && stage) {
    const boot = (): void => {
      import('./tv/index.js')
        .then((m) => {
          m.mount(stage, { frozen: aqa });
          // Класс — только после удачного монтирования: подложка под именем
          // нужна ровно тогда, когда за именем правда что-то летает.
          document.documentElement.classList.add('tv-on');
          // Неподвижный кадр рисуется синхронно внутри mount(), так что к
          // этой строке он уже на экране. Плейврайту достаточно дождаться
          // селектора — ни инъекций, ни сна на удачу.
          if (aqa) document.documentElement.setAttribute('data-tv', 'ready');
        })
        .catch(() => {
          /* тихо: страница и без него целая */
        });
    };
    const idle: (f: () => void) => void =
      window.requestIdleCallback ??
      ((f) => {
        setTimeout(f, 200);
      });
    if (document.readyState === 'complete') idle(boot);
    else addEventListener('load', () => idle(boot), { once: true });
  }
}
