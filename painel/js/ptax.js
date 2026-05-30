/**
 * ptax.js — Busca taxa PTAX via backend (com cache local 1h)
 */
const PTAX = (() => {
  const cache = {};

  async function buscar(data) {
    // data: YYYY-MM-DD ou null (hoje)
    const key = data || 'hoje';
    if (cache[key] && Date.now() - cache[key].ts < 3600000) return cache[key];

    const url = `/api/ptax${data ? `?data=${data}` : ''}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('PTAX indisponível');
    const json = await r.json();
    if (json.erro) throw new Error(json.erro);
    cache[key] = { taxa: json.taxa, data: json.data, ts: Date.now() };
    return cache[key];
  }

  return { buscar };
})();
