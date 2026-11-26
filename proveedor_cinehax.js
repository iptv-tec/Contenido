// proveedor_cinehax.js — catálogo de películas y series (cinehax.com)
// Lo descarga y guarda en caché la app; se vuelve a bajar solo si cambia "cinehax_version" en version.json
(function () {
  const PH = window.PH;
  const BASE = 'https://cinehax.com';

  const GENRES = [
    ['movie:action', 'Películas: Acción'], ['movie:adventure', 'Películas: Aventura'],
    ['movie:comedy', 'Películas: Comedia'], ['movie:horror', 'Películas: Terror'],
    ['movie:sci-fi', 'Películas: Ciencia Ficción'], ['movie:drama', 'Películas: Drama'],
    ['tv:action-adventure', 'Series: Acción y aventura'], ['tv:soap', 'Series: Telenovela'],
    ['tv:war-politics', 'Series: Guerra y política'], ['tv:sci-fi-fantasy', 'Series: Ciencia ficción']
  ];

  function decodeEntities(s) {
    const t = document.createElement('textarea');
    t.innerHTML = s;
    return t.value;
  }

  function parseCard(a) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/\/(?:pelicula|serie)\/(\d+)/);
    if (!m) return null;
    const id = m[1];
    const isTv = href.includes('/serie/');
    const img = a.querySelector('img');
    let title = (img && img.getAttribute('alt')) || a.getAttribute('title') || '';
    if (!title) { const h = a.querySelector('h2,h3,span'); title = h ? h.textContent.trim() : ''; }
    title = title.replace(/^Ver\s+/i, '').trim() || (isTv ? 'Serie ' + id : 'Película ' + id);
    const poster = img ? PH.fixUrl(img.getAttribute('src'), BASE) : null;
    return { id, type: isTv ? 'tv' : 'movie', title, poster };
  }

  // Inicio: devuelve [{ name, list: [show] }] filtrado por 'movie' o 'tv'
  async function home(filterType) {
    const isMovie = filterType === 'movie';
    const html = await PH.httpGet(BASE + '/', BASE + '/');
    const categories = [];
    const doc = new DOMParser().parseFromString(html, 'text/html');

    doc.querySelectorAll('.scroll-section, #top-slider-container, #top-series-slider-container').forEach(el => {
      if (el.id === 'cx-continue') return;
      let name = el.id === 'top-slider-container' ? 'Top Películas Hoy'
        : el.id === 'top-series-slider-container' ? 'Top Series Hoy' : null;
      if (!name) {
        const h = el.querySelector('h2,h3');
        if (!h) return;
        name = h.textContent.replace(/Ver todo.*/i, '').trim();
      }
      const lowerName = name.toLowerCase();
      if (isMovie && lowerName.includes('serie')) return;
      if (!isMovie && !lowerName.includes('serie')) return;

      const shows = []; const seen = new Set();
      el.querySelectorAll('a[href]').forEach(a => {
        const s = parseCard(a);
        if (s && s.type === filterType && !seen.has(s.type + s.id)) { seen.add(s.type + s.id); shows.push(s); }
      });
      if (shows.length) categories.push({ name, list: shows });
    });
    return categories;
  }

  // Explorar por tipo / género / texto
  async function explore(type, page, genre, q) {
    genre = genre || ''; q = q || '';
    const params = `page=${page}&type=${type}&genre=${genre}&network=&language=&sort=popular&time=week&q=${encodeURIComponent(q)}`;
    const url = `${BASE}/ajax?action=load_explore_data&${params}`;
    try {
      const raw = await PH.httpGet(url, BASE + '/');
      const json = JSON.parse(raw);
      if (!json.success || !json.data || !json.data.html) return [];
      const doc = new DOMParser().parseFromString(json.data.html, 'text/html');
      const shows = [];
      doc.querySelectorAll('a[href*="/pelicula/"], a[href*="/serie/"]').forEach(a => {
        const s = parseCard(a);
        if (s) shows.push(s);
      });
      return shows;
    } catch (e) { return []; }
  }

  // Búsqueda en vivo (TMDB vía cinehax)
  async function search(q) {
    const shows = [];
    try {
      const url = `${BASE}/ajax?action=tmdb_live_search&query=${encodeURIComponent(q)}`;
      const json = JSON.parse(await PH.httpGet(url, BASE + '/'));
      if (json.success && Array.isArray(json.data)) {
        json.data.forEach(it => {
          const isTv = it.media_type === 'tv' || (!it.title && it.name);
          shows.push({
            id: String(it.id), type: isTv ? 'tv' : 'movie', title: it.title || it.name || '',
            poster: it.poster_path ? 'https://image.tmdb.org/t/p/w500' + it.poster_path : null
          });
        });
      }
    } catch (e) { /* sin resultados */ }
    return shows;
  }

  async function fetchFirst(urls, validate) {
    let html = '';
    for (const u of urls) {
      try { html = await PH.httpGet(u, BASE + '/'); } catch (e) { html = ''; }
      if (html && html.trim() && (!validate || validate(html))) return html;
    }
    return html;
  }

  // Ficha: sinopsis y, para series, números de temporada
  async function detail(type, id) {
    const urls = type === 'tv'
      ? [`${BASE}/serie/${id}/`, `${BASE}/ver/?tipo=serie&id=${id}`]
      : [`${BASE}/pelicula/${id}/`, `${BASE}/ver/?tipo=pelicula&id=${id}`];
    const html = await fetchFirst(urls);
    if (!html) throw new Error('No se pudo cargar la ficha.');

    let overview = '';
    const m = html.match(/Descripción<\/h3>\s*<p[^>]*>([^<]*)<\/p>/);
    if (m) overview = m[1];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!overview) {
      const d = doc.querySelector('.description, .synopsis, .overview');
      if (d) overview = d.textContent;
    }
    if (!overview) {
      const ps = Array.from(doc.querySelectorAll('p'));
      const longest = ps.reduce((a, b) => a.textContent.length > b.textContent.length ? a : b, { textContent: '' });
      if (longest.textContent.length > 50) overview = longest.textContent;
    }
    overview = decodeEntities(overview).replace(/\s+/g, ' ').trim();

    let seasons = [];
    if (type === 'tv') {
      const nums = new Set();
      for (const mm of html.matchAll(/(?:temporada-|season=)(\d+)/g)) nums.add(parseInt(mm[1], 10));
      if (!nums.size) for (const mm of html.matchAll(/Temporada\s+(\d+)/gi)) nums.add(parseInt(mm[1], 10));
      seasons = [...nums].filter(n => n > 0).sort((a, b) => a - b);
      if (!seasons.length) seasons = [1];
    }
    return { overview, seasons };
  }

  // Episodios de una temporada: [{ number, title }]
  async function episodes(tvId, season) {
    const urls = [
      `${BASE}/serie/${tvId}/temporada-${season}/episodio-1/`,
      `${BASE}/serie/${tvId}/`,
      `${BASE}/ver/?tipo=serie&id=${tvId}&season=${season}&episode=1`
    ];
    const html = await fetchFirst(urls, h => h.includes('temporada-' + season) || h.includes('season=' + season));
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sel = `a[href*="temporada-${season}/episodio-"], a[href*="season=${season}&episode="]`;
    const out = new Map();
    doc.querySelectorAll(sel).forEach(a => {
      const href = a.getAttribute('href') || '';
      const m = href.match(/(?:episodio-|episode=)(\d+)/);
      if (!m) return;
      const number = parseInt(m[1], 10);
      const text = a.textContent.trim();
      const label = (a.getAttribute('aria-label') || '') + ' ' + text;
      const isSeasonChip = /temporada/i.test(label) && !a.querySelector('span') && text.length <= 4;
      if (isSeasonChip) return;
      let t = text.replace(/^E\d+\s*/i, '').trim();
      if (!t || /^(?:T\d+|E\d+|Temporada\s*\d+)$/i.test(t)) t = 'Episodio ' + number;
      if (!out.has(number)) out.set(number, { number, title: t });
    });
    return [...out.values()].sort((a, b) => a.number - b.number);
  }

  window.PH_CINEHAX = { genres: GENRES, home, explore, search, detail, episodes };
})();
