# Spec — Calculadora responsiva no mobile: cartões empilhados (v1)

**Para:** Claude Code (`~/pilar-calculadora`)
**Arquivo-alvo:** `index.html` (a Calculadora servida na raiz `/`).
**Natureza:** ajuste **100% de apresentação por largura de tela** (CSS media query, sem detectar device). O motor de precificação, o markup (`itemHTML`) e toda a lógica de UI (autocomplete, acordeão, bidirecionalidade) ficam **byte-a-byte intocados**.

---

## REGRA INVIOLÁVEL — o motor não muda

A mudança vive **inteiramente dentro do bloco `<style>`** — um único `@media(max-width:768px)` novo. Nenhuma linha de JavaScript e nenhum atributo de markup foram alterados. Portanto:

1. **Motor inline da calculadora** (`onMargemChange`, `onPvUsdChange`, `updateAFRMM`, `updateDifFrete`, `totalCF`, `calcItem`, `defaultAliq`, `calcAll`): hash sha256 do bloco **inalterado**.
   - Antes: `6e5d21c5e6f018e16af17befe1aa177eab6eae1b64e5e43d176786fc2678fdec`
   - Depois: `6e5d21c5e6f018e16af17befe1aa177eab6eae1b64e5e43d176786fc2678fdec` ✅
   - (extraído por âncora de conteúdo `function onMargemChange` → `function renderItemResult`, imune ao deslocamento de linhas causado pelo CSS adicionado acima.)
2. `painel/js/calc.js` — a calculadora nem o carrega; trivialmente inalterado.
3. **`itemHTML` e ids** — intocados. Os rótulos do mobile vêm de `::before` via `nth-child`, sem tocar no HTML gerado.

---

## Problema

A tabela linha-a-linha da calculadora (reforma `bca3cdf`, `spec-calculadora-visual-v1.md`) foi desenhada para desktop. No celular as colunas espremem, o **PV USD aparece cortado** e os **badges de alíquota empilham num paredão** — ruim para cotar no celular, que o Henrique usa para ganhar velocidade fora do escritório.

## Layout responsivo (sem detectar device — só largura)

- **Desktop (>768px):** mantém **exatamente** a tabela atual já aprovada. Nada muda (nenhuma regra fora do media query foi tocada).
- **Mobile (≤768px):** cada item vira um **cartão empilhado** no lugar da linha de tabela.

### Anatomia do cartão (mobile)

- **Tabela → blocos:** `#items-table, thead, tbody, tr, td → display:block`; `thead` escondido (acessível, fora da tela).
- **Cada `<tbody id="item_<id>">` = um cartão:** borda, `border-radius:8px`, sombra leve, padding, `margin-bottom`, `position:relative`.
- **Nome do produto no topo, largura cheia:** a célula `.cell-prod` (autocomplete + subtexto NCM/containers + badges de alíquota + botão "Editar alíquotas") ocupa `grid-column:1/-1`. Num cartão largo os badges **fluem em wrap legível**, acabando com o paredão.
- **Campos em grade de 2 colunas, com rótulos visíveis** (via `td:nth-child(n)::before`, sem markup):
  `Qtd | FOB USD` · `PV USD | PV R$` · `Margem | Lucro R$`.
- **Editáveis com o dedo:** Qtd, FOB USD, PV USD, Margem → inputs com `min-height:44px` (touch-friendly).
- **Resultados (não editáveis):** PV R$ (`r_pvU_`) e Lucro R$ (`r_luc_`) exibidos como texto.
- **Badge de margem** (verde ≥ meta / âmbar abaixo) mantido, abaixo do input de Margem.
- **Chevron do acordeão** posicionado no canto superior direito do cartão (`position:absolute`).
- **Acordeão de detalhamento** (Custos de Importação + Custos de Venda & Resultado, com todas as linhas de imposto e a faixa ICMS): mantido. Como `toggleAcc`/`abrirAcc` abrem via `style="display:table-row"` inline, o CSS o reinterpreta como bloco de largura cheia no cartão via seletor `.item-det[style*="table-row"]{display:block!important}` — **sem tocar no JS**.
- **NCM, Qtd. Containers, Frete Rodoviário e Remover item** seguem dentro do acordeão.

### Cabeçalho e Custos Fixos

`.g2,.g3,.g4,.g5 → grid-template-columns:1fr` no mobile: os campos do **cabeçalho (Informações do Processo)** e dos **Custos Fixos do Processo** empilham um abaixo do outro, em vez de espremidos lado a lado.

## O que NÃO muda

Mesmos ids, mesma lógica, mesmo motor. Bidirecionalidade PV↔Margem e todos os recálculos funcionam igual nos dois layouts (mesmos handlers, mesmos campos). Persistência, semeadura demanda→calculadora, autocomplete, geração de cotação: idênticos.

---

## Testes executados

1. **Hash do motor inalterado** — bloco `onMargemChange…calcAll` byte-a-byte idêntico (acima). ✅
2. **Diff é só CSS** — `git diff` = 1 hunk, 52 inserções, dentro do `<style>` (linha ~146). ✅
3. **Regressão de cálculo (jsdom, HEAD vs. árvore alterada):** carregada a página real nos dois estados com `fetch` stubado (devolve `produtos_genericos.seed.json` em `/api/produtos-genericos`), aplicada **cada uma das 24 simulações de produção** (`sims_prod_teste.json`) e comparados **todos os 24 sufixos `r_*` por item + os 8 `s_*` do Resumo**. Resultado: **24 sims, 90 itens, 100% idênticos**. ✅
   - O layout não toca cálculo: confirmado empiricamente, não só por inspeção.
4. **Asserção estática do CSS** — verificadas as 15 regras-chave do `@media(max-width:768px)` (cartão, grade 2-col, 6 rótulos, inputs ≥44px, chevron absoluto, acordeão→bloco, headers empilhados) + chaves balanceadas. ✅
5. **Verificação visual de viewport (~375px = cartões / ~1200px = tabela):** a cargo do Henrique no navegador/celular (jsdom não tem engine de layout).

**`sims_prod_teste.json`** é dado de produção (gitignored) — **apagado ao final**, nunca vai ao GitHub.
