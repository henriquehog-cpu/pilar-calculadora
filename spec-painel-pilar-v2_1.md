# Especificação — Painel PILAR v2: Proatividade, Fluidez e IA

**Para:** Claude Code (repositório `~/pilar-calculadora`)
**Contexto:** Painel Operacional PILAR em produção (painel.pilarimports.com.br), VPS "Astrid" (217.9.14.234), PM2, nginx + Let's Encrypt. Frontend single-file `painel.html` + backend `painel-proxy.js` (Node.js). Dados persistidos em `dados.json` (gitignorado, backup cron 6h). Deploy somente via safe git-pull que preserva `dados.json`. Agente OpenClaw "Astrid" roda no mesmo VPS (`/opt/openclaw/`), com Telegram conectado — Haiku para crons, Sonnet para sessões pessoais.

**Ordem de implementação:** Fase 1 → Fase 2 → Fase 3. Cada fase deve ser commitada e deployada separadamente, com teste antes de avançar.

**Regras invioláveis (valem para as 3 fases):**
1. Nunca tocar em `dados.json` via git. Nenhuma fase escreve nesse arquivo a partir de código novo, exceto pelos fluxos já existentes de persistência via `/api/processos`.
2. Astrid NUNCA edita arquivos do painel diretamente no VPS (histórico de conflitos de git). Toda interação dela com o painel é via HTTP read-only (Fase 1).
3. Nenhuma chave de API no frontend. Chamadas à API Anthropic passam exclusivamente pelo `painel-proxy.js` (Fase 3).
4. Manter arquitetura single-file do `painel.html` — sem frameworks, sem build step. Vanilla JS + CSS já existentes.

---

## FASE 1 — Astrid Proativa (briefing diário no Telegram)

**Objetivo:** todo dia às 07h30 (America/Sao_Paulo), Henrique recebe no Telegram um resumo operacional sem precisar abrir o painel.

### 1.1 Novo endpoint read-only no painel-proxy.js

```
GET /api/resumo-diario
```

Sem autenticação extra se o endpoint já estiver atrás do mesmo esquema dos demais `/api/*`; caso os endpoints atuais sejam públicos, proteger este com um header `X-Painel-Token` (token em variável de ambiente `PAINEL_INTERNAL_TOKEN`, compartilhado com a Astrid). Verificar como os endpoints atuais estão protegidos e seguir o mesmo padrão, adicionando o token se não houver nada.

Resposta (montada a partir de `dados.json`, somente leitura):

```json
{
  "geradoEm": "2026-06-10T07:30:00-03:00",
  "processosAtivos": 6,
  "eventosProximos": [
    {
      "processo": "PIL-002-2026",
      "cliente": "MARIAS ENXOVAIS",
      "tipo": "Recebimento Pagamento",
      "data": "2026-06-15",
      "diasRestantes": 5,
      "valor": 108559.50,
      "moeda": "BRL"
    }
  ],
  "eventosAtrasados": [
    {
      "processo": "PIL-003-2026",
      "tipo": "Embarque",
      "data": "2026-06-04",
      "diasAtraso": 6
    }
  ],
  "pendenciasFinanceiras30d": {
    "aReceber": 108559.50,
    "aPagar": 25373.98
  }
}
```

Regras de montagem:
- `eventosProximos`: janela de 7 dias corridos a partir de hoje.
- `eventosAtrasados`: qualquer evento com data passada e não marcado como concluído. **Importante:** verificar no `dados.json` qual campo indica conclusão de milestone antes de implementar — não assumir nome de campo.
- `pendenciasFinanceiras30d`: somatório de valores a receber e a pagar nos próximos 30 dias (recebimentos de cliente vs. numerários de despachante e pagamentos a fornecedor, conforme estrutura existente do Fluxo de Caixa).
- Datas sempre em ISO + cálculo de dias no fuso America/Sao_Paulo.

### 1.2 Cron na Astrid (OpenClaw)

Configurar um cron job no OpenClaw (modelo: **Haiku**, conforme padrão já definido — confirmar que `/root/.openclaw/openclaw.json` mantém `anthropic/claude-sonnet-4-6` como primário e Haiku nos crons; se um update do OpenClaw tiver revertido para OpenRouter, corrigir com o `sed -i` já documentado).

Prompt do cron (ajustar à sintaxe de crons do OpenClaw):

```
Todo dia às 07:30 (America/Sao_Paulo):
1. Faça GET em https://painel.pilarimports.com.br/api/resumo-diario
   (header X-Painel-Token se configurado).
2. Formate uma mensagem de Telegram em português, curta e escaneável:
   - Linha de abertura: "Bom dia! Resumo PILAR — {data}"
   - Seção "⚠️ Atrasados" só se houver atrasos, sempre no topo.
   - Seção "Próximos 7 dias": um evento por linha, formato
     "{emoji} {PIL-XXX} {tipo} — {dd/mm} (em Xd)" com valor em R$
     quando houver.
   - Linha final: "💰 30 dias: receber R$ X | pagar R$ Y"
3. Se a API não responder, avise: "Painel fora do ar — verificar PM2."
4. Não invente dados. Não acrescente comentários além do resumo.
```

### 1.3 Critérios de aceite — Fase 1
- [ ] `curl` no endpoint retorna JSON correto comparado com o dashboard.
- [ ] Evento atrasado de teste aparece em `eventosAtrasados`.
- [ ] Mensagem chega no Telegram às 07h30 por 2 dias consecutivos.
- [ ] Derrubar o painel via PM2 (`pm2 stop`) gera a mensagem de erro no Telegram (testar e religar).
- [ ] Astrid não escreveu nenhum arquivo no diretório do painel (conferir `git status` limpo no VPS).

---

## FASE 2 — Fluidez de navegação no painel.html

**Objetivo:** reduzir qualquer consulta a processo de ~4 cliques para 1 ação. Três entregas: deep-links por hash, command palette (Cmd+K), tooltips no pipeline.

### 2.1 Roteamento por hash + deep-links

- Implementar roteador mínimo por hash: `#/dashboard`, `#/processos`, `#/processo/{PIL-XXX-YYYY}`, `#/processo/{PIL-XXX-YYYY}/financeiro`, `#/fluxo-caixa`, etc., mapeando para a função de troca de módulo que já existe no painel.
- `window.addEventListener('hashchange', ...)` + leitura do hash no load (permite abrir link direto e usar voltar/avançar do navegador).
- Tornar clicáveis (cursor pointer + hover state):
  - Cada linha de **Próximos Eventos** → `#/processo/{id}` (se o evento for financeiro, abrir já na seção financeira do processo).
  - Cada linha do **Pipeline** → `#/processo/{id}`.
  - Os 4 cards de KPI do topo → módulo correspondente (Processos, Fluxo de Caixa, Order Request, Catálogo Omie).
- Não quebrar a navegação atual pelo menu lateral — o menu passa a apenas setar o hash.

### 2.2 Command Palette (Cmd+K / Ctrl+K)

- Overlay central (input + lista de resultados), aberto com `Cmd+K`/`Ctrl+K`, fechado com `Esc` ou clique fora.
- Índice de busca montado em memória a partir dos dados já carregados no frontend (sem nova chamada de API):
  - Processos: número PIL + cliente (ex.: digitar "ramos" lista PIL-005 e PIL-006).
  - Ações/módulos: "novo processo", "fluxo de caixa", "order request", "proposta", "resumo despachante", "calculadora", "configurações".
- Busca: matching simples case/acento-insensitive por substring é suficiente; fuzzy não é necessário na v1.
- Navegação por teclado: ↑/↓ seleciona, Enter executa (seta o hash correspondente).
- Acessibilidade mínima: foco preso no overlay enquanto aberto, foco volta ao elemento anterior ao fechar.

### 2.3 Tooltips no pipeline

- Hover (e tap no mobile) em cada ícone de milestone (Pedido / Embarque / Porto / Cliente) mostra tooltip com: nome da etapa, data prevista, data real se concluída, e status (concluído / previsto / atrasado).
- Tooltip em CSS + JS puro, posicionado acima do ícone, sem biblioteca.
- Cor do texto de data: usar as classes de cor já existentes no painel (verde concluído, azul previsto, vermelho atrasado) — **não introduzir paleta nova**; o painel já tem identidade visual consolidada (teal PILAR + cinzas) e a Fase 2 deve ser invisível esteticamente: mesma cara, menos cliques.

### 2.4 Critérios de aceite — Fase 2
- [ ] Abrir `painel.html#/processo/PIL-002-2026` direto pela URL carrega o processo certo.
- [ ] Clicar em "Numerário Despachante PIL-002" no dashboard abre o processo na seção financeira.
- [ ] Cmd+K → digitar "koala" → Enter abre o PIL-004-2026.
- [ ] Botão voltar do navegador retorna ao dashboard.
- [ ] Hover em qualquer ícone do pipeline mostra a data da etapa.
- [ ] Nada do layout atual mudou visualmente além dos novos affordances (hover/cursor).

---

## FASE 3 — IA no painel (skills PILAR via API Anthropic)

**Objetivo:** dois fluxos assistidos por IA dentro do painel, com as regras de negócio da PILAR embutidas no servidor: (A) qualificação de nova demanda → briefing para fornecedor; (B) assistente de Proposta Comercial com guardrails.

### 3.1 Backend — proxy de IA no painel-proxy.js

- Variável de ambiente nova: `ANTHROPIC_API_KEY` (configurar no ecosystem do PM2 ou `.env` gitignorado — **nunca commitar**).
- Endpoint único:

```
POST /api/ia/chat
Body: { "fluxo": "qualificacao" | "proposta", "mensagens": [{role, content}, ...] }
```

- O servidor escolhe o system prompt pelo campo `fluxo` (prompts ficam no servidor, em `prompts/qualificacao.md` e `prompts/proposta.md` no repo — podem ser commitados, não contêm segredos).
- Chamada à API: `https://api.anthropic.com/v1/messages`, modelo `claude-sonnet-4-6`, `max_tokens: 2048`. Sonnet é suficiente e barato para esses fluxos; não usar modelo maior aqui.
- Rate limit simples no endpoint (ex.: 20 req/min) para evitar custo acidental.
- Logar em arquivo local (gitignorado) cada chamada: timestamp, fluxo, tokens de entrada/saída — para Henrique acompanhar custo.

### 3.2 System prompts (conteúdo das skills, adaptado)

**`prompts/qualificacao.md`:**

```
Você é o assistente de qualificação de demanda da PILAR Imports,
importadora sob demanda de São Paulo. A PILAR não tem catálogo fixo:
importa qualquer categoria (têxtil, construção, ferramentas
automotivas, tapetes, alimentos, automação etc.), com fornecedores
concentrados na China e em Dubai.

Sua tarefa: a partir da demanda que o usuário descrever, fazer as
perguntas necessárias para qualificar o pedido ANTES de cotar.
Cubra, uma pergunta por vez (não despeje todas de uma vez):
1. O que exatamente precisa importar (especificação do produto)?
2. Quantidade e frequência (compra única ou recorrente)?
3. Prazo necessário na porta do cliente?
4. Requisitos técnicos ou certificações (INMETRO, ANVISA, ANATEL)?
5. Mercado/uso de destino do produto?

Quando tiver as respostas, gere um BRIEFING FINAL em dois blocos:
- Bloco 1 (português): resumo interno para a PILAR.
- Bloco 2 (inglês): RFQ pronto para enviar ao fornecedor na China,
  tom profissional, sem mencionar o cliente final por nome.
Não invente especificações que o usuário não deu.
```

**`prompts/proposta.md`:**

```
Você é o assistente de propostas comerciais da PILAR Imports.
Tom profissional, português brasileiro. Estrutura obrigatória:
1) Apresentação breve da PILAR e seus diferenciais — os 3Ps:
   preço competitivo, produto superior, pontualidade na entrega;
2) Descrição clara do produto/solução solicitada;
3) Condições comerciais: prazo de entrega estimado, forma de
   pagamento, Incoterm se aplicável;
4) Próximos passos.

REGRAS ABSOLUTAS (documento vai direto ao cliente final):
- NUNCA incluir preço de custo, valor FOB, margens ou nome de
  fornecedores. Se o usuário colar dados internos, use-os apenas
  para calcular/contextualizar, mas o texto final não pode contê-los.
- Não mencionar China/Dubai ou origem específica, salvo pedido
  explícito do usuário.
```

### 3.3 Guardrail determinístico no servidor (não confiar só no prompt)

Antes de devolver a resposta do fluxo `proposta` ao frontend, o `painel-proxy.js` roda uma verificação por regex/heurística sobre o texto gerado:
- Padrões bloqueantes: `FOB`, `custo`, `margem`, `markup`, valores em USD acompanhados das palavras acima, e nomes de fornecedores conhecidos (manter lista em `config/fornecedores-bloqueados.json`, gitignorado, alimentada manualmente).
- Se detectar, não devolver o texto: responder ao frontend com aviso "Rascunho bloqueado: possível dado interno detectado (termo: X). Revise a entrada." Isso protege contra o erro mais caro do fluxo comercial.

### 3.4 Frontend — dois pontos de entrada

- **Novo item no menu "Importação": "Nova Demanda"** → tela de chat simples (histórico, input, enviar). Cada turno envia o array `mensagens` completo (a API é stateless). Botão "Copiar briefing" quando o assistente gerar o briefing final.
- **No módulo Proposta Comercial existente:** botão "✨ Gerar rascunho com IA" que abre painel lateral de chat com `fluxo: "proposta"`. O texto aprovado pelo usuário alimenta o fluxo atual de geração do .docx (python-docx) — a IA gera conteúdo, o pipeline de documento continua o mesmo.
- Indicador de carregamento durante a chamada; erro de rede mostra mensagem clara, nunca trava a tela.

### 3.5 Critérios de aceite — Fase 3
- [ ] `ANTHROPIC_API_KEY` ausente do repositório (conferir `git log -p` e `.gitignore`).
- [ ] Fluxo qualificação: conversa de teste termina em briefing PT + RFQ EN.
- [ ] Fluxo proposta: colar custo FOB de teste na entrada → rascunho final não contém o valor; se contiver, guardrail bloqueia.
- [ ] Rate limit responde 429 após estouro.
- [ ] Log local registra tokens por chamada.

---

## Deploy (todas as fases)

1. Commit local no Mac via Claude Code → push para GitHub.
2. No VPS, **somente** o comando de safe deploy já documentado (git fetch/reset preservando `dados.json`) + `pm2 restart`.
3. Após cada deploy: smoke test no `painel.html` em produção + `pm2 logs` por 2 minutos.
4. Lembrete: se houver restauração de backup do `dados.json`, re-rodar `migrar_aliquotas_ncm.py` conforme procedimento existente.
