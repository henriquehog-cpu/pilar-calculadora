'use strict';
const express = require('express');
const fs      = require('fs');
const path    = require('path');

const router    = express.Router();
const CFG_FILE  = path.join(__dirname, '../data/config.json');

function read() {
  try { return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); }
  catch { return {}; }
}

// GET /api/config — nunca retorna as credenciais ao frontend
router.get('/', (req, res) => {
  const cfg = read();
  const safe = { ...cfg };
  if (safe.omie) {
    safe.omie = {
      configurado: !!(cfg.omie?.app_key && cfg.omie?.app_secret),
      app_key_preview: cfg.omie?.app_key ? cfg.omie.app_key.slice(0, 4) + '****' : ''
    };
  }
  res.json(safe);
});

// PUT /api/config
router.put('/', (req, res) => {
  const cfg = read();
  const body = req.body;

  if (body.omie?.app_key)    cfg.omie.app_key    = body.omie.app_key;
  if (body.omie?.app_secret) cfg.omie.app_secret = body.omie.app_secret;
  if (body.empresa)          cfg.empresa         = { ...cfg.empresa, ...body.empresa };
  if (body.defaults)         cfg.defaults        = { ...cfg.defaults, ...body.defaults };

  fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2));
  res.json({ ok: true });
});

module.exports = router;
