# Mini-spec — Painel PILAR Fase 4: Ciclo Demanda → Cotação → Preço → Proposta

**Para:** Claude Code (repositório `~/pilar-calculadora`)
**Contexto:** Fases 1, 2 e 3 concluídas e em produção. Esta fase conecta o ciclo comercial completo: demanda qualificada → cotação do fornecedor → cálculo de preço → proposta ao cliente, eliminando redigitação entre etapas.

**Fluxo real do operador (base de todo o desenho):**
- Demanda de **recompra** → vai direto ao fornecedor pedir cotação atualizada → aguarda → calcula preço → orçamento ao cliente.
- Demanda de **item novo** → briefing do produto → pesquisa de fornecedores (Accio / made-in-china) → cotação → calcula preço → orçamento ao cliente.
- O cálculo de preço é feito na **Calculadora** (a página raiz do site, `https://painel.pilarimports.com.br/`), que contém o motor de precificação validado (fórmula iterativa de PV, câmbio fiscal vs. comercial, AFRMM, ICMS regime especial, CSLL/IR sobre margem real).

**Regras invioláveis:**
1. **O motor de precificação da Calculadora NÃO é reescrito, refatorado nem "melhorado".** Nenhuma fórmula, alíquota ou lógica de convergência muda. A Fase 4 conecta dados ao redor do motor; o motor é intocável. Qualquer mudança que pareça necessária nele deve ser reportada e aguardar aprovação explícita.
2. Persistência de demandas segue o MESMO padrão de `pilar_processos`: novas rotas API no `painel-proxy.js` lendo/gravando a chave nova `pilar_demandas` dentro de `dados.json`. Usar exatamente o mesmo mecanismo de leitura/escrita já existente (mesmas funções utilitárias). `dados.json` continua gitignorado; nada muda no deploy.
3. A integração Calculadora → Proposta transfere **apenas o preço de venda final (PV)** e identificação do item. FOB, custos, margens e nomes de fornecedor NUNCA atravessam para o módulo Proposta. O guardrail da Fase 3 permanece como segunda barreira.
4. Chaves e tokens continuam só em variáveis de ambiente. `ANTHROPIC_API_KEY` e `PAINEL_INTERNAL_TOKEN` intocados.

---

## ETAPA A — Nova Demanda bifurcada (recompra vs. item novo)

### A.1 Novo system prompt

Substituir o conteúdo de `prompts/qualificacao.md` por uma versão bifurcada:

```
Você é o assistente de demandas da PILAR Imports, importadora sob
demanda de São Paulo. A PILAR não tem catálogo fixo: importa qualquer
categoria (têxtil, construção, ferramentas automotivas, tapetes,
alimentos, automação etc.), com fornecedores na China e em Dubai.

PRIMEIRA PERGUNTA, sempre: trata-se de RECOMPRA (item que a PILAR já
importou antes) ou ITEM NOVO? Se a primeira mensagem do usuário já
deixar isso claro, não pergunte — siga direto pelo caminho certo.

── CAMINHO RECOMPRA ──
Não faça qualificação completa. Pergunte apenas, uma por vez:
1. Qual item/referência (e cliente, se relevante)?
2. Quantidade desta compra?
3. Prazo desejado na porta do cliente?
Depois gere a MENSAGEM AO FORNECEDOR: e-mail curto em inglês pedindo
cotação atualizada (preço, MOQ, lead time, validade da cotação),
tom direto de quem já é comprador recorrente. Não mencione o cliente
final. Título do bloco: "MENSAGEM AO FORNECEDOR (RECOMPRA)".

── CAMINHO ITEM NOVO ──
Qualifique, uma pergunta por vez:
1. O que exatamente precisa importar (especificação)?
2. Quantidade e frequência (única ou recorrente)?
3. Prazo necessário na porta do cliente?
4. Requisitos técnicos ou certificações (INMETRO, ANVISA, ANATEL)?
5. Mercado/uso de destino?
Depois gere o DOSSIÊ DE SOURCING, com estes blocos:
- "RESUMO INTERNO" (português): a demanda em 5-8 linhas.
- "ESPECIFICAÇÃO TÉCNICA" (inglês): pronta para anexar em RFQ.
- "TERMOS DE BUSCA" (inglês): 5-10 termos/variações de nomenclatura
  que fabricantes chineses usam, prontos para colar no Accio e no
  made-in-china.com.
- "CERTIFICAÇÕES PROVÁVEIS": para o Brasil, com ressalva de validar.
- "NCM PROVÁVEL": palpite com a ressalva explícita de validar no
  simulador da Receita (https://www4.receita.fazenda.gov.br/simulador/).
- "RFQ" (inglês): pronto para enviar quando encontrar fornecedores.

Em ambos os caminhos: não invente especificações que o usuário não
deu; não mencione o cliente final em textos voltados ao fornecedor.
```

### A.2 Histórico de demandas (persistência)

- Backend: rotas `GET /api/demandas`, `POST /api/demandas`, `DELETE /api/demandas/:id` no `painel-proxy.js`, gravando em `dados.json` sob a chave `pilar_demandas` (array). Mesmo padrão de código das rotas de processos.
- Estrutura de cada demanda salva:

```json
{
  "id": "<gerado>",
  "criadaEm": "ISO",
  "tipo": "recompra" | "novo",
  "cliente": "texto livre",
  "produto": "texto livre",
  "status": "aberta" | "cotando" | "calculada" | "proposta_enviada" | "fechada" | "perdida",
  "briefing": "texto completo gerado pela IA",
  "conversa": [ {role, content}, ... ],
  "simulacaoId": null,
  "pvFinal": null
}
```

- Frontend (módulo Nova Demanda): ao final de uma conversa, botão **"Salvar demanda"** que pede/confirma cliente + produto + tipo e persiste. Abaixo do chat (ou em aba do módulo), a **lista de demandas salvas**: colunas tipo, cliente, produto, data, status (editável via select), e ações "Reabrir conversa", "Copiar briefing", "Excluir" (com confirmação).
- A rota `#/nova-demanda` continua; a lista entra no mesmo módulo. Demandas buscáveis no Cmd+K (por cliente/produto).

### A.3 Critérios de aceite — Etapa A
- [ ] Mensagem inicial "recompra do item X" → IA pula a qualificação completa e faz só as 3 perguntas de recompra.
- [ ] Item novo → dossiê com os 6 blocos, incluindo termos de busca e ressalva de NCM.
- [ ] Demanda salva sobrevive a reload (persistida via API em `dados.json`).
- [ ] Demanda aparece no Cmd+K.
- [ ] `git status` não mostra `dados.json`.

---

## ETAPA B — Calculadora como módulo integrado

### B.0 Investigação obrigatória ANTES de planejar

A calculadora é a página raiz do site (provavelmente `index.html`), servida pelo mesmo `painel-proxy.js`. Antes de propor qualquer implementação:
1. Mapear como a calculadora está estruturada (arquivo(s), onde vive o motor de cálculo, quais campos de entrada existem).
2. Investigar o **"Salvar simulação"** existente: onde salva (localStorage? servidor?), o que salva, e se as simulações salvas são recuperáveis. Reportar o achado em linguagem simples — o operador suspeita que o salvamento atual não é eficaz.
3. Só então propor o plano de integração, escolhendo a abordagem de MENOR risco entre: (a) manter a calculadora como página própria e integrá-la por passagem de dados (query string/localStorage) + entrada no menu do painel apontando pra ela; ou (b) embutir via iframe num módulo do painel. **Não propor fusão dos arquivos nem migração do motor para dentro do painel.html.**

### B.1 Entrada no painel
- Item de menu "Calculadora" (seção Financeiro ou própria), rota `#/calculadora`, presente no Cmd+K. O link "← Calculadora" do topo pode permanecer ou ser removido — propor.

### B.2 Semeadura Demanda → Calculadora
- Na lista de demandas, ação **"Calcular preço"**: abre a calculadora com produto/quantidade/identificação da demanda pré-preenchidos nos campos correspondentes (mapear quais campos da calculadora aceitam semeadura sem ambiguidade; o que não tiver correspondência clara, não preencher).
- Os números da cotação do fornecedor (FOB, frete etc.) são digitados pelo operador na calculadora, como hoje.

### B.3 Simulação ligada à demanda
- Ao salvar uma simulação vinda de uma demanda, gravar o vínculo: `simulacaoId` na demanda + referência da demanda na simulação. Se a investigação do B.0 revelar que o salvamento atual é frágil (ex.: só localStorage), propor migração das simulações para o servidor (`dados.json`, chave própria, mesmo padrão das demais) — comunicando antes.
- Status da demanda muda para "calculada" e `pvFinal` é gravado quando a simulação converge e é salva.

### B.4 Critérios de aceite — Etapa B
- [ ] Relatório da investigação B.0 entregue antes de qualquer código.
- [ ] `#/calculadora` e Cmd+K abrem a calculadora.
- [ ] "Calcular preço" numa demanda abre a calculadora semeada.
- [ ] Simulação salva fica vinculada à demanda (visível na lista de demandas).
- [ ] O motor de cálculo produz resultados IDÊNTICOS aos de antes (testar com uma simulação conhecida: mesmos inputs → mesmo PV, centavo a centavo).

---

## ETAPA C — Ponte Calculadora → Proposta (só o PV atravessa)

- Na simulação convergida/salva de uma demanda, ação **"Gerar proposta"**: abre o módulo Proposta Comercial com cliente, produto e **apenas o PV final** pré-preenchidos.
- PROIBIDO transferir: FOB, custos, frete, impostos discriminados, margem, câmbio usado, nome de fornecedor. A transferência deve ser uma estrutura explícita com whitelist de campos (`{cliente, produto, quantidade, pvFinal, demandaId}`) — nunca "passar o objeto inteiro".
- Status da demanda muda para "proposta_enviada" quando o .docx é gerado a partir dessa ponte.
- O guardrail da Fase 3 permanece ativo no fluxo de proposta com IA — inalterado.

### Critérios de aceite — Etapa C
- [ ] "Gerar proposta" preenche Proposta com cliente/produto/PV — e nada além.
- [ ] Inspecionar o que atravessa (código + teste): nenhum campo de custo presente na estrutura transferida.
- [ ] Ciclo completo testável de ponta a ponta: demanda nova → dossiê → (cotação manual) → calcular preço → simulação salva → gerar proposta → .docx.

---

## ETAPA D — Detalhes operacionais da importação (documentos e referências)

**Dor:** o painel controla o macro do processo (etapas, datas previstas, financeiro), mas não tem onde registrar os dados operacionais do despacho — número de BL, invoice, e o controle do que já foi recebido do fornecedor e enviado ao despachante. Hoje isso vive fora do painel.

### D.0 Investigação antes de codificar
Mapear a estrutura atual de um processo em `dados.json` (campos de `dados_gerais` e seções existentes) e o formulário de edição no `painel.html`, para encaixar a seção nova sem duplicar nada que já exista (ex.: se já houver campo de invoice em algum lugar, reaproveitar).

### D.1 Nova seção no processo: "Operacional & Documentos"
Adicionar ao formulário de edição do processo (e à estrutura persistida) uma seção com:

**Referências do embarque** (campos de texto + data):
- Invoice (CI): número + data
- Packing List (PL): número/referência + data
- BL (Bill of Lading): número + data de emissão
- Contêiner(es): número(s) (texto livre, aceita múltiplos)
- Outros campos comuns que a investigação D.0 indicar como úteis (ex.: referência interna do despachante), propostos antes de implementar.

**Checklist de documentos** (duas listas de checkboxes com data de marcação automática):
- *Recebidos do fornecedor:* Commercial Invoice, Packing List, BL (draft), BL (original/telex), Certificado de Origem, Outros (campo livre).
- *Enviados ao despachante:* CI, PL, BL, instruções/numerário, Outros (campo livre).
- Cada item marcado registra a data automaticamente (editável). Itens não aplicáveis ficam desmarcados sem penalidade.

**Link OneDrive** (campo opcional de URL):
- Em cada processo E em cada demanda (Etapa A): campo "Link OneDrive" com a URL da pasta de documentos. Exibido como botão "📁 Documentos" que abre em nova aba. Sem integração Graph nesta fase — é só link.

### D.2 Visibilidade
- No módulo Processos (lista) e/ou no tooltip/detalhe: indicador simples de pendência documental (ex.: badge "docs 3/5") — propor formato na investigação, sem poluir o layout.
- O Resumo Despachante deve poder usar BL e Invoice quando existirem (apenas exibição/reaproveitamento; sem mudar a lógica existente do módulo).

### D.3 Critérios de aceite — Etapa D
- [ ] Campos novos persistem no servidor e sobrevivem a reload (mesmo padrão de persistência atual).
- [ ] Checkbox marcado grava data automática editável.
- [ ] Botão "📁 Documentos" abre a pasta do OneDrive em nova aba (processo e demanda).
- [ ] Nenhum campo ou cálculo existente do processo foi alterado ou removido.
- [ ] `git status` não mostra `dados.json`.

---

## Ordem e método

1. Etapa A completa (prompt + histórico + link OneDrive nas demandas) → commit/push → deploy → validação do operador em produção.
2. Etapa D (operacional & documentos) — independente de B/C, pode vir logo após a A por ser de valor imediato no dia a dia → investigação D.0 → implementação → deploy → validação.
3. Etapa B começando OBRIGATORIAMENTE pelo relatório de investigação B.0 → aprovação do plano → implementação → deploy → validação (incluindo o teste de identidade do motor, centavo a centavo).
4. Etapa C → deploy → teste do ciclo completo.

Mesmo método das fases anteriores: explicar o plano em linguagem simples antes de codificar, avisar antes de cada mudança importante, testar localmente (com mock para chamadas de IA — sem chave real), e o operador roda o safe deploy no VPS.
