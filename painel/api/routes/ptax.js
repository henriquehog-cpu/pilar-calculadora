'use strict';
const express = require('express');
const fetch   = require('node-fetch');

const router = express.Router();
const cache  = new Map(); // data string → { taxa, ts }
const TTL    = 60 * 60 * 1000; // 1h

function fmtPTAX(data) {
  // data: YYYY-MM-DD → MM-DD-YYYY (formato da API BCB)
  const [y, m, d] = data.split('-');
  return `${m}-${d}-${y}`;
}

async function buscarPTAX(data) {
  const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/` +
              `CotacaoDolarDia(dataCotacao='${fmtPTAX(data)}')?$top=1&$format=json&$select=cotacaoVenda`;
  const r    = await fetch(url, { timeout: 8000 });
  const json = await r.json();
  return json?.value?.[0]?.cotacaoVenda || null;
}

// GET /api/ptax?data=YYYY-MM-DD  (retroage até 7 dias úteis)
router.get('/', async (req, res) => {
  let { data } = req.query;
  if (!data) {
    const hoje = new Date();
    data = hoje.toISOString().split('T')[0];
  }

  const cached = cache.get(data);
  if (cached && Date.now() - cached.ts < TTL) return res.json({ taxa: cached.taxa, data });

  // Tenta a data e retroage até 7 dias
  const base = new Date(data + 'T12:00:00');
  for (let i = 0; i < 8; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    try {
      const taxa = await buscarPTAX(ds);
      if (taxa) {
        cache.set(data, { taxa, ts: Date.now() });
        return res.json({ taxa, data: ds });
      }
    } catch { /* tenta próximo */ }
  }

  res.status(404).json({ erro: 'PTAX indisponível para a data informada' });
});

module.exports = router;
