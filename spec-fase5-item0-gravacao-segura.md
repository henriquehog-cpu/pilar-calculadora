# Spec — Fase 5, Item 0: rota de gravação segura (blindar o `POST /api/dados`)

**Para:** Claude Code (`~/pilar-calculadora`)
**Arquivo-alvo:** `painel-proxy.js` (o servidor Express/HTTP do painel).
**Natureza:** mudança em **dado de produção crítico** (`dados.json`). Máxima cautela. A mudança é **inerte até o deploy** — não toca produção enquanto não for publicada.

---

## Problema (causa-raiz do R1)

`POST /api/dados` reescrevia o `dados.json` **inteiro** (`fs.writeFileSync` cru, não-atômico). Quem chamava — o painel via `_apiSincronizar` e a **Astrid** (bot Telegram, repo externo) — precisava **lembrar de incluir todas as chaves** (`pilar_simulacoes`, `pilar_demandas`, `pilar_processos`, `pilar_config`, `pilar_descricoes_di`) ou elas eram apagadas silenciosamente. Mitigado por disciplina manual (a "carona" em `_apiSincronizar`); queríamos torná-lo **estruturalmente impossível**.

## Investigação (read-only, feita antes de codar)

1. **Chamadores de `POST /api/dados` no repo:** só **um** — `painel.html` → `_apiSincronizar()` (hook de `localStorage.setItem` sobre `pilar_processos`/`pilar_config`/`pilar_descricoes_di`, postando 5 chaves). Os *savers dedicados* já usam rotas de merge: `_apiSalvarProcessos`→`/api/processos`, `_apiSalvarDemandas`→`/api/demandas`, e a Calculadora→`/api/simulacoes`. A **Astrid não está neste repo** (agente externo) — será reapontada depois, via Telegram.
2. **Rotas de merge já existiam:** `POST /api/processos|demandas|simulacoes` (`painel-proxy.js`) já fazem `lerDados()` → substituem **só a sua chave** → `salvarDados()` (atômico) + validam array. **Gap:** `pilar_config`/`pilar_descricoes_di` só chegam ao disco via `/api/dados` (sem endpoint próprio).
3. **Escrita atômica:** `gravarAtomico(file,obj)` = `.tmp` + `renameSync` (atômico no mesmo FS); `salvarDados` o envolve. O `POST /api/dados` **não** o usava.

## Decisão de escopo (aprovada): **Mínimo — só blindar `/api/dados`**

Não criar rotas novas para `config`/`descricoes_di`. `_apiSincronizar` continua postando em `/api/dados`, **agora seguro**. A blindagem (item 3 abaixo) fecha o risco pelos **dois lados**: protege a Astrid antes mesmo de reapontá-la, e backstopa o painel se algum dia esquecer uma chave. O `painel.html` **não foi tocado** (menos superfície de risco em produção; os savers já usam merge).

---

## Implementação (única mudança: `POST /api/dados` em `painel-proxy.js`)

**Merge defensivo + escrita atômica + validação:**

1. **Validação (antes de qualquer escrita):**
   - `readBody` já rejeita não-JSON → `400 { erro: 'JSON inválido' }`, arquivo intocado.
   - Corpo precisa ser **objeto simples** (não array/null/primitivo) → senão `400`.
   - Chaves conhecidas, quando **presentes**, com tipo certo: `pilar_processos`/`pilar_demandas`/`pilar_simulacoes` arrays; `pilar_config`/`pilar_descricoes_di` objetos → senão `400`.
   - Em qualquer rejeição, **o arquivo não é tocado** (retorno antes do `salvarDados`).
2. **Merge defensivo:** `const merged = Object.assign({}, lerDados(), data)`.
   - Base = `dados.json` atual; só as chaves **presentes** no payload sobrescrevem.
   - Chave **ausente** no payload → a do disco é **preservada**. Chaves extras no disco (ex.: `pilar_produtos`) sobrevivem.
   - **Atenção (semântica por presença, não por vazio):** se o payload **contém** a chave com `[]`, isso é overwrite explícito (esvazia). A proteção é contra chave **omitida**, conforme a spec. O painel popula o cache antes do sync; a blindagem cobre o caso de omissão (ex.: Astrid).
3. **Escrita atômica:** `salvarDados(merged)` (`.tmp` + `rename`).

**Rotas de merge** (`/api/processos|demandas|simulacoes`): já corretas — **não tocadas**.

## NÃO TOCADO

Motor de precificação (`index.html`, hash `6e5d21c5…2678fdec` inalterado), separação dos catálogos, layout da calculadora, `painel.html`.

---

## Testes executados (servidor real na porta 8099, `dados.json` semeado com as 24 simulações reais do `sims_prod_teste.json`)

- **T1 — merge endpoint:** `POST /api/processos` → processos atualizados; **demandas, as 24 simulações, config, descricoes_di e a chave extra `pilar_produtos` intactas**. ✅
- **T2 — a joia (blindagem):** `POST /api/dados` só com `pilar_processos` (omitindo o resto) → processos sobrescrito; **simulações (24), demandas, config, descricoes_di e `pilar_produtos` PRESERVADOS**. ✅
- **T3 — malformado:** não-JSON → `400`; JSON array → `400`; chave com tipo errado → `400`; em todos, **arquivo byte-a-byte intacto**. ✅
- **T4 — overwrite por chave presente:** `POST /api/dados {pilar_config}` → só config muda; simulações e processos intactos. ✅
- **Extra:** `GET /api/simulacoes` devolve as 24. ✅
- **Motor:** hash do bloco inline inalterado; `index.html` não tocado. ✅
- `dados.json` local restaurado a `{}` após o teste.

`sims_prod_teste.json` é dado de produção (gitignored) — **apagado ao final**, nunca vai ao GitHub.

## Pendências (fora do escopo deste item)

- Reapontar a **Astrid** para as rotas de merge (via Telegram) — já segura por ora pela blindagem.
- Endpoints próprios com merge para `pilar_config`/`pilar_descricoes_di` (auditoria rec. #2), se/quando se quiser aposentar de vez o `/api/dados` no painel.
- **No deploy:** snapshot server-side do `dados.json` antes de publicar.
