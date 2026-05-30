'use strict';
const express = require('express');
const XLSX    = require('xlsx');

const router = express.Router();

// POST /api/xlsx/order-request
router.post('/order-request', (req, res) => {
  const { processo } = req.body;
  if (!processo) return res.status(400).json({ erro: 'Dados do processo obrigatórios' });

  const wb = XLSX.utils.book_new();

  // Aba 1 — REQUEST IN ENGLISH
  const eng = buildOrderRequestEng(processo);
  const ws1 = XLSX.utils.aoa_to_sheet(eng);
  ws1['!cols'] = [
    { wch: 35 }, { wch: 10 }, { wch: 12 }, { wch: 20 },
    { wch: 8 },  { wch: 8 },  { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 20 }
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'REQUEST IN ENGLISH');

  // Aba 2 — ficha cadastral pedido
  const pt = buildOrderRequestPT(processo);
  const ws2 = XLSX.utils.aoa_to_sheet(pt);
  ws2['!cols'] = ws1['!cols'];
  XLSX.utils.book_append_sheet(wb, ws2, 'ficha cadastral pedido');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="OR_${processo.numero || 'PILAR'}.xlsx"`);
  res.send(buf);
});

// POST /api/xlsx/resumo-despachante
router.post('/resumo-despachante', (req, res) => {
  const { processo } = req.body;
  if (!processo) return res.status(400).json({ erro: 'Dados do processo obrigatórios' });

  const wb  = XLSX.utils.book_new();
  const rows = buildResumoDespachante(processo);
  const ws   = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 22 }, { wch: 40 }, { wch: 35 }, { wch: 10 },
    { wch: 6 },  { wch: 12 }, { wch: 12 }, { wch: 10 },
    { wch: 10 }, { wch: 14 }, { wch: 8 },  { wch: 10 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Resumo Despachante');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="DI_${processo.numero || 'PILAR'}.xlsx"`);
  res.send(buf);
});

// ─── builders ────────────────────────────────────────────────────────────────

function buildOrderRequestEng(p) {
  const g = p.dados_gerais || {};
  const itens = p.itens || [];
  const rows = [];

  rows.push(['PILAR IMPORTS']);
  rows.push([]);
  rows.push(['IMPORTER:', 'PILAR IMPORTS', '', 'ORDER:', p.numero || '']);
  rows.push(['EXPORTER:', g.fornecedor || '', '', 'DATE:', g.data_pedido || '']);
  rows.push(['COUNTRY:', g.pais || '', '', 'INCOTERM:', g.incoterm || 'FOB']);
  rows.push([]);
  rows.push([
    'DESCRIPTION', 'QUANTITY', 'UNIT PRICE (USD)', 'COLOR / DESIGN',
    'UND', 'GSM', 'ROLL SIZE (CM)', 'METERS PER ROLL', 'ROLL TYPE', 'OBS.'
  ]);

  let totalQtd = 0, totalFOB = 0;
  for (const item of itens) {
    const fobTotal = (item.quantidade || 0) * (item.fob_unit_usd || 0);
    totalQtd += item.quantidade || 0;
    totalFOB += fobTotal;
    rows.push([
      item.descricao || '',
      item.quantidade || 0,
      item.fob_unit_usd || 0,
      item.cor || '',
      item.unidade || 'PC',
      item.gsm || '',
      item.largura_cm || '',
      '',
      '',
      item.obs || ''
    ]);
  }

  rows.push([]);
  rows.push(['', 'TOTAL QTY', totalQtd, '', '', '', '', '', '', '']);
  rows.push(['', 'TOTAL FOB (USD)', totalFOB.toFixed(2)]);
  rows.push([]);
  rows.push(['PAYMENT TERMS:', g.cond_pagamento || '']);
  rows.push(['SHIPMENT:', g.prev_embarque || '']);
  rows.push([]);
  rows.push(['EXPORTER SIGNATURE:', '____________________________']);

  return rows;
}

function buildOrderRequestPT(p) {
  const g = p.dados_gerais || {};
  const itens = p.itens || [];
  const rows = [];

  rows.push(['PILAR IMPORTS — FICHA CADASTRAL PEDIDO']);
  rows.push([]);
  rows.push(['IMPORTADOR:', 'PILAR IMPORTS', '', 'PEDIDO:', p.numero || '']);
  rows.push(['EXPORTADOR:', g.fornecedor || '', '', 'DATA:', g.data_pedido || '']);
  rows.push(['PAÍS:', g.pais || '', '', 'INCOTERM:', g.incoterm || 'FOB']);
  rows.push([]);
  rows.push([
    'DESCRIÇÃO', 'QUANTIDADE', 'PREÇO UNIT (USD)', 'COR / ESTAMPA',
    'UND', 'GSM', 'LARGURA (CM)', 'METROS/ROLO', 'TIPO ROLO', 'OBS.'
  ]);

  let totalQtd = 0, totalFOB = 0;
  for (const item of itens) {
    const fobTotal = (item.quantidade || 0) * (item.fob_unit_usd || 0);
    totalQtd += item.quantidade || 0;
    totalFOB += fobTotal;
    rows.push([
      item.descricao || '',
      item.quantidade || 0,
      item.fob_unit_usd || 0,
      item.cor || '',
      item.unidade || 'PC',
      item.gsm || '',
      item.largura_cm || '',
      '',
      '',
      item.obs || ''
    ]);
  }

  rows.push([]);
  rows.push(['', 'TOTAL ITENS', totalQtd]);
  rows.push(['', 'TOTAL FOB (USD)', totalFOB.toFixed(2)]);
  rows.push([]);
  rows.push(['COND. PAGAMENTO:', g.cond_pagamento || '']);
  rows.push(['PREV. EMBARQUE:', g.prev_embarque || '']);

  return rows;
}

function buildResumoDespachante(p) {
  const g = p.dados_gerais || {};
  const itens = p.itens || [];
  const rows = [];

  rows.push([`RESUMO PARA DESPACHANTE — ${p.numero || ''}`]);
  rows.push([`Importador: PILAR IMPORTS`, '', `Fornecedor: ${g.fornecedor || ''}`, '', `País: ${g.pais || ''}`]);
  rows.push([`Proforma: ${g.numero_proforma || ''}`, '', `Invoice: ${g.numero_invoice || ''}`, '', `Incoterm: ${g.incoterm || ''}`]);
  rows.push([]);
  rows.push([
    'CÓDIGO OMIE', 'DESCRIÇÃO', 'DESCRIÇÃO DI', 'QTD', 'UN',
    'FOB UNIT USD', 'FOB TOTAL USD', 'PESO LÍQ', 'PESO BRUTO', 'NCM', 'GSM', 'LARGURA'
  ]);

  let totalQtd = 0, totalFOB = 0, totalPL = 0, totalPB = 0;
  for (const item of itens) {
    const fobTotal = (item.quantidade || 0) * (item.fob_unit_usd || 0);
    const pl = (item.quantidade || 0) * (item.peso_liq_unit || 0);
    const pb = (item.quantidade || 0) * (item.peso_bruto_unit || 0);
    totalQtd += item.quantidade || 0;
    totalFOB += fobTotal;
    totalPL  += pl;
    totalPB  += pb;
    rows.push([
      item.codigo_omie || '',
      item.descricao || '',
      item.descricao_di || '',
      item.quantidade || 0,
      item.unidade || 'PC',
      (item.fob_unit_usd || 0).toFixed(2),
      fobTotal.toFixed(2),
      pl.toFixed(3),
      pb.toFixed(3),
      item.ncm || '',
      item.gsm || '',
      item.largura_cm || ''
    ]);
  }

  rows.push([]);
  rows.push([
    'TOTAL', '', '', totalQtd, '',
    '', totalFOB.toFixed(2), totalPL.toFixed(3), totalPB.toFixed(3)
  ]);

  return rows;
}

module.exports = router;
