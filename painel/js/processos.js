/**
 * processos.js — CRUD de processos via API backend
 */
const Processos = (() => {
  const BASE = '/api/processos';

  async function listar(status) {
    const url = status ? `${BASE}?status=${status}` : BASE;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Erro ao listar processos');
    return r.json();
  }

  async function buscar(id) {
    const r = await fetch(`${BASE}/${id}`);
    if (!r.ok) throw new Error('Processo não encontrado');
    return r.json();
  }

  async function criar(dados) {
    const r = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    });
    if (!r.ok) throw new Error('Erro ao criar processo');
    return r.json();
  }

  async function atualizar(id, dados) {
    const r = await fetch(`${BASE}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    });
    if (!r.ok) throw new Error('Erro ao atualizar processo');
    return r.json();
  }

  async function deletar(id) {
    const r = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Erro ao deletar processo');
    return r.json();
  }

  // Gera número PIL-XXX-YYYY
  function gerarNumero(sequencia) {
    const ano = new Date().getFullYear();
    return `PIL-${String(sequencia).padStart(3, '0')}-${ano}`;
  }

  // Template de processo novo com todos os defaults
  function templateNovo(seq, config) {
    const d = config?.defaults || {};
    return {
      numero: gerarNumero(seq),
      status: 'ativo',
      dados_gerais: {
        cliente: '', fornecedor: '', pais: 'China',
        incoterm: 'FOB', numero_proforma: '', numero_invoice: '',
        cond_pagamento: '', prev_embarque: '', prev_chegada_porto: '',
        prev_chegada_cliente: '', observacoes: ''
      },
      cambios: {
        di:      { taxa: 0, data: '' },
        fiscal:  { taxa: 0, data: '' },
        cliente: { taxa: 0, data_prevista: '' },
        ptax_auto: true
      },
      frete: {
        valor_usd: 0, containers: 1,
        dif_frete_pct: d.dif_frete_pct || 0.025
      },
      custos_defaults: {
        siscomex:           d.siscomex            || 192.79,
        despachante:        d.despachante          || 2500,
        agente_cargas:      d.agente_cargas        || 1700,
        armazenagem:        d.armazenagem          || 2500,
        capatazia:          d.capatazia            || 1010,
        operador_logistico: d.operador_logistico   || 1000,
        comissao_pct:       d.comissao_pct         || 0.015,
        frete_rodoviario:   0,
        outros: []
      },
      itens: [],
      pagamentos_fornecedor: [],
      recebimentos_cliente: [],
      custos_timeline: [],
      resultado: {}
    };
  }

  return { listar, buscar, criar, atualizar, deletar, gerarNumero, templateNovo };
})();
