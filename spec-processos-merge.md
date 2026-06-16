# Spec — `/api/processos` vira merge por ID (uniformiza com simulações/demandas)

**Para:** Claude Code (`~/pilar-calculadora`)
**Arquivo-alvo:** `painel-proxy.js`.
**Natureza:** correção em **gravação de produção** (`dados.json`). Máxima cautela. Inerte até o deploy.

---

## Contexto

O item anterior corrigiu `/api/simulacoes` e `/api/demandas` com o helper `mergeFatiaPorId` (merge por id; atualiza/adiciona; nunca remove omitido; `?modo=substituir` explícito; DELETE próprio; atômico). A `/api/processos` ficou de fora e ainda fazia `dados.pilar_processos = arr` — **mesmo risco estrutural de overwrite**, e é a rota que **a Astrid usa para criar processos**: um payload parcial (ou um único processo) apagaria todos os demais. Falta só uniformizar.

## Investigação (read-only, antes de codar)

1. **Processos têm ID único e estável? SIM.** Campo **`id`** (numérico `Date.now()`): `painel.html:1882` (wizard) e `:5878` (`ndCriarProcesso`). Mesma forma de sims/demandas.
2. **Quem chama `POST /api/processos`:** in-repo, só `_apiSalvarProcessos(arr)` (`painel.html:5531`) — sempre o **array completo** (fluxos de criação/edição/migração em 1890, 3087, 5481, 6815; **nenhum remove** por aqui). `_apiSincronizar` posta em `/api/dados` (já blindado), **não** nesta rota. A **Astrid** (externa) cria processos por esta rota — provável origem de payload parcial. **Deleção** usa `DELETE /api/processos/:id` explícito (`procDeletar`, `painel.html:2099`) → merge não quebra deleção.
3. **Dá para reusar o helper sem alterá-lo? SIM.** `mergeFatiaPorId(req,res,chave,label)` é genérico sobre `chave`; o ramo de objeto único (`body.id != null`) cobre a Astrid postando um processo só. **Helper intocado.**

## Implementação (`painel-proxy.js`)

Trocar o corpo do `POST /api/processos` por uma chamada ao helper existente:

```js
if (req.method === 'POST' && url === '/api/processos') {
  mergeFatiaPorId(req, res, 'pilar_processos', 'processos');
  return;
}
```

Comportamento herdado do helper: **merge por id** (atualiza mesmo id, adiciona novos, **nunca remove o omitido**); **`?modo=substituir`** = única forma de encolher por POST; **deleção** só por `DELETE /api/processos/:id`; **escrita atômica**; **malformado/sem-id → 400 sem tocar no arquivo**.

**Sem mudança de cliente:** o painel já manda o array completo e deleta via `DELETE` explícito. Diff = 1 hunk (só o handler POST).

## NÃO TOCADO

Motor (`index.html`, hash `6e5d21c5…2678fdec` inalterado), catálogos, layout, `/api/dados` e as rotas já corrigidas (`simulacoes`/`demandas`), o **helper** (só reusado), GET e DELETE de processos.

---

## Testes (servidor real porta 8099; 3 processos sintéticos + 28 simulações reais + demandas) — 19/19 ✅

- **T1** POST 1 processo novo (objeto único, estilo Astrid) → **4** (3 + novo); os 3 permanecem.
- **T2 (o risco):** POST **1 de 3 SEM flag** → os **3 permanecem** (não apaga mais).
- **T3** POST id existente → **atualiza** (`atualizados:1, adicionados:0`), total continua 3.
- **T4** `?modo=substituir` → substitui de fato (total 1).
- **T5** `DELETE /api/processos/:id` → remove só o alvo (2).
- **T6** processo sem `id` → `400` + arquivo intacto.
- **T7** não-JSON → `400` + arquivo byte-a-byte intacto.
- **T8** simulações (28), demandas (2) e config intactos após POST de processos.
- **Motor:** hash inalterado; `index.html` não tocado.
- `dados.json` local restaurado a `{}`. `sims_prod_teste.json` (produção, gitignored) **apagado ao final**.

## Resultado

As **três** fatias-array do `dados.json` (`processos`, `demandas`, `simulacoes`) agora usam o **mesmo helper de merge por id**. O padrão de overwrite que causou o incidente está eliminado em todas. **No deploy:** snapshot server-side do `dados.json` antes de publicar.
