(function () {
  const PH = window.PH;
  const BASE = 'https://cinehax.com';

  const TMDB_KEY = '47fbef4ea90e936442ed15a9550ccc45';
  const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

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

  async function tmdb(path, lang) {
    const raw = await PH.httpGet(`https://api.themoviedb.org/3${path}?api_key=${TMDB_KEY}&language=${lang || 'es-MX'}`, null);
    return JSON.parse(raw);
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
    } catch (e) { }
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

  const esPromo = t => /cine\s*hax/i.test(t || '');

  async function detail(type, id) {
    const urls = type === 'tv'
      ? [`${BASE}/serie/${id}/`, `${BASE}/ver/?tipo=serie&id=${id}`]
      : [`${BASE}/pelicula/${id}/`, `${BASE}/ver/?tipo=pelicula&id=${id}`];
    const html = await fetchFirst(urls);
    if (!html) throw new Error('No se pudo cargar la ficha.');
    const doc = new DOMParser().parseFromString(html, 'text/html');

    let overview = '';

    if (TMDB_KEY) {
      for (const lang of ['es-MX', 'es-ES']) {
        try { const j = await tmdb(`/${type === 'tv' ? 'tv' : 'movie'}/${id}`, lang); if (j && j.overview) { overview = j.overview; break; } } catch (e) { }
      }
    }
    if (!overview) {
      const m = html.match(/Descripción<\/h3>\s*<p[^>]*>([^<]*)<\/p>/);
      if (m && !esPromo(m[1])) overview = m[1];
    }
    if (!overview) {
      for (const h of doc.querySelectorAll('h1,h2,h3,h4')) {
        if (!/^(descripci[oó]n|sinopsis)$/i.test(h.textContent.trim())) continue;
        const p = h.nextElementSibling;
        if (p && p.textContent.trim().length > 30 && !esPromo(p.textContent)) { overview = p.textContent; break; }
      }
    }
    if (!overview) {
      const d = doc.querySelector('.description, .synopsis, .overview');
      if (d && !esPromo(d.textContent)) overview = d.textContent;
    }
    if (!overview) {
      const ps = Array.from(doc.querySelectorAll('p')).filter(p => !esPromo(p.textContent));
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

  function splitEp(text) {
    let t = String(text || '').replace(/\s+/g, ' ').trim().replace(/^E\d+\s*/i, '');
    let runtime = '';
    const m = t.match(/^(.*?)\s*((?:\d+\s*h\s*)?\d+\s*min)\b.*$/i);
    if (m) { t = m[1].trim(); runtime = m[2].replace(/\s+/g, ' '); }
    return { title: t, runtime };
  }

  async function episodes(tvId, season) {
    if (TMDB_KEY) {
      try {
        const j = await tmdb(`/tv/${tvId}/season/${season}`);
        if (j && Array.isArray(j.episodes) && j.episodes.length) {
          return j.episodes.map(e => ({
            number: e.episode_number,
            title: e.name || 'Episodio ' + e.episode_number,
            runtime: e.runtime ? e.runtime + ' min' : '',
            thumbnail: e.still_path ? TMDB_IMG + e.still_path : ''
          }));
        }
      } catch (e) { }
    }
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
      let { title: t, runtime } = splitEp(text);
      if (!t || /^(?:T\d+|E\d+|Temporada\s*\d+)$/i.test(t)) t = 'Episodio ' + number;
      const im = a.querySelector('img');
      const thumbnail = im ? PH.fixUrl(im.getAttribute('data-src') || im.getAttribute('src') || '', BASE) : '';
      if (!out.has(number)) out.set(number, { number, title: t, runtime, thumbnail });
    });
    return [...out.values()].sort((a, b) => a.number - b.number);
  }

  window.PH_CINEHAX = { genres: GENRES, home, explore, search, detail, episodes };
})();
