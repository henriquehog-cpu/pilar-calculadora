# Spec — Separação dos catálogos Genérico × Omie (v1)

**Para:** Claude Code (`~/pilar-calculadora`)
**Base:** diagnóstico em `investigacao-catalogo-jun2026.md` (jun/2026).
**Problema:** genéricos (matriz comercial, ~332, por nome, com NCM+alíquotas) e itens Omie (800+, por código) viviam num **array único** (`produtos.json` = `/api/produtos` = cache `pilar_produtos`), sem marcador de origem. O sync do Omie fazia **replace** e apagava os genéricos; o deploy (`git reset --hard`) restaurava os genéricos e apagava o Omie — oscilação.

---

## Arquitetura decidida

### 1. Dois arquivos de catálogo (dado de runtime, gitignorados como `dados.json`)

- **`produtos_genericos.json`** — matriz comercial (os 332 atuais).
  Escrito **apenas** por: cadastro manual do painel/calculadora.
  O sync Omie **NUNCA** escreve aqui.
- **`catalogo_omie.json`** — itens do Omie.
  Escrito **apenas** por: `sincronizarOmie()` (replace é correto — Omie é a fonte da verdade desse arquivo), import XLSX (planilha de export do Omie), e fluxos código/família do Novo Processo.
- **`produtos_genericos.seed.json`** — semente **versionada** no git (cópia dos 332 atuais, já com a flag `origem`). Usada **só em instalação do zero**, quando o arquivo runtime não existe.

### 2. Marcador explícito de origem

Todo item ganha `origem: "generico"` ou `origem: "omie"`.

**Migração única no servidor (startup):**
- Se `produtos_genericos.json` não existe → cria a partir do `produtos.json` atual (332, validados como todos genéricos), marcando cada item com `origem: "generico"`; se `produtos.json` também não existir, usa `produtos_genericos.seed.json`.
- Se `catalogo_omie.json` não existe → nasce **vazio** (`[]`) até o próximo sync.
- A migração **nunca** sobrescreve um arquivo runtime já existente (idempotente).

### 3. Rotas (escrita atômica, padrão `salvarDados`: tmp no mesmo dir + rename)

- `GET/POST /api/produtos-genericos`
- `GET/POST /api/catalogo-omie`
- `GET /api/produtos` → **alias read-only** do catálogo genérico (compatibilidade temporária).
  `POST /api/produtos` → **410 (descontinuado)**, aponta para as rotas novas.
- `POST /api/dados` **intocado** (fora de escopo; aposentadoria fica para depois).

### 4. Consumidores — quem lê o quê

**Decisão (confirmada): seguir a realidade do código.**
- **Genéricos** (`produtos_genericos.json` / cache `pilar_produtos_genericos`), casamento por **nome**:
  - Calculadora (`index.html`): load inicial, autocomplete, NCM/alíquotas, semeadura de demanda, cadastro de produto.
  - Extração por IA (fluxo `extracao`): recebe os **nomes dos genéricos**.
- **Omie** (`catalogo_omie.json` / cache `pilar_catalogo_omie`), casamento por **código/família**:
  - Wizard Novo Processo: detecção `is_novo` (→ exportar ao Omie), geração de SKU sequencial, NCM/alíquotas por família, autocomplete por código.
  - Tela "Catálogo Omie" (`renderCatalogo`/`catFiltrar`).
  - `sincronizarOmie()`, import XLSX, exportação ao Omie, `atualizarFOBProdutos` (casa por código), `npSalvarAliquotas` (propaga no catálogo do item editado — itens de processo são Omie).

**`npSalvarAliquotas` / `atualizarFOBProdutos`:** continuam escrevendo o que escrevem hoje (alíquotas por item, FOB), apenas **roteados para o arquivo do catálogo do item** que estão editando (itens de processo → Omie). Modelo de alíquotas por item **não muda** nesta etapa.

### 5. Cache localStorage

- `pilar_produtos` → **separado** em `pilar_produtos_genericos` e `pilar_catalogo_omie`.
- `pilar_produtos` sai do conjunto de auto-sync (`_PILAR_KEYS`) e do `POST /api/dados` (catálogos têm rotas próprias).
- Rótulo do prompt de extração: **"CATÁLOGO OMIE" → "CATÁLOGO DE PRODUTOS"** (em `painel.html` e `prompts/extracao.md`).

### 6. Nada cruza os catálogos automaticamente

A ponte (desdobramento genérico → SKU Omie) é **etapa futura, fora deste escopo**.

### 7. Deploy e backup

- `backup_dados.sh` (vive no VPS) passa a incluir `produtos_genericos.json` e `catalogo_omie.json`.
- Nova linha de deploy preserva `dados.json` + `produtos_genericos.json` + `catalogo_omie.json` no `git reset --hard`. (Os dois arquivos são gitignorados, então o `reset` não os remove de qualquer forma; o `cp` é redundância de segurança.)

---

## NÃO TOCAR (regras invioláveis desta etapa)

- Motor de precificação (verificar por hash que `index.html`/`painel/js/calc.js` de cálculo não mudam).
- Fluxo de demanda/qualificação, Proposta Comercial e demais documentos.
- `POST /api/dados`.
- Tela da calculadora (reforma visual é etapa futura separada).

## Teste obrigatório antes do commit

Ciclo completo local: carga inicial → migração → cadastro de genérico novo → sync Omie simulado (mock) → **confirmar que os genéricos sobrevivem** → deploy simulado confirmando que o catálogo Omie sobrevive ao `git reset`.

## Entregáveis do relatório final

Arquivos alterados, a nova linha de deploy (para as Notas), e qualquer chamador de `/api/produtos` que tenha ficado no alias temporário.

---

## Melhorias futuras (não implementar agora)

- **Tabela de NCM centralizada (NCM → alíquotas) como fonte única**, substituindo as alíquotas armazenadas por item. Alíquota é propriedade do **NCM**, não do produto; hoje cada item carrega sua cópia das alíquotas. Centralizar elimina divergência e o `npSalvarAliquotas`/migração de alíquotas por item.
- **Ponte/desdobramento** genérico (cotação) → SKU Omie (processo), com whitelist explícita.
- Aposentadoria do `POST /api/dados` (overwrite) — ver auditoria.
