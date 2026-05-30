'use strict';
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const fetch   = require('node-fetch');

const router       = express.Router();
const CFG_FILE     = path.join(__dirname, '../data/config.json');
const PRODUTOS_JSON = path.join(__dirname, '../../../produtos.json'); // calculadora existente
const CACHE_FILE   = path.join(__dirname, '../data/produtos-cache.json');

const OMIE_URL = 'https://app.omie.com.br/api/v1/geral/produtos/';

function getCredenciais() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
    return { app_key: cfg.omie?.app_key, app_secret: cfg.omie?.app_secret };
  } catch { return {}; }
}

// GET /api/omie/status
router.get('/status', async (req, res) => {
  const { app_key, app_secret } = getCredenciais();
  if (!app_key || !app_secret) return res.json({ ok: false, motivo: 'Credenciais não configuradas' });

  try {
    const r = await fetch(OMIE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ListarProdutos',
        app_key, app_secret,
        param: [{ pagina: 1, registros_por_pagina: 1, apenas_importado_api: 'N' }]
      }),
      timeout: 8000
    });
    const data = await r.json();
    if (data.faultstring) return res.json({ ok: false, motivo: data.faultstring });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, motivo: e.message });
  }
});

// POST /api/omie/sync — busca todos os produtos e atualiza produtos.json
router.post('/sync', async (req, res) => {
  const { app_key, app_secret } = getCredenciais();
  if (!app_key || !app_secret) return res.status(400).json({ erro: 'Credenciais Omie não configuradas' });

  let pagina = 1;
  const total_por_pagina = 500;
  let todos = [];

  try {
    while (true) {
      const r = await fetch(OMIE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call: 'ListarProdutos',
          app_key, app_secret,
          param: [{ pagina, registros_por_pagina: total_por_pagina, apenas_importado_api: 'N' }]
        }),
        timeout: 30000
      });
      const data = await r.json();
      if (data.faultstring) throw new Error(data.faultstring);

      const produtos = data.produto_servico_listfull || data.produto_servico_cadastro || [];
      todos = todos.concat(produtos);

      if (todos.length >= (data.nTotRegistros || 0)) break;
      pagina++;
    }

    // Transformar para o formato do sistema
    const transformados = todos.map(p => ({
      produto:           p.descricao || p.codigo,
      codigo:            p.codigo || '',
      ncm:               p.ncm || '',
      familia:           p.familia_produto || '',
      unidade:           p.unidade || 'PC',
      peso_liq_unit:     parseFloat(p.peso_liq)    || 0,
      peso_bruto_unit:   parseFloat(p.peso_bruto)  || 0,
      cest:              p.cest || '',
      // Alíquotas padrão MG — sobrescrever manualmente se necessário
      ii:                parseFloat(p.perc_ii) / 100     || 0,
      ipi:               parseFloat(p.perc_ipi) / 100    || 0,
      pis_importacao:    0.021,
      cofins_importacao: 0.1065,
      pis_venda:         0.0165,
      cofins_venda:      0.076,
      icms_intra:        0.14,
      icms_inter:        0.04,
      reg_espec_intra:   0.14,
      reg_espec_inter:   0.015,
      menor_fob:         null
    }));

    // Salvar cache interno
    fs.writeFileSync(CACHE_FILE, JSON.stringify(transformados, null, 2));

    // Atualizar produtos.json da calculadora existente
    fs.writeFileSync(PRODUTOS_JSON, JSON.stringify(transformados, null, 2));

    res.json({ ok: true, total: transformados.length });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// GET /api/omie/produtos — retorna cache local
router.get('/produtos', (req, res) => {
  try {
    const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const { q, familia } = req.query;
    let result = cache;
    if (familia) result = result.filter(p => p.familia === familia);
    if (q) {
      const qLow = q.toLowerCase();
      result = result.filter(p =>
        p.produto.toLowerCase().includes(qLow) ||
        p.codigo.toLowerCase().includes(qLow)  ||
        p.ncm.includes(q)
      );
    }
    res.json(result.slice(0, 200));
  } catch {
    res.json([]);
  }
});

// GET /api/omie/familias — lista famílias únicas
router.get('/familias', (req, res) => {
  try {
    const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const familias = [...new Set(cache.map(p => p.familia).filter(Boolean))].sort();
    res.json(familias);
  } catch {
    res.json([]);
  }
});

module.exports = router;
