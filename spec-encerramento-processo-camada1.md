# Spec — Encerramento de Processo · Camada 1 (Operacional)

> Escopo: **só operacional**. NÃO toca financeiro / Fluxo de Caixa / apuração de resultado (isso é Camada 2).
> Status: investigação concluída, **aguardando OK do Henrique antes de codar**.

## Objetivo

1. **Notas fiscais** no processo — lista dinâmica (tipo + número + data), 100% opcional.
2. **Status final "Finalizado"** — botão manual "Finalizar processo" (com confirmação) + botão "Reabrir". Nunca automático.
3. **Lista de processos com filtro** — padrão mostra ativos; controle "Finalizados" (e "Todos") revela os encerrados; finalizado com badge visual.

## Decisões já tomadas

- Notas = lista de quantas precisar. Cada linha: dropdown de tipo
  (**Entrada/Importação, Remessa Armazém, Retorno Armazém, Venda, Outros**) +
  número + data (digitação dd/mm/aaaa, padrão do painel). Botão remover por linha. 100% opcional.
- "Finalizado" disparado por BOTÃO manual "Finalizar processo" (confirmação). NUNCA automático.
- Botão "Reabrir" no processo finalizado → volta para ativo.
- Lista: padrão só ativos; controle "Finalizados"/"Todos"; finalizado com badge.

## Investigação (estado atual do código)

### 1. Status de processo
- Campo: `proc.status`. Default `'ativo'` (setado na criação, `painel.html:1883`).
- Valor `'concluido'` existe só no **filtro do Relatório** (`painel.html:3775`) e no CSS
  `.badge-concluido` (`:120`). **Não há UI que sete `concluido` hoje** → na prática todo processo é `ativo`.
- Lista de processos (`renderProcessos`, `:2031`): hoje mostra **todos**, sem filtro de status;
  badge = `badge-${p.status||'ativo'}`.
- **Decisão de implementação:** usar novo valor `status: 'finalizado'` (claro, casa com o rótulo).
  Mantém `concluido` como legado intocado. Adicionar `.badge-finalizado` e opção "Finalizado" no filtro do Relatório.

### 2. Onde encaixam as notas fiscais
- Etapa D = card **"Operacional & Documentos"** (`painel.html:1152`), render via `renderNovoProcesso`,
  leitura via `npLerOperacional()` (`:1761`). Datas usam helper `_npData(id, iso)` (`:1724`) — dd/mm/aaaa.
- **Recomendação:** subseção **"Notas Fiscais"** dentro do card Etapa D (mesmo grupo de documentos
  operacionais), com lista dinâmica reaproveitando `_npData` para a coluna data. Coerente com o resto da etapa.

### 3. Quem conta "ativos/atrasados" (mapa completo)
- **Dashboard front** (`painel.html:554`): `ativos = processos.filter(p => p.status === 'ativo')`.
  KPI "Processos Ativos", "Receita Prevista", Pipeline e "Próximos Eventos" usam `ativos` → **finalizado some automaticamente**.
- **Backend / Astrid** (`painel-proxy.js:563`, `GET /api/resumo-diario`):
  `const ativos = lerDados().pilar_processos.filter(p => p.status === 'ativo')`.
  `processosAtivos` e `eventosAtrasados` são calculados **só sobre `ativos`** → finalizado **não vai pro Telegram**
  como ativo nem como atrasado. **Nenhuma mudança de backend necessária** para a contagem ficar correta — basta o status ≠ `'ativo'`.
- **Ponto de atenção (KPIs cumulativos, NÃO são "ativo/atrasado"):** "FOB Total USD" (`:555`) e
  "Itens Pedidos" (`:556`) somam **todos** os processos (inclui finalizados). São totais de volume, não
  contagem de ativos. Recomendação: **deixar como estão** (total histórico) — mexer aqui beira o financeiro (Camada 2).
  Sinalizado para decisão do Henrique.

### 4. Gravação
- Confirmado: processos gravam via **`_apiSalvarProcessos(arr)` → `POST /api/processos`**
  (`painel.html:5531`), que no backend é **MERGE POR ID** (`painel-proxy.js:391` → `mergeFatiaPorId`).
  **Não usa `/api/dados`** (overwrite). Os campos novos entram no objeto do processo e seguem o mesmo merge.

## Plano de implementação (após OK)

1. **Notas fiscais (Etapa D):**
   - Subseção "Notas Fiscais" no card Operacional, lista dinâmica em memória; "+ Adicionar nota" e "remover" por linha.
   - Cada linha: `<select>` tipo + `<input>` número + data via `_npData`.
   - Persistência: `proc.notasFiscais = [{tipo, numero, data}]` no objeto do processo (lido junto no salvar).
   - 100% opcional: lista vazia é válida; nunca bloqueia o salvamento.
2. **Status Finalizado/Reabrir:**
   - Botão "Finalizar processo" (confirmação) no detalhe → `p.status = 'finalizado'`; salva via `_apiSalvarProcessos`.
   - Botão "Reabrir" quando finalizado → `p.status = 'ativo'`.
   - `.badge-finalizado` no CSS.
3. **Lista com filtro:**
   - `renderProcessos`: controle (botões/abas) **Ativos | Finalizados | Todos**, padrão **Ativos**.
   - Badge de status na linha; finalizados ocultos por padrão.
   - Adicionar opção "Finalizado" ao filtro do Relatório (`:3775`).

## Regras invioláveis

- Motor de precificação **intocado** (hash antes/depois conferido).
- Gravar **só via `/api/processos`** (merge), nunca `/api/dados`.
- Campos novos **100% opcionais** — nunca travam o salvamento.
- **Não tocar** financeiro / Fluxo de Caixa / apuração de resultado (Camada 2).

## Teste

- Possível no ambiente: sintaxe, fluxo de salvar/ler, filtro da lista.
- Verificação final (Henrique): no painel real — finalizar/reabrir, NF aparece, finalizado some do dashboard e do Telegram da Astrid.
