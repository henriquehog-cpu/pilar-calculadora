# Spec — Reforma visual da Calculadora: tabela linha a linha com acordeão (v1)

**Para:** Claude Code (`~/pilar-calculadora`)
**Arquivo-alvo:** `index.html` (a Calculadora servida na raiz `/`).
**Natureza:** reforma **100% de tela**. O motor de precificação é chamado exatamente como hoje, com as mesmas entradas e saídas.

---

## REGRA INVIOLÁVEL — o motor não muda

**Esclarecimento factual (V.0):** a Calculadora **não usa `painel/js/calc.js`** — o motor dela é **inline no próprio `index.html`** (funções `calcItem`, `calcAll`, `defaultAliq`, `updateAFRMM`, `updateDifFrete`, `totalCF`, e a bidirecionalidade `onMargemChange`/`onPvUsdChange`). `calc.js` é o motor do **painel** (wizard), não da calculadora.

Portanto a regra "motor não muda, hash verificado" será cumprida em **dois níveis**:
1. `painel/js/calc.js` — hash inalterado (a calculadora nem o carrega, então trivialmente verdadeiro).
2. **Motor inline da calculadora** — as funções `calcItem`, `calcAll`, `defaultAliq`, `updateAFRMM`, `updateDifFrete`, `totalCF`, `onMargemChange`, `onPvUsdChange` ficam **byte-a-byte idênticas** (verificado por hash do bloco antes/depois). Só muda a camada de apresentação.

---

## V.0 — Investigação (mapa do acoplamento tela ↔ motor)

**Como os campos alimentam o motor (tudo por `id` de elemento):**
- Por item: `qtd_<id>`, `fob_<id>`, `frod_<id>`, `cont_<id>`, `margem_<id>`, `pvusd_<id>` (inputs) + `itemAliq[<id>]` (alíquotas em memória, setadas por `setAliq`/`selectProd`).
- Do processo: `dolar`, `frete_total`, `comissao`, e custos fixos `c_siscomex`/`c_afrmm`/`c_despachante`/`c_difrete`/`c_agente`/`c_armazenagem`/`c_capatazia`/`c_oplog`.

**Onde os resultados são lidos:** `renderItemResult(id, r)` escreve em `r_<suf>_<id>` (sufixos: `cif, ii, ipi, piI, coI, icI, cfR, frd, crd, ciT, ciU, com, ipV, piV, coV, icE, csl, ir, ira, pvU, pvD, pvT, mrg, luc`) e o Resumo Geral em `s_*`. **Conclusão:** o motor lê/escreve só por `id`; **se os ids forem preservados no novo markup, o motor funciona sem nenhuma alteração.**

**Bidirecionalidade PV↔Margem:**
- `onMargemChange(id)`: `pvManual[id]=false` → `calcAll()` (modo iterativo PV = custo/(1−margem)); `renderItemResult` sincroniza o campo `pvusd_<id>`.
- `onPvUsdChange(id)`: fixa `pvManual[id]=true`, roda `calcItem` auxiliar para obter `custoImpUnit`, deriva a Margem implícita e escreve em `margem_<id>`; depois `calcAll()`.
- `renderItemResult` só sobrescreve `pvusd_<id>` quando **não** está em foco e `pvManual[id]` é falso.

**Recálculo ao editar dólar fiscal / custos fixos:** todos os inputs do processo têm `oninput="calcAll()"`. `calcAll()` chama `updateAFRMM()`/`updateDifFrete()` (recalculam AFRMM e Dif.Frete a partir de containers×dólar), recomputa `total_cf`, soma FOB do processo, roda `calcItem` por item e atualiza o Resumo. **PV R$ = PV USD × dólar fiscal** sai naturalmente (`r.pv = r.pvUSD × dolar`).

**Persistência (compatibilidade):** `getSimState()`/`applySimState()` usam **apenas os ids dos campos** (`prod_/qtd_/fob_/cont_/frod_/margem_/pvusd_`), nunca a estrutura do card. O formato salvo (`{v,ts,cliente,…,items:[{prod,qtd,fob,cont,frod,margem}]}`) **não muda**. `applySimState` recria itens via `addItem()` e seta os campos → as 6+ simulações abrem idênticas desde que os ids sejam mantidos.

**Semeadura demanda→calculadora:** `loadSeedFromURL` → `semearItem` → `addItem()` + `seedSelecionarItem` (casa por nome exato no catálogo genérico; ambíguo/ausente → `seedMarcarNaoEncontrado` escreve aviso em `cadastro_<id>`). Usa ids `prod_/ncm_/aliq_/cadastro_`.

**Autocomplete:** `filterAC`/`acKey`/`selectProd`/`setAliq` usam `prod_<id>`, `ac_<id>`, `aliq_<id>`, `ncm_<id>`, `fob_<id>`, `cadastro_<id>`.

**Geração de cotação (`showCotacao`):** lê por id (`fob_/qtd_/prod_`) e chama `calcItem` — independente da estrutura do card.

**Container atual:** `<div id="items-container">`; `addItem()` cria `<div class="item-card" id="item_<id>">` e faz append; `removeItem(id)` remove `#item_<id>`. CSS `.item-card/.item-hd/.item-bd`.

---

## Layout aprovado (mock validado pelo Henrique)

Itens viram **tabela, uma linha por item**. Colunas: **Produto** (nome + subtexto com NCM e qtd containers) | **Qtd** | **FOB USD** | **PV USD** | **PV R$** | **Margem** | **Lucro R$** | **chevron**.

- **Edição inline na linha** (estilo planilha): `Qtd`, `FOB USD`, `PV USD`, `Margem` são inputs editáveis na célula. `PV R$` e `Lucro R$` são **sempre calculados, nunca editáveis**. `PV R$ = PV USD × dólar fiscal`.
- **Bidirecionalidade preservada:** editar PV USD atualiza Margem; editar Margem atualiza PV USD (mesmos handlers de hoje).
- **Célula Produto = autocomplete atual embutido** (busca por nome nos genéricos, NCM/alíquotas ao selecionar, aviso "selecione manualmente" quando ambíguo — idêntico a hoje).
- **Margem com badge semafórico:** verde quando margem **real ≥ margem desejada** do item; âmbar abaixo.
- **Acordeão por linha:** clique expande o detalhamento embaixo da linha — **Custos de Importação** (esquerda) e **Custos de Venda & Resultado** (direita), com **TODAS** as linhas de imposto de hoje (nenhuma removida, incluindo a faixa ICMS destacado/efetivo). No expandido ficam também os editáveis de menor uso: **Frete Rodoviário (R$/container)**, **Qtd Containers** e **NCM**. **Múltiplos itens podem ficar expandidos ao mesmo tempo.**
- **Item novo (+ Adicionar Item):** nasce com acordeão **aberto** e foco no autocomplete de Produto. Itens de **simulação salva** ou **semeados de demanda** nascem **fechados**.

**Permanece como está:** cabeçalho (Informações do Processo, Custos Fixos), botões (Adicionar Item, Salvar Simulação, Simulações Salvas, Copiar Link), Configuração da Cotação, Resumo Geral do Processo, Gerar Cotação para o Cliente, deep-links e semeadura.

---

## Estratégia de implementação (baixo risco — preservar todos os ids)

1. **`#items-container` (div) → `<table>`** com `<thead>` (títulos das colunas) e um `<tbody>` por item.
2. **`addItem()`**: cria `<tbody id="item_<id>">` com 2 `<tr>` (linha visível + linha-detalhe do acordeão) e faz append na tabela. `removeItem()` continua removendo `#item_<id>` (agora o tbody). Acordeão **fechado** por padrão.
3. **Novo `addItemUI()`** (chamado só pelo botão "+ Adicionar Item"): `addItem()` + abre o acordeão + foca `prod_<id>`. `init`/`applySimState`/semeadura seguem chamando `addItem()` (fechado).
4. **`itemHTML(id)` reescrito** para emitir a linha + detalhe, **mantendo todos os ids** (`prod_,ac_,aliq_,cadastro_,ncm_,cont_,qtd_,fob_,pvusd_,frod_,margem_` e todos os `r_*_<id>`). Linha visível: Produto(autocomplete) | qtd | fob | pvusd | `r_pvU` | margem(input)+badge | `r_luc` | chevron. Detalhe: NCM/cont/frod editáveis + as duas tabelas `.rt` com todos os `r_*` + faixa ICMS.
5. **`renderItemResult`**: mantém **todas** as escritas atuais (valores idênticos) e **adiciona** apenas a cor do badge semafórico (compara `r.margemReal` com `margem_<id>`). Sem tocar em nenhum `setEl` existente.
6. **CSS**: estilos da tabela/edição-inline/acordeão/badge; reaproveita `.rt`, `.sec-div`, `.icms-badge`, `.aliq-tag`, `.ac-list`, `.cad-cont`.
7. **Motor inline** (`calcItem/calcAll/defaultAliq/updateAFRMM/updateDifFrete/totalCF/onMargemChange/onPvUsdChange`): **não tocar** — hash do bloco verificado antes/depois.

---

## Compatibilidade obrigatória

- As 6+ simulações salvas abrem perfeitamente (mesmo formato de dados — a reforma não muda o salvo).
- Semeadura demanda→calculadora continua funcionando.

## Teste obrigatório antes do commit

- Abrir **cada** simulação salva no layout novo e conferir que **todos** os valores calculados (impostos, PVs, margens, lucros, Resumo Geral) são **idênticos** aos de antes da reforma.
- Hash do `calc.js` inalterado **e** hash do bloco do motor inline da calculadora inalterado.
