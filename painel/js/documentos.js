/**
 * documentos.js — Geração de documentos .xlsx via backend
 * Fase 2: Order Request (2 abas) e Resumo Despachante
 */
const Documentos = (() => {
  const BASE = '/api/xlsx';

  async function gerarOrderRequest(processo) {
    const r = await fetch(`${BASE}/order-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ processo })
    });
    if (!r.ok) throw new Error('Erro ao gerar Order Request');
    const blob = await r.blob();
    _download(blob, `OR_${processo.numero || 'PILAR'}.xlsx`);
  }

  async function gerarResumoDespachante(processo) {
    const r = await fetch(`${BASE}/resumo-despachante`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ processo })
    });
    if (!r.ok) throw new Error('Erro ao gerar Resumo Despachante');
    const blob = await r.blob();
    _download(blob, `DI_${processo.numero || 'PILAR'}.xlsx`);
  }

  function _download(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(url);
  }

  return { gerarOrderRequest, gerarResumoDespachante };
})();
