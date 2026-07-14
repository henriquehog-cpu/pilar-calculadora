# ARQUITETURA — Painel PILAR

> Retrato técnico do sistema, fiel ao código real (`painel.html`, `painel-proxy.js`,
> `painel/js/calc.js`, `painel/js/calc-processo.js`, `index.html`).
> Manutenção obrigatória: ver a regra em `CLAUDE.md`.

---

## 1. VISÃO GERAL

Sistema web da PILAR Imports para precificação e gestão operacional de importações
(Lucro Real · MG · venda interestadual). Roda num VPS (Ubuntu, nginx + PM2 em
`/opt/pilar-calculadora`), servido pelo próprio proxy Node em `:8080` (`PORT`).

### Arquivos principais

| Arquivo | Papel |
|---|---|
| `index.html` (~2071 linhas) | **Calculadora** standalone — precificação rápida de itens (usa `Calc` do `calc.js`). Aceita `?seed=` (pré-preenche a partir de uma demanda) e `?demandaId`. |
| `painel.html` (~6900+ linhas) | **Painel operacional** SPA — todas as telas (Dashboard, Processos, Fluxo de Caixa, Câmbio, Fornecedores, Demanda, documentos, catálogo, config). HTML + CSS + JS inline num arquivo só. |
| `painel-proxy.js` (~1050 linhas) | **Backend** Node puro (sem framework): serve estáticos, expõe `/api/*`, proxeia Omie e Anthropic, persiste os JSON no servidor. |
| `painel/js/calc.js` | **Motor fiscal por item** (`Calc.calcItem`, `Calc.calcProcesso`, `Calc.difalRate`). Módulo dual: `require` no Node, global no browser. |
| `painel/js/calc-processo.js` | **Régua fiscal de processo** (`npCalcResultado`, `impostosPosVenda`, `vencMesSeguinte`) — camada acima do `calc.js`, **fonte única** usada IGUAL pelo browser e pelo backend. |

`painel/js/app.js`, `documentos.js`, `fluxo-caixa.js`, `omie.js`, `processos.js`,
`ptax.js` são de uma estrutura modular antiga (mai/2024) — **o painel em produção é o
`painel.html` monolítico**; só `calc.js` e `calc-processo.js` de `painel/js/` são usados.

### Stack e libs
- **Backend:** Node.js `http`/`https` puros (sem Express). Escrita atômica em disco.
- **Frontend:** HTML/CSS/JS vanilla, sem framework. Navegação por hash.
- **Libs externas:** `xlsx-js-style@1.2.0` (via CDN jsdelivr) para exportar/importar
  `.xlsx`. Sem outras dependências de runtime no frontend.
- **Externos:** API Omie (produtos), API Anthropic (`claude-sonnet-4-6`) para os fluxos de IA.

---

## 2. ESTRUTURA DE DADOS (arquivos no servidor)

Todos vivem na raiz do projeto no servidor, **gitignorados** (dado, não código):
`dados.json`, `fornecedores.json`, `cambios.json`, `catalogo_omie.json`,
`produtos_genericos.json`, `pilar-config.json`, `config/fornecedores-bloqueados.json`.

### `dados.json` — store principal (objeto)
Lido por `lerDados()` (garante as chaves-array). Chaves:
- `pilar_processos: []` — os processos de importação (ver schema abaixo).
- `pilar_demandas: []` — demandas/cotações (Nova Demanda).
- `pilar_simulacoes: []` — simulações da Calculadora.
- `pilar_config: {}` — configurações; inclui `frete_referencia` (frete 40'HC de
  referência, alimentado pela Astrid) e `defaults` (custos operacionais padrão).
- `pilar_descricoes_di: {}` — descrições de DI por família/código.

### `fornecedores.json` — cadastro de fornecedores (array) [Fatia 1]
`{ nome, endereco, dados_bancarios, pais_origem }` — `endereco` e `dados_bancarios`
são TEXTO LIVRE (blocos com quebras de linha). Fonte do match do memorando de câmbio.

### `cambios.json` — histórico de fechamentos de câmbio (array) [Fatia 2B] — APPEND-ONLY
Cada registro (gravado por `mcBuildRegistro`, regenerável em PDF pela tela Câmbio):
```
{ id, criado_em, processo_id, processo_num, parcela_id, fornecedor,
  data_emissao, data_fechamento,
  exportador:{ nome, endereco, dados_bancarios, pais_origem },
  importador:{ nome, cnpj },
  itens_cambio:[ { _parcela_id, invoice, bl, valor_usd, moeda, taxa, valor_reais, prev_embarque } ],
  total:{ usd, reais },
  modalidade:{ antecipado_pct, avista_pct, aprazo_pct, outros_pct, outros_desc, fluxo } }
```

### `catalogo_omie.json` — catálogo Omie (array), sincronizado da API/planilha Omie
`{ produto, codigo, ncm, familia, unidade, peso_liq_unit, peso_bruto_unit, ii, ipi,
  pis_importacao, cofins_importacao, ..., origem:'omie' }`.

### `produtos_genericos.json` — catálogo genérico (array), semente `produtos_genericos.seed.json`
Mesma forma do Omie + `origem:'generico'`. Base de alíquotas por produto/NCM.

### Schema de um **PROCESSO** (`pilar_processos[i]`)
```
{
  id, numero (ex "PIL-009-2026"), status ('ativo'|'finalizado'), criado_em, atualizado_em,
  dados_gerais: { data_pedido, cliente, fornecedor, pais, incoterm, numero_proforma,
                  prev_embarque, prev_chegada_porto, prev_chegada_cliente,
                  cliente_sem_ie (bool → DIFAL), aliq_interna_destino (%) },
  cambios: { di:{taxa}, fiscal:{taxa}, cliente:{taxa} },
  frete: { valor_usd, containers },
  custos_defaults: { comissao_pct, frete_rodoviario, siscomex, despachante,
                     agente_cargas, armazenagem, capatazia, operador_logistico },
  itens: [ { codigo, descricao, quantidade, fob_unit_usd, unidade, margem_pct,
             pv_fixo_usd?, aliquotas:{ii,ipi,pis_*,cofins_*,icms_*,reg_espec_*}, resultado? } ],
  operacional: { invoice:{num,data}, packing:{num,data}, bl:{num,data}, di:{num,data},
                 conteineres, navio, viagem, free_time_dias, demurrage, onedrive_link,
                 recebidos:{...checklist}, enviados:{...checklist} },
  notasFiscais: [ {tipo,numero,data} ],
  pagamentos_fornecedor: [ { id, descricao, percentual, valor_usd, data_prevista,
                             data_realizada, cambio, valor_reais, status ('previsto'|'pago'|'atrasado'), usd_manual } ],
  recebimentos_cliente:  [ { ...análogo, status ('previsto'|'recebido'|'atrasado') } ],
  numerario_despachante: [ ... ],
  resultado: { fob_total_usd, cif_total_brl, custo_final_total, nf_total_brl, lucro_brl, margem_pct, ... },
  pvItens?, demandaId?   // quando o processo nasceu de uma demanda
}
```

---

## 3. BACKEND (`painel-proxy.js`)

### Helpers de I/O e store
- `lerJson(file, fallback)` — parse tolerante (retorna `fallback` em erro).
- `gravarAtomico(file, obj)` — escreve `.tmp` e `renameSync` por cima (**atômico**: crash
  no meio não corrompe o arquivo).
- `lerDados()` — lê `dados.json` garantindo `pilar_processos/demandas/simulacoes` como arrays.
- `salvarDados(d)` = `gravarAtomico(DADOS_FILE, d)`.
- `mergeFatiaPorId(req,res,chave,label)` — **merge por id** (upsert, nunca remove o
  omitido) das fatias-array do `dados.json`; `?modo=substituir` faz replace total.
  Para `pilar_processos` roda `validarCodigosProcessos` → `gerarCodigosFaltantes` →
  `completarNcmAliquotas` antes de gravar (rejeita código malformado com 400).
- `chamarAnthropic(systemPrompt, mensagens)` — POST `api.anthropic.com/v1/messages`
  via HTTPS puro; chave **só** de `process.env.ANTHROPIC_API_KEY` (nunca de arquivo);
  modelo `claude-sonnet-4-6`, `anthropic-version: 2023-06-01`.

### Rotas `/api/*`

| Método/Rota | O que faz |
|---|---|
| `POST /omie` | Proxy da API Omie (resolve CORS); credenciais de `pilar-config.json`. |
| `GET /api/dados` | Retorna o `dados.json` inteiro. |
| `POST /api/dados` | **Merge defensivo BLINDADO**: parte do disco e só sobrescreve chaves presentes no payload (chave ausente = preservada); valida tipos; escrita atômica. Evita apagar fatias por omissão. |
| `GET/POST/DELETE /api/produtos-genericos[/:nome]` | Catálogo genérico: GET lê; POST faz merge por nome (`?modo=substituir` com guarda de encolhimento ≥20); DELETE remove 1 por nome. |
| `GET/POST /api/catalogo-omie` | Catálogo Omie: GET lê; POST substitui o array inteiro. |
| `GET/POST /api/fornecedores` | **[Fatia 1]** Cadastro: GET lê; POST substitui o array inteiro. |
| `GET/POST /api/cambios` | **[Fatia 2B]** Histórico de câmbio: GET lê; **POST é APPEND-ONLY** (recebe UM registro, faz `push`, carimba `id`/`criado_em`; nunca sobrescreve). |
| `GET /api/produtos` | Alias read-only do catálogo genérico (compat). `POST` → 410. |
| `GET/POST/DELETE /api/processos[/:id]` | GET lista/1; **POST = `mergeFatiaPorId('pilar_processos')`**; DELETE remove 1. |
| `GET/POST/DELETE /api/demandas[/:id]` | Fatia `pilar_demandas` (merge por id). |
| `GET/POST/DELETE /api/simulacoes[/:id]` | Fatia `pilar_simulacoes` (merge por id). |
| `GET /api/banco-di` | Lê `banco_di.json` (templates de descrição de DI por família). |
| `POST /api/etiquetas` | Gera etiquetas `.xlsx` (via script Python). |
| `POST /api/proposta` | Gera proposta `.docx` (via script Python). |
| `GET /api/resumo-diario` | **Read-only**. Monta o briefing diário consumido pela **Astrid** (Telegram): processos ativos, parcelas/recebimentos próximos etc. |
| `GET /api/impostos-posvenda` | **Read-only**. Impostos pós-venda por processo via a régua única (`calc-processo.js`). |
| `POST /api/ia/chat` | Chat com IA. Valida `fluxo` (`qualificacao`/`proposta`/`extracao`) + `mensagens`; teto de base64 (imagens); rate-limit 20/min; `systemPrompt` de `prompts/<fluxo>.md`; chama `chamarAnthropic`. |

### Auto-sync do `dados.json` (frontend → backend)
No `painel.html`, `localStorage.setItem` é interceptado: mudança nas chaves do
`_PILAR_KEYS` (`pilar_processos`, `pilar_config`, `pilar_descricoes_di`) dispara
`_apiSincronizar()` (debounce 400ms) → `POST /api/dados`. **Catálogos, fornecedores e
câmbio NÃO passam por aqui** — têm rotas próprias e são salvos explicitamente.

---

## 4. FRONTEND (`painel.html`)

### Navegação
- Menu lateral com seções: Visão Geral, Importação, Documentos, **Financeiro**, Produtos, Sistema.
- `navTo(el, renderFn)` → seta `location.hash`; `hashchange` → `aplicarHash()` →
  `_apiCarregarProcessos()` + `_despacharHash()`. Tabela `ROTAS` (hash→{fn,nav}) e
  `_fnParaHash` (fn→hash). Cada tela é uma `render*()` que preenche `#vc`.
- Boot: `_apiCarregar()` faz `Promise.all` de `/api/dados`, `/produtos-genericos`,
  `/catalogo-omie`, `/fornecedores`, `/cambios` → popula os caches em `localStorage`
  (`pilar_*`), sem disparar o hook de sync.

### Telas (`render*`)
- **Dashboard** (`renderDashboard`) — visão geral, alertas, atalhos.
- **Relatório Geral** (`renderRelatorioGeral`) — consolidado imprimível.
- **Processos** (`renderProcessos`) — lista/tabela filtrável; abre um processo.
- **Novo/Editar Processo** (`renderNovoProcesso`) — o formulário grande (dados gerais,
  câmbios, frete, itens, operacional, e as seções 5/6/7 de caixa). É onde vive o
  botão 🏦 do memorando de câmbio (por parcela).
- **Nova Demanda** (`renderNovaDemanda`) — cotação assistida por IA (fluxos qualificação/proposta).
- **Documentos:** Order Request (`renderOrderRequest`), Proposta (`renderProposta`),
  Pedido de Embarque (`renderPedidoEmbarque`), Resumo Despachante (`renderResumoDespachante`).
  Todos geram PDF via **HTML + `window.print()`** no `#or-print-area` (não há lib de PDF);
  o CSS `@media print` esconde a UI e mostra só a área de impressão.
  - **PV unitário USD por item — precedência única dos documentos** (helpers
    `pvUnitCalcMap(proc)` + `pvUnitUSD(it, mapa)`, definidos junto de
    `rdBuildProcParaCalc`): `it.resultado?.pv_usd` → `it.pv_fixo_usd` → `pvUSD`
    calculado (`rdBuildProcParaCalc` + `npCalcResultado` → `itens_resultado[]`,
    mapa casado por REFERÊNCIA de item — filtros não desalinham índices).
    Consumida pelos 3 pontos: Proposta (`propSelecionarProcesso`), Pedido de
    Embarque (`peCompute`) e Fluxo de Caixa (`fcNfTotalUSD`) — documento e tela
    nunca divergem, inclusive em processo manual (PV derivado de FOB+margem).
    Só o PV resultante entra nos documentos — FOB/custo/margem continuam fora.
  - **Herança na Proposta** (`propSelecionarProcesso`): com `proc.pvItens`
    (processo nascido de demanda) herda qtd+PV de lá e a **unidade** de
    `proc.itens` (por índice). Sem `pvItens` (processo manual), usa a precedência
    acima, arredondada a 4 casas (mesma precisão exibida pelo PE). Campo continua
    editável — o PV herdado é só o valor inicial. O **câmbio do sinal** também é
    herdado: 1ª parcela de `recebimentos_cliente`, fallback câmbio fiscal/DI —
    mesma regra do PE (`peSelecionar`).
- **Fluxo de Caixa** (`renderFluxoCaixa`) — consolidado de todos os processos: resumo por
  mês + linha do tempo (parcelas previstas/realizadas), filtro por processo, export `.xlsx`
  (`fcExportarExcel`). Só leitura.
- **Câmbio** (`renderCambio`) **[Fatia 2C]** — rastreabilidade dos fechamentos gravados
  (lê `pilar_cambios`); tabela filtrável (processo/fornecedor/período), rodapé TOTAL,
  botão 🖨 por linha (regenera o PDF via `cambioReimprimir`→`mcDocHTML`) e export `.xlsx`
  (`cambioExportarExcel`, espelha `fcExportarExcel`). Só leitura.
- **Fornecedores** (`renderFornecedores`) **[Fatia 1]** — CRUD do cadastro (lista + busca,
  modal add/editar espelhando `npm*`, remover). Persiste em `/api/fornecedores`.
- **Catálogo** (`renderCatalogo`), **Banco DI** (`renderBancoTabela`), **Configurações** (`renderConfig`).

### Como um processo é montado/salvo
- **`npSalvar()`** — monta `dadosForm` (dados_gerais, cambios, frete, custos, itens,
  operacional, `pagamentos_fornecedor: _fcPagamentos`, recebimentos, numerário),
  calcula `resultado` via `npCalcResultado`, faz upsert por `id` em `pilar_processos`
  (`localStorage.setItem` + `_apiSalvarProcessos`) e **navega para a lista**.
- **`_procSetStatus(id, status)`** — padrão canônico de "salvar uma fatia do processo"
  SEM navegar: lê `todos`, acha por id, muta só o necessário, `atualizado_em`,
  `localStorage.setItem` + `_apiSalvarProcessos`, re-renderiza. É o mecanismo reusado
  pela 2B para aplicar o fechamento na parcela.
- **`_apiSalvarProcessos(arr)`** — `POST /api/processos` (array inteiro; servidor faz merge por id).
- **Estado de caixa** — `_fcPagamentos`/`_fcRecebimentos`/`_fcNumerario` são o estado em
  memória da seção 5/6/7; só persistem via `npSalvar` (ou fatia via `_procSetStatus`).

### Fluxo de caixa (motor)
`fcConsolidadoEventos()` varre todos os processos ativos e emite eventos (parcela = 1
evento; numerário = 1 consolidado/processo), usando `data_realizada` se houver, senão
`data_prevista`. Alimenta a linha do tempo e o `fcExportarExcel`.

### Módulo de câmbio (memorando) — 2A/2B/2C
- **2A (gerar PDF, leitura):** `mcAbrirParcela(i)` garante `id` estável na parcela e abre
  `mcAbrir` com **só aquela parcela**. `mcBuildMemorando(proc)` monta `_mcMemorando`
  (objeto único), casando o exportador com o cadastro por **nome case-insensitive**
  (`mcMatchFornecedor`); fallback com dropdown/campos editáveis se não casar. `mcDocHTML()`
  renderiza o documento "DRAFT P/ FECHAMENTO DE CÂMBIO" (importador PILAR fixo em `MC_PILAR`,
  sem campo de débito).
- **2B (gravar + aplicar):** `mcPrint()` é um ato só — exige processo salvo (senão avisa e
  aborta sem PDF); **«2B-SALVAR»** `_apiSalvarCambio` (append no `cambios.json` + cache);
  **«2B-APLICAR»** `mcAplicarNaParcela` casa por `_parcela_id` e grava na parcela
  `cambio/valor_usd/valor_reais/data_realizada + status:'pago'` via `_procSetStatus`
  (**`data_prevista` fica intacta**; só toca `pagamentos_fornecedor`); depois imprime.
- **2C (rastreabilidade):** `renderCambio` (acima). Reversão pelo motor normal (pago→previsto
  editável, sem trava).

### Calculadora (`index.html`)
Página standalone de precificação por item, usando `Calc` (`calc.js`). Lê `?seed=` para
pré-preencher a partir de uma demanda e grava simulações (via `/api/simulacoes`).

**Cotação / PDF (client-side):** `showCotacao()` monta a tela `#cotacao-sec` (container
`.cot-wrap#cot-content`, largura de projeto **1020px**) com Opção 1 (à vista) / Opção 2
(a prazo) e 3 campos livres (Prazo, Condições, Observações). `gerarPdfCotacao(btn)` gera o
PDF via **html2pdf (CDN)** — fora do caminho de `window.print()`, sem URL/rodapé do
navegador. Não toca no motor: clona `#cot-content` e (a) renderiza sempre a **1020px**
(`holder`/`clone` fixos, `maxWidth:none`), independente do viewport; (b) aplica
`white-space:nowrap` nos `<td>` numéricos da `.cot-table` (colunas à direita, ambas as
serializações do atributo `style`) p/ valores tipo `USD 11.687,86` não quebrarem;
(c) converte `<textarea>` → `<div>` com visual do `@media print` (`border:none;padding:0`),
**removendo o campo + o `.cot-lbl` anterior quando vazio** (sem label órfão nem caixa vazia);
(d) restringe `pageBreakInside:avoid` a `tr`/`.cot-hdr`/`.cot-nota` (não à tabela nem ao
`.cot-footer`), deixando o rodapé fluir na mesma página quando couber.

---

## 5. O CÁLCULO — régua fiscal

**Fonte única:** `painel/js/calc-processo.js` (`npCalcResultado`) sobre
`painel/js/calc.js` (`Calc.calcItem`). Consumida IGUAL pelo browser e pelo backend
(`/api/impostos-posvenda`, resumo diário). Lucro Real · MG · venda interestadual.

### `Calc.calcItem(item, ctx)` — por item
**Entradas:** item (`quantidade`, `fob_unit_usd`, `margem_pct`, `pv_fixo_usd?`,
`aliquotas`) + contexto (`fobTotalUSD`, `freteUSD` rateado, `taxaCalc` fiscal,
`taxaCliente`, `comissaoPct`, `custos` rateados).
**Calcula:**
- **CIF** = FOB×taxaCalc + frete R$ do item.
- **Importação:** II, IPI, PIS-imp, COFINS-imp (sobre CIF); **Total Valor Aduaneiro**;
  Siscomex rateado por FOB; **AFRMM** = 8%×frete R$ + R$20; **Dif. Frete** = 2,5%×frete R$;
  ICMS-imp informativo (não entra no custo em Lucro Real).
- **Créditos recuperáveis** (IPI+PIS+COFINS de importação) → **custo final de importação**
  = custo processo − créditos.
- **PV** iterativo (até 300 iterações, convergência < 0,0001) resolvendo comissão, IPI de
  venda, ICMS efetivo (`reg_espec_inter`), PIS/COFINS de venda, CSLL 9%, IR 15% + adicional
  10% sobre lucro > R$60.000. Se `pv_fixo_usd` > 0, usa PV manual (sem iterar).
- **Venda** com PV convergido; **lucro líquido** e **margem real** por item.

### `npCalcResultado(proc)` — agrega o processo
Ratея frete e custos por-container por `prop = FOB do item / FOB total` (força
`containers:1` por item — Siscomex/despachante são rateados dentro do `calcItem`), soma os
itens e monta:
- `imp_imp` (crédito de importação: ii, pis, cofins, ipi, siscomex, afrmm, dif_frete, total),
- `imp_venda` (débito: icms, ipi, pis, cofins, csll, ir, ir_adicional, comissao),
- `cif_total_brl`, `custo_final_total`, `custos_op_total`, `nf_total_brl` (venda total),
- **DIFAL** (Opção B): `nf_total × difalRate(cliente_sem_ie, aliq_interna_destino)` — só
  quando o cliente é sem IE; interna default 18%, interestadual fixa 4%; **absorvido pela
  PILAR** (descontado do lucro, não repassado, não altera PV nem escudo IR/CSLL),
- `lucro_brl` (= lucro − DIFAL) e `margem_pct`.

### `impostosPosVenda(proc)` — read-only, NÃO persistido
Líquido a recolher por processo (débito de venda − crédito de importação; ≤0 omite),
ICMS efetivo 1,5% sempre, IRPJ/CSLL como estimativa. Vencimentos no **mês seguinte à
entrega** (`prev_chegada_cliente`): ICMS dia 8, federais dia 26 (`vencMesSeguinte`,
string-math, dez→jan).

**Validação contra Excel:** a lógica de `calcItem` replica a planilha "TABELA DE PREÇOS —
MATRIZ — JUROS — LR.xlsx" (CIF, AFRMM 8%+R$20, Dif.Frete 2,5%, custo final col45, PV
iterativo, IR adicional > R$60k). O DIFAL Opção B espelha `difalRateAtual()` do `index.html`.

---

## 6. INTEGRAÇÕES

### Astrid (bot Telegram — externo ao repo)
Consome, **read-only**, endpoints do proxy:
- `GET /api/resumo-diario` — briefing diário (processos ativos, parcelas/recebimentos próximos).
- `GET /api/impostos-posvenda` — impostos a recolher (mesma régua da tela).
- Também **escreve** via `POST /api/processos` (merge por id — payload parcial não apaga o
  resto) e alimenta o **frete de referência** (`pilar_config.frete_referencia`, tela
  read-only "Frete de Referência 40'HC" no painel).
- O dashboard e o resumo diário filtram `status === 'ativo'` (finalizados somem de ambos).

### IA da Nova Demanda / documentos
`POST /api/ia/chat` com `fluxo ∈ {qualificacao, proposta, extracao}`; system prompts em
`prompts/*.md`; modelo `claude-sonnet-4-6` via `chamarAnthropic`. Aceita imagens
(base64, teto ~14MB), rate-limit 20/min. Chave só em `ANTHROPIC_API_KEY` no servidor.

---

## 7. CONVENÇÕES E ARMADILHAS

### Padrões a seguir
- **Novo "banco de dados" no servidor:** espelhar `catalogo_omie.json`/`fornecedores.json`
  — arquivo próprio na raiz, **gitignorado**, constante `X_FILE`, par de rotas
  `GET/POST /api/x` com `lerJson` + `gravarAtomico`, fora do auto-sync do `/api/dados`,
  e cache `pilar_x` populado no boot por `_apiCarregar`. Entra na proteção de backup do deploy.
- **Gravar uma fatia do processo sem navegar:** usar o padrão **`_procSetStatus`**
  (upsert por id + `_apiSalvarProcessos` + re-render). **Não** chamar `npSalvar` (ele
  navega para a lista de Processos).
- **Append-only (`cambios.json`):** o POST anexa UM registro (nunca substitui) — histórico
  de rastreabilidade não pode ser apagado por engano.
- **Documentos = `window.print()`** no `#or-print-area`; não há lib de PDF. Reusar
  `mcDocHTML`/`peDocHTML` para regenerar a partir de um registro salvo.
- **`esc(s)`** escapa só aspas (`"`), não `<`/`>` — convenção do código; textos livres do
  cadastro usam `white-space:pre-wrap` para preservar quebras.

### Bugs latentes / código morto
- **`Calc.calcProcesso` é código paralelo** ao `npCalcResultado` e **não é usado** pela
  régua de produção (`calc-processo.js` agrega por conta própria via `calcItem`). Os dois
  têm **defaults divergentes** (agente 1700 vs 1800, armazenagem 2500 vs 2600, comissão
  0,015 vs 0,02, taxa fallback 5,80). Se algum dia `calcProcesso` voltar a ser chamado,
  vai divergir do resultado real da tela — **fonte de verdade é `npCalcResultado`**.
- Estrutura modular antiga em `painel/js/` (`app.js`, `processos.js`, etc.) está **morta**
  — só `calc.js`/`calc-processo.js` são usados.

### Quirks
- **`xlsx-js-style` / datas:** datas são exportadas como **serial do Excel** (`t:'n'` +
  formato `dd/mm/yyyy`), TZ-safe via `Date.UTC` das partes locais (evita as quirks de
  célula `t:'d'` desta build). Ver `fcExportarExcel`/`cambioExportarExcel`.
- **PV manual vs iterativo:** `pv_fixo_usd > 0` desliga a convergência (usa o PV fixado).
- **Persistência do PV manual na Calculadora:** `getSimState` grava por item `pvusd` +
  `pv_manual`; `applySimState` restaura o flag/valor quando `pv_manual===true` e `pvusd>0`
  (senão limpa, como sim antigas). Sem isso o PV manual seria recalculado no load e
  divergiria, pois a margem derivada usa base de custo diferente do loop iterativo.
- **Códigos de processo/item:** o servidor valida/gera código (`FAMÍLIA.LARGURA.GRAMATURA.NNNN`)
  no `mergeFatiaPorId` — um item com código malformado faz o POST inteiro do processo
  retornar 400.
- **`data_realizada` vs `data_prevista`:** o fechamento de câmbio (2B) grava a data real em
  `data_realizada` e **preserva `data_prevista`**; o fluxo de caixa usa `data_realizada`
  quando existe.

---

## Deploy (resumo)
VPS `/opt/pilar-calculadora`, Node + PM2 (`pm2 restart all`), nginx. Mudança só em
`painel.html`/`index.html` → basta subir o arquivo. Mudança em `painel-proxy.js` (rota nova)
→ subir o proxy **e** reiniciar o PM2. Os `*.json` de dados vivem só no servidor
(gitignorados) e entram na rotina de backup.
