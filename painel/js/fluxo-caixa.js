/**
 * fluxo-caixa.js — Módulo de fluxo de caixa e pagamentos
 * Fase 3: painel completo de câmbios, parcelas, timeline SVG
 */
const FluxoCaixa = (() => {

  function renderView(processo, container) {
    container.innerHTML = `
      <div class="fc-placeholder">
        <div class="fc-icon">📊</div>
        <h3>Fluxo de Caixa — ${processo.numero}</h3>
        <p>Disponível na Fase 3</p>
      </div>`;
  }

  // Calcula resumo financeiro a partir do processo
  function calcResumo(processo) {
    const r = processo.resultado || {};
    const pagFornecedor = (processo.pagamentos_fornecedor || [])
      .reduce((s, p) => s + (p.valor_reais || 0), 0);
    const recCliente = (processo.recebimentos_cliente || [])
      .reduce((s, p) => s + (p.valor_reais || 0), 0);

    return {
      total_receitas:         r.nf_total_brl || recCliente,
      total_pago_fornecedor:  pagFornecedor,
      custo_processo_total:   r.custo_processo_total || 0,
      lucro:                  r.lucro_brl || 0,
      margem:                 r.margem_pct || 0,
      fob_total_usd:          r.fob_total_usd || 0,
      saldo_caixa:            recCliente - pagFornecedor - (r.custo_processo_total || 0)
    };
  }

  return { renderView, calcResumo };
})();
