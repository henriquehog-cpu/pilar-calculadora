# Spec — `/api/simulacoes` vira merge por ID (mata o overwrite que apagou dados)

**Para:** Claude Code (`~/pilar-calculadora`)
**Arquivo-alvo:** `painel-proxy.js` (servidor HTTP do painel).
**Natureza:** correção em **gravação de dado de produção** (`dados.json`). Máxima cautela. Inerte até o deploy.

---

## Contexto / incidente

`POST /api/simulacoes` fazia `dados.pilar_simulacoes = arr` — **substituía o array inteiro**. Ao receber uma lista **parcial**, apagou **20 de 24** simulações (recuperadas via backup; hoje são **28**). É o mesmo padrão de overwrite que o **item 0** eliminou no `/api/dados`, mas que sobrou nesta rota (e na de demandas).

## Investigação (read-only, antes de codar)

1. **ID único e estável? SIM.** Campo **`id`** (numérico, `Date.now()` em `saveSimulacao` — `index.html:588`; legados recebem id em `_simInit:568`). Na fixture de 28: todos presentes, **únicos**, numéricos. Cada "salvar" cria um **novo snapshot com novo id** (`unshift`), então cada `id` ↔ um snapshot imutável — ideal para merge por id. **Deleção já tem rota explícita** usada de fato: `deleteSim → DELETE /api/simulacoes/:id` (`index.html:650`).
2. **Quem chama `POST /api/simulacoes`:** in-repo, só a **Calculadora** (`_simSalvarServidor`, `index.html:560`) — manda o **array completo**. O **painel só faz GET** de simulações; `_apiSincronizar` leva `pilar_simulacoes` "de carona" ao `/api/dados` (já blindado), **não** a esta rota. A **Astrid é externa** (outro repo) — payload desconhecido; provável origem do array parcial. Também há um caminho auto-infligido: `_simInit` (`:574`) empurra o cache local quando o servidor devolve `[]` momentaneamente. **Merge por id neutraliza todos.**
3. **Merge do item 0:** o `/api/dados` blindado faz merge **no nível das chaves** + escrita atômica; `/api/processos|demandas|simulacoes` faziam `dados[chave] = arr` (substituição da fatia). Ou seja, **não eram merge por id** — o reaproveitável do item 0 é `lerDados()` + `salvarDados()` atômico, não o per-id. Este item implementa o **merge por id de verdade**.
4. **`/api/demandas` tem o MESMO risco?** SIM — `dados.pilar_demandas = arr` (substituição total). Demandas têm `id` estável (`Date.now()`, `painel.html:1882/5878`) e `DELETE /api/demandas/:id` usado por `ndExcluir` (`:6012`). **Corrigido junto, mesmo padrão.**

---

## Implementação (`painel-proxy.js`)

**Helper único `mergeFatiaPorId(req, res, chave, label)`** (usado por simulações e demandas):

1. **Normaliza o corpo:** array, `{<chave>:[...]}`, ou uma única simulação/demanda (objeto com `id`).
2. **DEFAULT = MERGE POR ID:** parte de `lerDados()[chave]`, indexa por `String(id)`; para cada item recebido **atualiza** (mesmo id) ou **adiciona** (id novo). **Itens omitidos no payload NUNCA são removidos.** Exige `id` em cada item → senão `400`.
3. **`?modo=substituir`:** substituição total **explícita** — única forma de encolher o array por POST.
4. **Deleção pontual:** só por **`DELETE /api/<fatia>/:id`** (rotas mantidas). Nunca por omissão.
5. **Escrita atômica:** `salvarDados` (`.tmp` + `rename`).
6. **Validação:** corpo malformado (não-JSON, estrutura inesperada, item sem id) → `400` **sem tocar no arquivo** (retorno antes de `salvarDados`).

`POST /api/simulacoes` → `mergeFatiaPorId(req,res,'pilar_simulacoes','simulações')`.
`POST /api/demandas`  → `mergeFatiaPorId(req,res,'pilar_demandas','demandas')`.

**Sem mudança de cliente:** a Calculadora já manda o array completo (ok sob merge) e deleta via `DELETE` explícito; o painel idem para demandas.

## NÃO TOCADO

Motor de precificação (`index.html`, hash `6e5d21c5…2678fdec` inalterado), catálogos, layout, `/api/dados` (já blindado no item 0), rotas `DELETE`.

---

## Testes (servidor real na porta 8099, `dados.json` semeado com as 28 simulações reais + demandas) — 24/24 ✅

- **T1** POST 1 sim nova → **29** (28 + nova); as 28 originais permanecem.
- **T2** POST 1 sim de id existente → **atualiza**, total continua **28** (`atualizados:1, adicionados:0`).
- **T3 (o acidente):** POST **4 de 28 SEM flag** → as **28 permanecem** (não apaga mais). ✅
- **T4** `?modo=substituir` com 4 → substitui de fato (total 4) — escape hatch explícito.
- **T5** `DELETE /api/simulacoes/:id` → remove só ela (27).
- **T6** sim sem `id` → `400` + arquivo intacto.
- **T7** não-JSON → `400` + arquivo byte-a-byte intacto.
- **T8** `/api/demandas`: POST 1 de 3 → as 3 permanecem + a de id 2 atualizada; simulações intactas.
- **T9** outras chaves (processos/demandas/config) intactas após POST de simulações.
- **Motor:** hash inalterado; `index.html` não tocado.
- `dados.json` local restaurado a `{}`. `sims_prod_teste.json` (produção, gitignored) **apagado ao final**.

## Pendências / residuais

- **`/api/processos`** ainda faz substituição da fatia (`dados.pilar_processos = arr`) — mesmo risco estrutural, **fora do escopo deste item**; único caller (painel) sempre manda o array completo e deleta por `DELETE`. Candidato a um próximo item se quiser uniformizar.
- **No deploy:** snapshot server-side do `dados.json` antes de publicar.
- Reapontar a **Astrid** para esta rota com payloads por id (já segura pela proteção, mesmo mandando lista parcial).
