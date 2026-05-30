/**
 * omie.js — Integração com API Omie via proxy backend
 */
const Omie = (() => {
  const BASE = '/api/omie';

  async function status() {
    try {
      const r = await fetch(`${BASE}/status`);
      return r.json();
    } catch { return { ok: false, motivo: 'Servidor offline' }; }
  }

  async function sincronizar(onProgress) {
    if (onProgress) onProgress('Conectando ao Omie...');
    const r = await fetch(`${BASE}/sync`, { method: 'POST' });
    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.erro || 'Erro na sincronização');
    }
    return r.json();
  }

  async function buscarProdutos(q, familia) {
    const params = new URLSearchParams();
    if (q)       params.set('q', q);
    if (familia) params.set('familia', familia);
    const r = await fetch(`${BASE}/produtos?${params}`);
    if (!r.ok) return [];
    return r.json();
  }

  async function listarFamilias() {
    const r = await fetch(`${BASE}/familias`);
    if (!r.ok) return [];
    return r.json();
  }

  return { status, sincronizar, buscarProdutos, listarFamilias };
})();
