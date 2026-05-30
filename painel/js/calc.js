/**
 * calc.js — Motor de cálculo fiscal PILAR Imports
 * Lucro Real · MG · Venda Interestadual
 *
 * Lógica idêntica à calculadora existente (index.html).
 * Câmbio fiscal usado para TODOS os cálculos de custo e tributos.
 * Câmbio cliente usado para converter PV em USD.
 */
const Calc = (() => {

  function defaultAliq() {
    return {
      ii: 0, ipi: 0,
      pis_importacao: 0.021,
      cofins_importacao: 0.1065,
      pis_venda: 0.0165,
      cofins_venda: 0.076,
      icms_intra: 0.14,
      icms_inter: 0.04,
      reg_espec_intra: 0.14,
      reg_espec_inter: 0.015
    };
  }

  /**
   * Calcula um único item dentro do contexto do processo.
   * Retorna o objeto de resultado ou null se dados insuficientes.
   */
  function calcItem(item, ctx) {
    const {
      fobTotalUSD,    // FOB total do processo (para rateio proporcional)
      freteUSD,       // Frete total em USD (para o processo)
      taxaCalc,       // Câmbio fiscal (base de todos os cálculos)
      taxaCliente,    // Câmbio cliente (PV em USD)
      comissaoPct,    // Comissão de vendas (ex: 0.015)
      custos          // { siscomex, despachante, agente, armazenagem, capatazia, oplog, frodRodov }
    } = ctx;

    const aliq = { ...defaultAliq(), ...(item.aliquotas || {}) };
    const qtd  = Number(item.quantidade)   || 0;
    const fob  = Number(item.fob_unit_usd) || 0;
    const cont = Number(item.containers)   || 1;
    const margem = Number(item.margem_pct) ?? 0.20;

    if (qtd <= 0 || fob <= 0) return null;

    // Rateio proporcional ao FOB
    const fobItem = fob * qtd;
    const prop    = fobTotalUSD > 0 ? fobItem / fobTotalUSD : 0;

    // Frete proporcional ao item: freteUSD × containers do item
    const freteItemUSD = freteUSD * cont;
    const freteItemRS  = freteItemUSD * taxaCalc;

    // CIF do item
    const cifRS = fobItem * taxaCalc + freteItemRS;

    // ── Impostos de importação ────────────────────────────────────────────────
    const ii     = cifRS * aliq.ii;
    const ipi    = cifRS * aliq.ipi;
    const pisImp = cifRS * aliq.pis_importacao;
    const cofImp = cifRS * aliq.cofins_importacao;

    // Total Valor Aduaneiro (CIF + tributos)
    const totalValAdu = cifRS + ii + ipi + pisImp + cofImp;

    // Siscomex rateado por FOB
    const siscomexRat = custos.siscomex * prop;

    // BC ICMS importação (informativo, Lucro Real não entra no custo)
    const bcIcms = totalValAdu + siscomexRat;
    const icmsImp = bcIcms * aliq.icms_inter; // informativo

    // AFRMM = 8% × frete R$ item + R$20 fixo (igual à planilha)
    const afrmm = freteItemRS * 0.08 + 20;

    // Dif. Frete = 2,5% × frete R$ item
    const difFrete = freteItemRS * 0.025;

    // Custos operacionais rateados/por container
    const despRat  = custos.despachante * prop;
    const agenteC  = custos.agente      * cont;
    const armazC   = custos.armazenagem * cont;
    const capatC   = custos.capatazia   * cont;
    const oplogC   = custos.oplog       * cont;
    const frodC    = (custos.frodRodov || 0) * cont;

    // Custo desembaraço (sem frete rodoviário e oplog)
    const custoDesemb = totalValAdu + siscomexRat + afrmm + despRat
                      + difFrete + agenteC + armazC + capatC;

    // Custo processo (inclui frete rodo e oplog)
    const custoProcesso = custoDesemb + frodC + oplogC;

    // Créditos recuperáveis (Lucro Real)
    const credIPI    = ipi;
    const credPIS    = pisImp;
    const credCOFINS = cofImp;
    const credTotal  = credIPI + credPIS + credCOFINS;

    // Custo final de importação (col45 da planilha)
    const custoImpTotal = custoProcesso - credTotal;
    const custoImpUnit  = custoImpTotal / qtd;

    // Custos fixos rateados para exibição
    const cfRat = siscomexRat + afrmm + despRat + difFrete + agenteC + armazC + capatC + oplogC;

    // ── PV — modo iterativo (convergência) ───────────────────────────────────
    let pv;
    if (item.pv_fixo_usd && item.pv_fixo_usd > 0) {
      // Modo manual: PV fixado pelo usuário em USD
      pv = item.pv_fixo_usd * taxaCalc;
    } else {
      pv = custoImpUnit / Math.max(0.001, 1 - margem);
      for (let i = 0; i < 300; i++) {
        const _com    = pv * comissaoPct;
        const _ipiV   = pv * aliq.ipi / (1 + aliq.ipi);
        const _icmsEf = pv * aliq.reg_espec_inter;
        const _bcV    = Math.max(0, pv - _ipiV - _icmsEf);
        const _pisV   = _bcV * aliq.pis_venda;
        const _cofV   = _bcV * aliq.cofins_venda;
        const _o24    = custoImpUnit + _com + _pisV + _cofV + _icmsEf + _ipiV;
        const _o26    = pv - _o24;
        const _csll   = Math.max(0, _o26) * 0.09;
        const _ir     = Math.max(0, _o26) * 0.15;
        const _irAd   = Math.max(0, _o26 * qtd - 60000) * 0.10 / qtd;
        const _cnota  = _o24 + _csll + _ir + _irAd;
        const _pvNovo = _cnota / Math.max(0.001, 1 - margem);
        if (Math.abs(_pvNovo - pv) < 0.0001) { pv = _pvNovo; break; }
        pv = _pvNovo;
      }
    }

    // ── Impostos de venda com PV convergido ──────────────────────────────────
    const com     = pv * comissaoPct;
    const ipiV    = pv * aliq.ipi / (1 + aliq.ipi);
    const icmsEf  = pv * aliq.reg_espec_inter;
    const bcVenda = Math.max(0, pv - ipiV - icmsEf);
    const pisV    = bcVenda * aliq.pis_venda;
    const cofV    = bcVenda * aliq.cofins_venda;

    const o24       = custoImpUnit + com + pisV + cofV + icmsEf + ipiV;
    const o26       = pv - o24;
    const baseTotal = Math.max(0, o26 * qtd);

    const csll   = baseTotal * 0.09;
    const ir     = baseTotal * 0.15;
    const irAdic = Math.max(0, baseTotal - 60000) * 0.10;

    const lucroLiqTotal = o26 * qtd - csll - ir - irAdic;
    const margemReal    = pv > 0 ? (lucroLiqTotal / qtd) / pv : 0;

    return {
      // inputs
      qtd, fob, fobItem, prop, cont, margem,
      // cambios
      freteItemRS, cifRS,
      // importação
      ii, ipi, pisImp, cofImp, icmsImp,
      siscomexRat, afrmm, difFrete, despRat, agenteC, armazC, capatC, oplogC, frodC,
      cfRat, custoDesemb, custoProcesso,
      credIPI, credPIS, credCOFINS, credTotal,
      custoImpTotal, custoImpUnit,
      // venda
      pv, pvUSD: pv / taxaCliente, pvTotal: pv * qtd,
      com, ipiV, icmsEf, pisV, cofV,
      o24, o26, csll, ir, irAdic,
      lucroLiqTotal, lucroUnit: lucroLiqTotal / qtd, margemReal
    };
  }

  /**
   * Calcula o processo completo — agrega todos os itens.
   * Retorna o objeto resultado completo (seção 5.7 do AGENTS.md).
   */
  function calcProcesso(processo) {
    const { cambios = {}, frete = {}, custos_defaults = {}, itens = [] } = processo;

    const taxaCalc    = Number(cambios.fiscal?.taxa) || Number(cambios.di?.taxa) || 5.80;
    const taxaCliente = Number(cambios.cliente?.taxa) || taxaCalc;
    const comissaoPct = Number(custos_defaults.comissao_pct) || 0.015;

    const freteUSD = Number(frete.valor_usd) || 0;
    const freteRS  = freteUSD * taxaCalc;
    const containers = Number(frete.containers) || 1;

    const custos = {
      siscomex:   Number(custos_defaults.siscomex)          || 192.79,
      despachante:Number(custos_defaults.despachante)        || 2500,
      agente:     Number(custos_defaults.agente_cargas)      || 1700,
      armazenagem:Number(custos_defaults.armazenagem)        || 2500,
      capatazia:  Number(custos_defaults.capatazia)          || 1010,
      oplog:      Number(custos_defaults.operador_logistico) || 1000,
      frodRodov:  Number(custos_defaults.frete_rodoviario)   || 0
    };

    // FOB total para rateio
    const fobTotalUSD = itens.reduce((s, it) =>
      s + (Number(it.quantidade) || 0) * (Number(it.fob_unit_usd) || 0), 0);
    const fobTotalBRL = fobTotalUSD * taxaCalc;

    const cifTotalUSD = fobTotalUSD + freteUSD;
    const cifTotalBRL = cifTotalUSD * taxaCalc;

    const ctx = { fobTotalUSD, freteUSD, taxaCalc, taxaCliente, comissaoPct, custos };

    // Calcular cada item
    const resultadosItens = itens.map(it => calcItem(it, ctx));
    const validos = resultadosItens.filter(Boolean);

    // Agregar impostos de importação
    let totalII = 0, totalIPI = 0, totalPIS = 0, totalCOFINS = 0, totalICMSimp = 0;
    let totalCred = 0;
    let custoDesembTotal = 0, custoFinalTotal = 0;
    let totalQtd = 0;
    let totalPVBRL = 0, totalLucro = 0;
    let totalCom = 0, totalIpiV = 0, totalIcmsEf = 0, totalPisV = 0, totalCofV = 0;
    let totalCSLL = 0, totalIR = 0, totalIRAdic = 0;

    validos.forEach(r => {
      totalII       += r.ii;
      totalIPI      += r.ipi;
      totalPIS      += r.pisImp;
      totalCOFINS   += r.cofImp;
      totalICMSimp  += r.icmsImp;
      totalCred     += r.credTotal;
      custoDesembTotal += r.custoProcesso;
      custoFinalTotal  += r.custoImpTotal;
      totalQtd      += r.qtd;
      totalPVBRL    += r.pvTotal;
      totalLucro    += r.lucroLiqTotal;
      totalCom      += r.com * r.qtd;
      totalIpiV     += r.ipiV * r.qtd;
      totalIcmsEf   += r.icmsEf * r.qtd;
      totalPisV     += r.pisV * r.qtd;
      totalCofV     += r.cofV * r.qtd;
      totalCSLL     += r.csll;
      totalIR       += r.ir;
      totalIRAdic   += r.irAdic;
    });

    const custoUnitarioBRL = totalQtd > 0 ? custoFinalTotal / totalQtd : 0;
    const custoUnitarioUSD = taxaCalc > 0 ? custoUnitarioBRL / taxaCalc : 0;
    const pvMedioUSD       = totalQtd > 0 && taxaCliente > 0 ? totalPVBRL / totalQtd / taxaCliente : 0;
    const margemMedia      = totalPVBRL > 0 ? totalLucro / totalPVBRL : 0;

    // AFRMM e DifFrete globais (processo)
    const afrmmTotal   = freteRS * 0.08 + 20;
    const difFreteTotal = freteRS * (Number(frete.dif_frete_pct) || 0.025);

    return {
      fob_total_usd: fobTotalUSD,
      fob_total_brl: fobTotalBRL,
      frete_intl_usd: freteUSD,
      frete_intl_brl: freteRS,
      cif_total_usd: cifTotalUSD,
      cif_total_brl: cifTotalBRL,

      impostos_importacao: {
        ii:       totalII,
        ipi:      totalIPI,
        pis:      totalPIS,
        cofins:   totalCOFINS,
        siscomex: custos.siscomex,
        afrmm:    afrmmTotal,
        dif_frete: difFreteTotal,
        icms_informativo: totalICMSimp
      },

      creditos: { ipi: totalIPI, pis: totalPIS, cofins: totalCOFINS, total: totalCred },

      custo_desembaraco_total: custoDesembTotal,
      custo_final_total:       custoFinalTotal,
      custo_unitario_brl:      custoUnitarioBRL,
      custo_unitario_usd:      custoUnitarioUSD,

      impostos_venda: {
        icms_efetivo: totalIcmsEf,
        ipi:          totalIpiV,
        pis:          totalPisV,
        cofins:       totalCofV,
        comissao:     totalCom,
        csll:         totalCSLL,
        ir:           totalIR,
        ir_adicional: totalIRAdic
      },

      nf_total_brl:          totalPVBRL,
      custo_processo_total:  custoDesembTotal,
      lucro_brl:             totalLucro,
      margem_pct:            margemMedia,

      pv_medio_brl: totalQtd > 0 ? totalPVBRL / totalQtd : 0,
      pv_medio_usd: pvMedioUSD,
      total_unidades: totalQtd,

      // espelho AGENTS.md 5.7
      saldo_caixa: totalLucro
    };
  }

  return { calcProcesso, calcItem, defaultAliq };
})();
