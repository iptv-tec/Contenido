// extractor_moviemaster.js — servidores y video (HLS) desde api.moviemaster.lat
// Lo descarga y guarda en caché la app; se vuelve a bajar solo si cambia "extractor_version" en version.json
(function () {
  const PH = window.PH;
  const MAIN = 'https://api.moviemaster.lat';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const LANGUAGE_ORDER = ['latino', 'castellano', 'subtitulado'];
  const LANGUAGE_LABELS = { latino: 'Latino', castellano: 'Castellano', subtitulado: 'Subtitulado' };

  // media: { type:'movie', id } | { type:'tv', id, season, episode }
  // Devuelve [{ id, name, src }]
  async function servers(media) {
    const isMovie = media.type === 'movie';
    const url = isMovie
      ? `${MAIN}/e/movie/${media.id}`
      : `${MAIN}/e/tv/${media.id}/${media.season}/${media.episode}`;
    try {
      const embedHtml = await PH.httpGet(url, MAIN + '/', { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate' });
      const pm = embedHtml.match(/window\.PM_UI\s*=\s*["']([^"']+)["']/);
      if (!pm) return [];

      const params = isMovie
        ? `tmdb=${media.id}&type=movie`
        : `tmdb=${media.id}&type=tv&season=${media.season}&episode=${media.episode}`;
      const serversJson = await PH.httpGet(`${MAIN}/servers?${params}&ui=${pm[1]}`);
      const arr = JSON.parse(serversJson).servers;
      if (!Array.isArray(arr)) return [];

      const groups = new Map();
      for (const s of arr) {
        if (!s || !s.id) continue;
        const lang = String(s.lang || '').toUpperCase();
        const key = lang === 'LAT' ? 'latino' : lang === 'ESP' ? 'castellano' : lang === 'SUB' ? 'subtitulado' : lang.toLowerCase();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(String(s.id));
      }

      const all = [...groups.keys()];
      const ordered = LANGUAGE_ORDER.filter(k => all.includes(k)).concat(all.filter(k => !LANGUAGE_ORDER.includes(k)));
      const out = [];
      for (const key of ordered) {
        const label = LANGUAGE_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1));
        groups.get(key).forEach((serverId, i) => {
          out.push({
            id: serverId,
            name: `Moviemaster · Opción ${i + 1} · ${label}`,
            src: `${MAIN}/video?${params}&embed=${serverId}&noiframe=1&r=1`
          });
        });
      }
      return out;
    } catch (e) {
      console.error('MovieMaster servers:', e);
      return [];
    }
  }

  // Devuelve { source, type:'m3u8', headers } para el reproductor
  async function extract(src) {
    const json = JSON.parse(await PH.httpGet(src));
    const videoUrl = json && json.url;
    if (!videoUrl) throw new Error('No se encontró la URL del stream en la respuesta de MovieMaster.');
    return { source: videoUrl, type: 'm3u8', headers: { 'User-Agent': UA, 'Referer': MAIN + '/' } };
  }

  window.PH_EXTRACTOR = { name: 'Moviemaster', servers, extract };
})();
