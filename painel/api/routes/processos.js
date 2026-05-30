'use strict';
const express = require('express');
const fs      = require('fs');
const path    = require('path');

const router    = express.Router();
const DATA_FILE = path.join(__dirname, '../data/processos.json');

function read() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function write(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// GET /api/processos
router.get('/', (req, res) => {
  const all = read();
  const { status } = req.query;
  const result = status ? all.filter(p => p.status === status) : all;
  res.json(result.sort((a, b) => b.atualizado_em > a.atualizado_em ? 1 : -1));
});

// GET /api/processos/:id
router.get('/:id', (req, res) => {
  const all = read();
  const p   = all.find(x => String(x.id) === req.params.id);
  if (!p) return res.status(404).json({ erro: 'Processo não encontrado' });
  res.json(p);
});

// POST /api/processos
router.post('/', (req, res) => {
  const all  = read();
  const now  = new Date().toISOString();
  const novo = {
    id: Date.now(),
    status: 'ativo',
    criado_em: now,
    atualizado_em: now,
    ...req.body
  };
  all.push(novo);
  write(all);
  res.status(201).json(novo);
});

// PUT /api/processos/:id
router.put('/:id', (req, res) => {
  const all = read();
  const idx = all.findIndex(x => String(x.id) === req.params.id);
  if (idx === -1) return res.status(404).json({ erro: 'Processo não encontrado' });
  all[idx] = { ...all[idx], ...req.body, id: all[idx].id, atualizado_em: new Date().toISOString() };
  write(all);
  res.json(all[idx]);
});

// DELETE /api/processos/:id
router.delete('/:id', (req, res) => {
  const all = read();
  const idx = all.findIndex(x => String(x.id) === req.params.id);
  if (idx === -1) return res.status(404).json({ erro: 'Processo não encontrado' });
  all.splice(idx, 1);
  write(all);
  res.json({ ok: true });
});

module.exports = router;
