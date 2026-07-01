/**
 * calc-processo.js — Régua fiscal de PROCESSO da PILAR (camada acima de calc.js).
 *
 * FONTE ÚNICA de:
 *   - npCalcResultado(proc): agrega os itens (Calc.calcItem) e monta imp_imp
 *     (crédito de importação) e imp_venda (débito de venda), nf_total_brl, DIFAL, lucro.
 *   - impostosPosVenda(proc): impostos pós-venda LÍQUIDOS a recolher (venda − crédito;
 *     ≤0 omite), ICMS 1,5% sempre, IRPJ/CSLL estimativa, vencimentos (dia 8/26 do mês
 *     seguinte à entrega). NÃO persistido.
 *   - vencMesSeguinte(dataISO, dia).
 *
 * Consumido IGUAL pelo browser (painel.html, via <script>) e pelo Node (painel-proxy.js,
 * via require) — uma única régua, sem duplicação. Funções movidas VERBATIM do painel.html.
 */

// Resolve o motor Calc: no Node faz require(calc.js); no browser usa o global de calc.js.
if (typeof Calc === "undefined" && typeof require === "function") {
  globalThis.Calc = require("./calc.js");
}

function npCalcResultado(proc) {
  const itens = proc.itens || [];
  if (!itens.length) return null;

  const taxaCalc    = proc.cambios?.fiscal?.taxa || proc.cambios?.di?.taxa || 0;
  const taxaCliente = proc.cambios?.cliente?.taxa || taxaCalc;
  if (!taxaCalc) return null;

  const comissaoPct = proc.custos_defaults?.comissao_pct ?? 0.02;
  const freteUSD    = proc.frete?.valor_usd  || 0;
  const containers  = proc.frete?.containers || 1;
  const freteProcUSD = freteUSD * containers; // frete total do processo = por-container × nº containers (= calculadora)
  const d           = proc.custos_defaults   || {};

  const fobTotalUSD = itens.reduce((s, it) => s + it.quantidade * it.fob_unit_usd, 0);
  if (!fobTotalUSD) return null;

  // Custos totais do processo (serão distribuídos proporcionalmente)
  const agenteT    = (d.agente_cargas      || 1800) * containers;
  const armazT     = (d.armazenagem        || 2600) * containers;
  const capatT     = (d.capatazia          || 1010) * containers;
  const oplogT     = (d.operador_logistico || 1000) * containers;
  const frodT      = (d.frete_rodoviario   || 0)   * containers;

  const rItens = itens.map(item => {
    const prop = (item.quantidade * item.fob_unit_usd) / fobTotalUSD;
    const ctx  = {
      fobTotalUSD,
      freteUSD:    freteProcUSD * prop,     // frete (por-container × containers) rateado por FOB do item
      taxaCalc, taxaCliente, comissaoPct,
      custos: {
        siscomex:    d.siscomex    || 192.79, // calc.js já rateia internamente por prop
        despachante: d.despachante || 2500,   // idem
        agente:      agenteT * prop,
        armazenagem: armazT  * prop,
        capatazia:   capatT  * prop,
        oplog:       oplogT  * prop,
        frodRodov:   frodT   * prop
      }
    };
    return Calc.calcItem(
      { ...item, containers: 1, margem_pct: item.margem_pct ?? 0.20 },
      ctx
    );
  });

  // Agregar totais
  let totII=0, totPIS=0, totCOF=0, totIPI=0, totSisc=0, totAfrmm=0, totDifFrete=0;
  let totCustoFinal=0, totPVBRL=0, totLucro=0;
  let totIcmsEf=0, totPisV=0, totCofV=0, totCSLL=0, totIR=0, totIRAdic=0, totCom=0, totIpiV=0;

  rItens.filter(Boolean).forEach(r => {
    totII        += r.ii;          totPIS      += r.pisImp;  totCOF      += r.cofImp;
    totIPI       += r.ipi;         totSisc     += r.siscomexRat;
    totAfrmm     += r.afrmm;       totDifFrete += r.difFrete;
    totCustoFinal+= r.custoImpTotal;
    totPVBRL     += r.pvTotal;     totLucro    += r.lucroLiqTotal;
    totIcmsEf    += r.icmsEf * r.qtd; totPisV += r.pisV * r.qtd; totCofV += r.cofV * r.qtd;
    totIpiV      += r.ipiV * r.qtd;
    totCSLL      += r.csll;        totIR       += r.ir;    totIRAdic += r.irAdic;
    totCom       += r.com * r.qtd;
  });

  const cifRS    = fobTotalUSD * taxaCalc + freteProcUSD * taxaCalc;
  const totImpImp = totII + totPIS + totCOF + totIPI + totSisc + totAfrmm + totDifFrete;
  // Soma direta dos custos operacionais dos defaults (despachante fixo + por container)
  const custosOp = (d.despachante          || 2500) +
                   (d.agente_cargas        || 1800) * containers +
                   (d.armazenagem          || 2600) * containers +
                   (d.capatazia            || 1010) * containers +
                   (d.operador_logistico   || 1000) * containers +
                   (d.frete_rodoviario     || 0);
  // DIFAL: sobre a venda total, descontado do lucro (Opção B). Mesma fórmula do
  // calc.js/index.html. Sem checkbox → 0 → resultado idêntico ao atual.
  const _dg = proc.dados_gerais || {};
  const difalTotal = totPVBRL * ((typeof Calc !== 'undefined' && Calc.difalRate)
    ? Calc.difalRate(_dg.cliente_sem_ie, _dg.aliq_interna_destino) : 0);
  const lucroFinal = totLucro - difalTotal;
  const margem    = totPVBRL > 0 ? lucroFinal / totPVBRL : 0;

  return {
    fob_total_usd: fobTotalUSD,
    cif_total_brl: cifRS,
    imp_imp: { ii: totII, pis: totPIS, cofins: totCOF, ipi: totIPI,
               siscomex: totSisc, afrmm: totAfrmm, dif_frete: totDifFrete, total: totImpImp },
    custos_op_total:   custosOp,
    custo_final_total: totCustoFinal,
    nf_total_brl:  totPVBRL,
    difal:         difalTotal,
    lucro_brl:     lucroFinal,
    margem_pct:    margem,
    imp_venda:     { icms: totIcmsEf, ipi: totIpiV, pis: totPisV, cofins: totCofV,
                     csll: totCSLL, ir: totIR, ir_adicional: totIRAdic, comissao: totCom },
    itens_resultado: rItens
  };
}

// ── Impostos Pós-Venda (calculado, read-only — NÃO persistido no dados.json) ──
// Vencimento = mês SEGUINTE ao mês da entrega (prev_chegada_cliente). String-math
// para evitar fuso. Dias 8/26 nunca estouram o mês. Dez (12) → Jan do ano seguinte.
function vencMesSeguinte(dataISO, dia) {
  if (!dataISO) return '';
  const [y, m] = String(dataISO).split('-').map(Number);
  if (!y || !m) return '';
  const yN = m === 12 ? y + 1 : y;
  const mN = m === 12 ? 1 : m + 1;
  return `${yN}-${String(mN).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Cache por assinatura dos inputs do cálculo: muda item/câmbio/frete/entrega → recalcula.
const _impPosVendaCache = new Map();
// Retorna [{imposto,label,valor,data,estimativa}] dos impostos pós-venda a recolher.
// Líquido por processo: débito de venda − crédito de importação; ≤0 → omite (virou crédito).
// ICMS efetivo 1,5% sempre (sem crédito). IRPJ/CSLL marcados estimativa. NUNCA grava nada.
function impostosPosVenda(proc) {
  if (!proc) return [];
  const entrega = proc.dados_gerais?.prev_chegada_cliente || '';
  const chave = (proc.numero || '?') + '|' + JSON.stringify({
    i: proc.itens, c: proc.cambios, d: proc.custos_defaults, f: proc.frete, e: entrega
  });
  if (_impPosVendaCache.has(chave)) return _impPosVendaCache.get(chave);

  const res = (typeof Calc !== 'undefined') ? npCalcResultado(proc) : null;
  const out = [];
  if (res) {
    const fi = res.imp_imp || {}, v = res.imp_venda || {};
    const dICMS = vencMesSeguinte(entrega, 8);   // ICMS dia 8 do mês seguinte
    const dFed  = vencMesSeguinte(entrega, 26);  // federais dia 26 do mês seguinte
    const pisLiq = (v.pis    || 0) - (fi.pis    || 0);
    const cofLiq = (v.cofins || 0) - (fi.cofins || 0);
    const ipiLiq = (v.ipi    || 0) - (fi.ipi    || 0);
    const irpj   = (v.ir     || 0) + (v.ir_adicional || 0);
    // ICMS sempre (1,5%, sem crédito)
    out.push({ imposto: 'ICMS', label: 'ICMS (1,5%)', valor: (v.icms || 0), data: dICMS, estimativa: false });
    if (pisLiq > 0) out.push({ imposto: 'PIS',    label: 'PIS',    valor: pisLiq, data: dFed, estimativa: false });
    if (cofLiq > 0) out.push({ imposto: 'COFINS', label: 'COFINS', valor: cofLiq, data: dFed, estimativa: false });
    if (ipiLiq > 0) out.push({ imposto: 'IPI',    label: 'IPI',    valor: ipiLiq, data: dFed, estimativa: false });
    if (irpj      > 0) out.push({ imposto: 'IRPJ', label: 'IRPJ (estimativa)', valor: irpj,        data: dFed, estimativa: true });
    if ((v.csll || 0) > 0) out.push({ imposto: 'CSLL', label: 'CSLL (estimativa)', valor: (v.csll || 0), data: dFed, estimativa: true });
  }
  _impPosVendaCache.set(chave, out);
  return out;
}

// Node (backend): expõe a régua via require. Browser: ignora (module indefinido) e as
// funções acima ficam como globais do script clássico (visíveis ao painel.html inline).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { npCalcResultado, impostosPosVenda, vencMesSeguinte };
}
