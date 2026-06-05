# AGENTS.md — Painel Operacional PILAR Imports
> Documento de referência para o Claude Code construir e manter o sistema.
> Atualizado em: 2026-05-29

---

## 1. VISÃO GERAL DO PROJETO

**Painel Operacional PILAR** — sistema web interno que unifica o fluxo completo de importação da PILAR Imports, substituindo as planilhas Excel manuais por uma interface web integrada.

### O problema que resolve
Hoje existem 4 arquivos desconectados criados manualmente para cada processo:
1. **Order Request** → enviado ao fornecedor (China/Dubai)
2. **Resumo para Despachante** → para registro da DUIMP
3. **Pedido de Compra / Cálculo tributário** → controle interno
4. **Exportação Omie** → banco de produtos

O painel cria **um processo único** onde os dados são inseridos uma vez e geram todos os documentos automaticamente.

---

## 2. ARQUITETURA

### Stack
| Camada | Tecnologia |
|---|---|
| Frontend | HTML5 + CSS puro + JavaScript vanilla |
| Backend | Node.js (Express) — proxy para API Omie e geração de .xlsx |
| Banco de dados | JSON files no servidor + localStorage no browser |
| Câmbio | API PTAX do Banco Central (olinda.bcb.gov.br) |
| Omie | API REST oficial (app.omie.com.br/api/v1/) |
| Geração .xlsx | SheetJS (xlsx) no backend |
| Deploy | Mesmo servidor da calculadora (nginx, Ubuntu 24) |

### Estrutura de pastas
```
~/pilar-calculadora/
├── index.html                    # Calculadora de importação (existente)
├── painel.html                   # Painel Operacional (SPA standalone)
├── painel-proxy.js               # Proxy Node.js para Omie (porta 3001)
├── pilar-config.json             # Credenciais Omie (gitignored)
├── serve.sh                      # Sobe proxy + http.server 8080
├── produtos.json                 # Gerado pelo painel automaticamente
├── painel/
│   ├── js/
│   │   └── calc.js               # Motor de cálculo tributário (incluído por painel.html)
│   └── api/                      # Backend Express (não usado em produção atual)
│       ├── server.js
│       ├── routes/
│       └── data/
```

---

## 3. MÓDULOS DO SISTEMA

### 3.1 Dashboard
- KPIs: processos ativos, FOB total USD, itens totais, produtos Omie
- Próximos Eventos (−7 a +30 dias): embarque, porto, cliente, pagamentos, recebimentos
- Pipeline visual de processos ativos: 4 estágios (Pedido → Embarque → Porto → Cliente)
- Clique na linha navega direto para edição do processo

### 3.2 Novo Processo (3 seções + Precificação)
**Seção 1 — Dados do processo:**
- Número (PIL-XXX-XXXX), data, cliente, fornecedor, país, incoterm, proforma, previsões

**Seção 2 — Câmbios e Frete:**
- Câmbio DI (busca PTAX automático), Fiscal, Cliente
- Frete internacional USD, número de containers

**Seção 3 — Itens:**
- Autocomplete por código OU descrição buscando em pilar_produtos
- Ao selecionar: preenche Código, Descrição, NCM, Unidade, Peso Líq, Peso Bruto, Alíquotas
- Campos: código, descrição, cor/estampa, quantidade, unidade, FOB unit USD, NCM, GSM, largura

**Seção 4 — Precificação:**
- Motor calc.js em tempo real por item
- Entrada: Margem % ou PV fixo USD
- Saída: Custo unitário R$, PV sugerido R$ e USD, impostos venda, margem efetiva
- Resumo processo: FOB, CIF, Impostos Importação, Custos Operacionais, Custo Final, NF Total, Lucro, Margem

### 3.3 Processos
- Lista completa com botões Editar e Excluir
- Clique em Editar abre formulário pré-preenchido
- Salvar atualiza processo existente (pelo id) ou cria novo

### 3.4 Order Request
- Seleciona processo → preview dos itens → gera .xlsx (2 abas: EN + PT)
- Ao gerar: atualiza automaticamente `valor_fob` e `menor_fob` em pilar_produtos

### 3.5 Resumo Despachante
- Banco de Descrições DI: importação de .xlsx, edição inline, busca, exclusão
- Seleciona processo → coluna Descrição DI preenchida do banco → gera .xlsx

### 3.6 Fluxo de Caixa
- Câmbios do processo (leitura + link para edição)
- Parcelas Fornecedor: % | Valor USD | Data | Câmbio | R$ | Status | Pago
  - Rodapé: Total % + taxa média ponderada + alerta se ≠ 100%
- Recebimentos Cliente: % | Valor USD | Câmbio Spot | R$ | Data | Status
  - Total de referência: NF Total USD
  - Rodapé: Total % + alerta se ≠ 100%
  - Ao adicionar/remover parcela: redistribui % igualmente
- Resumo financeiro: Receitas vs Custo Total vs Saldo

### 3.7 Catálogo de Produtos (Omie)
- Importar .xlsx do Omie (lê colunas: Situação, Descrição, Código, Família, NCM, Pesos, Unidade)
- Sincronizar via API Omie (via painel-proxy.js, CORS pendente)
- Filtro por família + busca texto
- Salva em localStorage pilar_produtos

### 3.8 Configurações
- App Key + App Secret Omie (armazenados em pilar-config.json no servidor)
- Dados da empresa (razão, CNPJ, email, site)
- Defaults: despachante, porto, comissão, dif. frete

---

## 4. LÓGICA FISCAL COMPLETA (Lucro Real · MG · Interestadual)

> CRÍTICO: Esta seção é a espinha dorsal do sistema. Todo cálculo deve seguir exatamente esta lógica, idêntica à calculadora existente.

### 4.1 Câmbios do processo

```
CÂMBIO SINAL (fornecedor):   data e taxa do 1º pagamento ao fornecedor
CÂMBIO SALDO (fornecedor):   data e taxa do 2º pagamento ao fornecedor
CÂMBIO DI (fiscal):          taxa usada para cálculo de impostos na DI
CÂMBIO CLIENTE (venda):      taxa spot na data de recebimento do cliente
DÓLAR FISCAL:                câmbio para base de cálculo NF de entrada
TAXA MÉDIA (calculada):      média ponderada sinal/saldo pelo valor de cada parcela
```

### 4.2 Importação — Base de Cálculo

```
FOB (USD)              = soma(qtd_i × fob_unit_i)
Frete Internacional    = valor em USD (editável por processo)
CIF (USD)              = FOB + Frete Internacional
CIF (R$)               = CIF_USD × câmbio_DI

Valor Aduaneiro (R$)   = CIF_R$ + AFRMM + Siscomex
```

### 4.3 Importação — Tributos

| Tributo | Alíquota | Base de Cálculo | Observação |
|---|---|---|---|
| II (Imposto de Importação) | por NCM | CIF R$ | varia por produto |
| IPI importação | por NCM | CIF R$ | varia por produto |
| PIS importação | 2,10% | CIF R$ | fixo Lucro Real |
| COFINS importação | 10,65% | CIF R$ | fixo Lucro Real |
| Siscomex | R$ 192,79 | fixo por processo | rateio proporcional ao FOB |
| AFRMM | 8% × frete R$ | frete internacional R$ | automático, read-only |
| Diferença Frete Intl | % × frete R$ | editável | default 2,5% |
| ICMS importação | por NCM (intra) | BC especial | informativo — não entra no custo no Lucro Real |

BC ICMS importação (informativo):
```
BC_ICMS = (CIF_R$ + II + IPI + PIS_imp + COFINS_imp + Siscomex) / (1 - aliq_ICMS_intra)
ICMS_imp = BC_ICMS × aliq_ICMS_intra
```

Custo de Importação (sem créditos):
```
Custo_importação = CIF_R$ + II + PIS_imp + COFINS_imp + Siscomex + AFRMM
                 + Dif_frete + Despachante + Agente_cargas + Armazenagem
                 + Capatazia + Operador_logístico
```

Créditos recuperáveis (Lucro Real):
```
Crédito_IPI     = IPI_importação (se houver)
Crédito_PIS     = PIS_importação
Crédito_COFINS  = COFINS_importação
```

Custo Final de Importação:
```
Custo_final = Custo_importação - Crédito_IPI - Crédito_PIS - Crédito_COFINS
```

### 4.4 Custos Operacionais (defaults editáveis por processo)

| Item | Default | Rateio |
|---|---|---|
| Siscomex | R$ 192,79 | proporcional ao FOB |
| AFRMM | 8% × frete R$ | automático por processo |
| Despachante (SDA) | R$ 2.500,00 | proporcional ao FOB |
| Diferença Frete Intl | 2,5% × frete R$ | editável |
| Agente de Cargas | R$ 1.800,00 | x nº containers |
| Armazenagem Porto | R$ 2.600,00 | x nº containers |
| Capatazia | R$ 1.010,00 | x nº containers |
| Operador Logístico | R$ 1.000,00 | x nº containers |
| Comissão de vendas | 1,5% a 2% | sobre PV |

### 4.5 Venda — Tributos (Interestadual, Regime Especial MG)

| Tributo | Alíquota | Base de Cálculo | Observação |
|---|---|---|---|
| ICMS NF destacado | 4% | PV | interestadual |
| ICMS efetivo recolhido | 1,5% | PV | Regime Especial MG (hardcoded) |
| IPI venda | por NCM | PV | calculado por fora |
| PIS venda | 1,65% | PV − IPI − ICMS_efetivo | base reduzida |
| COFINS venda | 7,60% | PV − IPI − ICMS_efetivo | base reduzida |
| CSLL | 9% | lucro antes IR | base presumida 8% NF |
| IR | 15% | lucro antes IR | |
| IR Adicional | 10% | lucro > R$ 60.000/trimestre | |

Base de Cálculo PIS/COFINS venda:
```
BC_PIS_COFINS = PV - IPI_venda - ICMS_efetivo
PIS_venda     = BC_PIS_COFINS × 0,0165
COFINS_venda  = BC_PIS_COFINS × 0,0760
```

Base lucro presumido:
```
BC_lucro = NF_total × 0,08
CSLL     = BC_lucro × 0,09
IR       = BC_lucro × 0,15
IR_adic  = max(0, BC_lucro - 60000) × 0,10  [trimestral]
```

### 4.6 Algoritmo de Precificação (convergência iterativa)

O PV influencia os tributos de venda que influenciam o custo total e o PV. Loop até convergir:

```javascript
function calcularPV(custoFinal, margem, aliquotas, maxIter = 300) {
  let pv = custoFinal * (1 + margem);
  for (let i = 0; i < maxIter; i++) {
    const icms         = pv * 0.015;                   // Regime Especial MG
    const bcPisCofins  = pv - icms;                    // IPI = 0 neste exemplo
    const pis          = bcPisCofins * 0.0165;
    const cofins       = bcPisCofins * 0.0760;
    const comissao     = pv * aliquotas.comissao;
    const bcLucro      = pv * 0.08;
    const csll         = bcLucro * 0.09;
    const ir           = bcLucro * 0.15;
    const totalImpostos = icms + pis + cofins + comissao + csll + ir;
    const pvNovo       = custoFinal + totalImpostos + (pv * margem);
    if (Math.abs(pvNovo - pv) < 0.0001) break;
    pv = pvNovo;
  }
  return pv;
}
```

Modo Manual de PV: usuário fixa PV em USD → sistema calcula margem resultante (informativo).

### 4.7 Preço de Venda em USD

```
PV_USD = PV_R$ / câmbio_cliente_spot
```

---

## 5. FLUXO DE CAIXA E PAGAMENTOS

> Módulo central novo. Cada processo tem seu próprio fluxo de caixa completo.

### 5.1 Estrutura do Fluxo

```
SAÍDAS (custos):
  A) Pagamentos ao FORNECEDOR (parcelas livres em USD)
  B) Custos operacionais de importação (R$) com datas
  C) Impostos recolhidos (R$) com datas de vencimento

ENTRADAS (receitas):
  D) Recebimentos do CLIENTE (parcelas livres, USD convertido para R$)
```

### 5.2 Pagamentos ao Fornecedor

Estrutura de parcelas (editável livremente — sem limite de parcelas):

```json
{
  "pagamentos_fornecedor": [
    {
      "id": 1748520000000,
      "descricao": "Sinal",
      "percentual": 0.20,
      "valor_usd": 13219.63,
      "data_prevista": "2025-09-15",
      "data_realizada": null,
      "cambio": 5.5592,
      "valor_reais": 73503.18,
      "status": "previsto"
    }
  ]
}
```

Regras:
- Mínimo 1 parcela, sem máximo
- Soma dos percentuais deve totalizar 100% (alerta visual, não bloquear)
- Câmbio de cada parcela é independente e editável
- Taxa média ponderada calculada automaticamente
- Status: previsto | pago | atrasado

### 5.3 Câmbios do Processo

```json
{
  "cambios": {
    "di":      { "taxa": 5.5925, "data": "2025-10-20" },
    "fiscal":  { "taxa": 5.8500, "data": "2025-10-20" },
    "cliente": { "taxa": 5.7207, "data_prevista": "2025-11-15" },
    "ptax_auto": true
  }
}
```

### 5.4 Recebimentos do Cliente

```json
{
  "recebimentos_cliente": [
    {
      "id": 1748520000001,
      "descricao": "Pagamento",
      "percentual": 1.0,
      "valor_usd": 110352.60,
      "cambio": 5.7207,
      "valor_reais": 631298.33,
      "data_prevista": "2025-11-20",
      "data_realizada": null,
      "status": "previsto"
    }
  ]
}
```

Regras:
- Total de referência = resultado.nf_total_brl / câmbio_cliente
- Ao adicionar/remover parcela: redistribui % igualmente entre todas
- Rodapé mostra Total % com alerta se ≠ 100%

### 5.5 Visão da Tela de Fluxo de Caixa

**Bloco 1 — Câmbios (leitura):**
Câmbio DI | Câmbio Fiscal | Câmbio Cliente + botão "Editar no Processo"

**Bloco 2 — Pagamentos ao Fornecedor:**
Tabela: Parcela | % | Valor USD | Data | Câmbio | Valor R$ | Status | [✓ Pago] [✕]
Rodapé: Total % | Total USD | Taxa Média Pond. | Total R$ | alerta ≠ 100%

**Bloco 3 — Recebimentos do Cliente:**
Label: Total NF: USD X.XXX,XX
Tabela: Descrição | % | Valor USD | Câmbio Spot | Valor R$ | Data | Status | [✓ Recebido] [✕]
Rodapé: Total % | Total USD | Total R$ | alerta ≠ 100%

**Bloco 4 — Resumo Financeiro:**
Total Receitas | Pagto. Fornecedor | Custo Total | Saldo | Margem Estimada

---

## 6. MODELO DE DADOS — PROCESSO COMPLETO

```json
{
  "id": 1748520000000,
  "numero": "PIL-035-2025",
  "status": "ativo",
  "criado_em": "2025-09-10T14:00:00Z",
  "atualizado_em": "2025-09-10T14:00:00Z",

  "dados_gerais": {
    "cliente": "PAULO CESAR",
    "fornecedor": "LIMING TEXTILE CO.",
    "pais": "China",
    "incoterm": "FOB",
    "numero_proforma": "PIL-035-2025",
    "numero_invoice": "",
    "cond_pagamento": "20% ANTECIPADO / 80% SALDO",
    "prev_embarque": "2025-09-15",
    "prev_chegada_porto": "2025-10-20",
    "prev_chegada_cliente": "2025-10-27",
    "observacoes": ""
  },

  "cambios": {
    "di":      { "taxa": 5.5925, "data": "2025-10-20" },
    "fiscal":  { "taxa": 5.8500, "data": "2025-10-20" },
    "cliente": { "taxa": 5.7207, "data_prevista": "2025-11-15" },
    "ptax_auto": true
  },

  "frete": {
    "valor_usd": 5379.00,
    "containers": 1,
    "dif_frete_pct": 0.025
  },

  "custos_defaults": {
    "siscomex": 192.79,
    "despachante": 2500.00,
    "agente_cargas": 1700.00,
    "armazenagem": 2600.00,
    "capatazia": 1010.00,
    "operador_logistico": 1000.00,
    "comissao_pct": 0.015,
    "frete_rodoviario": 0.00,
    "outros": []
  },

  "itens": [
    {
      "id": 1,
      "codigo_omie": "COBT.260.090.0001",
      "descricao": "COBRE LEITO TOD 90GSM QUEEN 240X260CM BRANCO",
      "descricao_di": "JOGO DE CAMA MATELASSE 100% POLIESTER QUEEN",
      "cor": "BRANCO",
      "ncm": "9404.40.00",
      "quantidade": 992,
      "unidade": "PC",
      "fob_unit_usd": 8.59,
      "fob_total_usd": 8521.28,
      "gsm": 90,
      "largura_cm": 240,
      "peso_liq_unit": 1.45,
      "peso_bruto_unit": 1.50,
      "margem_pct": 0.20,
      "pv_fixo_usd": 0,
      "aliquotas": {
        "ii": 0.162,
        "ipi": 0.0,
        "pis_importacao": 0.021,
        "cofins_importacao": 0.1065,
        "pis_venda": 0.0165,
        "cofins_venda": 0.076,
        "icms_intra": 0.14,
        "icms_inter": 0.04,
        "reg_espec_intra": 0.14,
        "reg_espec_inter": 0.015
      }
    }
  ],

  "pagamentos_fornecedor": [],
  "recebimentos_cliente": [],
  "resultado": {}
}
```

---

## 7. INTEGRAÇÃO API OMIE

### Endpoints utilizados

```javascript
// Listar produtos
POST https://app.omie.com.br/api/v1/geral/produtos/
body: {
  call: 'ListarProdutos',
  app_key: APP_KEY,
  app_secret: APP_SECRET,
  param: [{ pagina: 1, registros_por_pagina: 500, apenas_importado_api: 'N' }]
}

// Campos mapeados: Omie → sistema
produto.codigo           → codigo
produto.descricao        → produto (nome de exibição)
produto.ncm              → ncm
produto.familia_produto  → familia
produto.peso_liq         → peso_liq_unit
produto.peso_bruto       → peso_bruto_unit
produto.unidade          → unidade
```

### Proxy no backend
As credenciais Omie ficam em `pilar-config.json` (gitignored). O proxy `painel-proxy.js` (Node.js puro, porta 3001) recebe POST /omie do browser e repassa para a API Omie com as credenciais do arquivo.

**Alternativa sem proxy:** importar o .xlsx exportado do Omie diretamente no Catálogo (botão "Importar .xlsx do Omie"). Lê colunas: Situação, Descrição, Código, Família, NCM, Peso Líq, Peso Bruto, Unidade.

---

## 8. INTEGRAÇÃO PTAX

```javascript
async function buscarPTAX(data) {
  // Tenta a data informada e retroage até 7 dias úteis
  const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/`
            + `CotacaoDolarDia(dataCotacao='${formatarDataPTAX(data)}')`
            + `?$top=1&$format=json`;
  // retorna cotacao.venda como taxa padrão
}
```

---

## 9. GERAÇÃO DE DOCUMENTOS .XLSX

### Order Request (SheetJS no browser via CDN)

Aba 1 — "REQUEST IN ENGLISH":
- Cabeçalho: PILAR IMPORTS LTDA | ORDER | DATE | SUPPLIER | COUNTRY | INCOTERM
- Colunas: ITEM | QUANTITY | UNIT PRICE (USD) | COLOR / DESIGN | UND | GSM | ROLL SIZE (CM) | OBS.
- Rodapé: total quantidade + total FOB USD + PAYMENT TERMS + SHIPMENT
- Campo de assinatura do exportador

Aba 2 — "ficha cadastral pedido" (português):
- Mesma estrutura em português

**Ao gerar Order Request:** atualiza automaticamente em pilar_produtos:
- `fob_unit_usd` = valor atual do item
- `menor_fob` = min(menor_fob_anterior, fob_unit_usd_atual)

### Resumo Despachante (.xlsx):
- Cabeçalho do processo
- Colunas: Código Omie | Descrição | Descrição DI | NCM | Quantidade | Un | FOB Unit USD | FOB Total USD | Peso Líq | Peso Bruto | GSM | Largura

---

## 10. REGRAS DE NEGÓCIO CRÍTICAS

1. Câmbio DI, câmbio fiscal, câmbio cliente e câmbio sinal/saldo são SEMPRE independentes e editáveis.
2. ICMS importação é informativo no Lucro Real — gera crédito, não entra no custo.
3. Regime Especial MG = 1,5% de recolhimento efetivo (NF destaca 4% interestadual). Hardcoded em reg_espec_inter: 0.015.
4. Base PIS/COFINS venda = PV - IPI_venda - ICMS_efetivo (não é sobre o PV bruto).
5. Base lucro presumido = 8% da NF total (não do lucro real apurado).
6. IR Adicional: 10% sobre lucro presumido que exceder R$ 60.000/trimestre.
7. Convergência iterativa: máximo 300 iterações, precisão R$ 0,0001.
8. AFRMM = 8% × frete R$ + R$20 fixo — campo read-only.
9. Taxa média fornecedor = média ponderada dos câmbios pelo valor USD de cada parcela.
10. Credenciais Omie ficam SOMENTE em pilar-config.json (servidor), nunca no frontend.
11. Soma das parcelas ao fornecedor e ao cliente deve totalizar 100% — alerta visual, não bloqueia salvar.
12. Ao gerar Order Request: atualiza valor_fob e menor_fob em pilar_produtos automaticamente.
13. Autocomplete de produtos (código e descrição) preenche: código, descrição, NCM, unidade, pesos e alíquotas completas.
14. Custos operacionais no Resumo = despachante (fixo) + agente × containers + armazenagem × containers + capatazia × containers + oplog × containers.

---

## 11. UX / INTERFACE

- Tema claro — identidade visual idêntica à calculadora existente (index.html)
- Paleta: turquesa #00BCD4 como cor principal, cinza #37474F para header/sidebar
- Fontes: sistema (-apple-system, Segoe UI, sans-serif)
- Valores: R$ 1.234,56 / USD 1.234,56 / câmbios com 4 casas decimais
- Status com badge colorido: verde=ativo/realizado, azul=concluído, vermelho=atrasado
- Tabelas com inputs editáveis inline
- Toasts para feedback (4 segundos)
- Dropdown autocomplete com borda turquesa

---

## 12. DEPLOY

```bash
# Para desenvolvimento local:
bash serve.sh
# Abre: http://localhost:8080/painel.html
# Proxy Omie: http://localhost:3001/omie

# Produção (GitHub Pages — frontend only):
# https://henriquehog-cpu.github.io/pilar-calculadora/painel.html

# Para deploy completo com proxy:
# nginx config (adicionar ao site existente):
location /painel/ {
    alias /var/www/pilar-calculadora/;
}
location /api/ {
    proxy_pass http://localhost:3001/;
    proxy_http_version 1.1;
}

# PM2 para o proxy Node.js:
pm2 start /var/www/pilar-calculadora/painel-proxy.js --name pilar-proxy
pm2 save
pm2 startup
```

---

## 13. CHECKLIST DE IMPLEMENTAÇÃO

### Fase 1 — Base ✅
- [x] Estrutura de pastas e arquivos
- [x] Backend Express + proxy Omie + rota geração xlsx (painel/api/ — disponível mas não usado em prod)
- [x] CRUD processos em JSON (localStorage no frontend)
- [x] Módulo calc.js com lógica fiscal completa (seção 4)
- [x] Sincronização Omie → pilar_produtos (via proxy ou importação xlsx)

### Fase 2 — Processos e Documentos ✅
- [x] Formulário novo processo (3 seções + precificação)
- [x] Tabela de itens com autocomplete Omie inline (código e descrição)
- [x] Cálculo tributário por item e por processo em tempo real
- [x] Geração .xlsx Order Request (2 abas)
- [x] Geração .xlsx Resumo Despachante

### Fase 3 — Fluxo de Caixa ✅
- [x] Câmbios do processo (leitura + link para edição)
- [x] Parcelas fornecedor: %, Valor USD, câmbio, data, status, marcar pago
- [x] Recebimentos cliente: %, Valor USD, câmbio spot, data, status, marcar recebido
- [x] Redistribuição automática de % ao adicionar/remover parcelas
- [x] Alerta quando soma ≠ 100%
- [x] Resumo financeiro recalculado em tempo real

### Fase 4 — Polish e Deploy
- [x] Dashboard com KPIs reais
- [x] Próximos Eventos (−7 a +30 dias) com eventos de pagamentos e recebimentos
- [x] Pipeline visual de processos ativos (4 estágios com dots coloridos)
- [x] Autocomplete produtos por código e descrição
- [x] Catálogo Omie com importação de .xlsx
- [x] Edição de processo (pré-preenchimento completo)
- [ ] Formatação visual avançada dos arquivos Excel (estilos, cores, logo)
- [ ] PDF cotação para cliente
- [ ] Timeline SVG de pagamentos
- [ ] Deploy nginx + PM2 (proxy Omie com CORS resolvido)

---

## 14. ARQUIVOS DE REFERÊNCIA

| Arquivo | Uso |
|---|---|
| `~/pilar-calculadora/index.html` | Fonte da lógica fiscal — consultar sempre |
| `~/pilar-calculadora/painel.html` | Painel principal (SPA standalone) |
| `~/pilar-calculadora/painel/js/calc.js` | Motor de cálculo fiscal |
| `~/pilar-calculadora/painel-proxy.js` | Proxy Omie Node.js puro |
| `~/pilar-calculadora/pilar-config.json` | Credenciais Omie (gitignored) |
| `compras__estoque_e_producao_*.xlsx` | Estrutura de campos do Omie |
| `ORDER_REQUEST_-_PIL-003-2026.xlsx` | Formato do documento Order Request |
| `Copia_de_resumo_pedido_*.xlsx` | Formato do Resumo Despachante |

---

## 15. ESTADO ATUAL DO SISTEMA (2026-06-05)

### Acesso
- **Frontend:** https://henriquehog-cpu.github.io/pilar-calculadora/painel.html
- **Local:** `bash serve.sh` → http://localhost:8080/painel.html

### Módulos funcionando (localStorage, sem backend)

| Módulo | Status | Observação |
|---|---|---|
| Dashboard | ✅ | KPIs, Próximos Eventos (−7/+30d), Pipeline 4 estágios, clique → editar |
| Processos | ✅ | Lista, criar, editar (pré-preenchido), excluir |
| Novo Processo | ✅ | 3 seções + Seção 4 Precificação com calc.js em tempo real |
| Order Request | ✅ | PDF 1 página em inglês, logo PILAR, código + descrição na tabela, email dinâmico da config |
| Resumo Despachante | ✅ | Banco DI (importação .xlsx, edição, busca) + PDF (colunas fixas) + Excel (.xlsx) — dois botões coexistem |
| Fluxo de Caixa | ✅ | Câmbios, parcelas % fornecedor, parcelas % cliente, alertas, resumo |
| Catálogo Omie | ✅ | Importação .xlsx do Omie + busca + filtro por família |
| Configurações | ✅ | Dados empresa + defaults dos processos |
| Modal Novo Produto | ✅ | Gera código automático (PREFIXO.LARGURA.GSM.SEQUENCIAL), auto-preenche tipo/matéria/NCM pela família, campo prefixo customizado para famílias novas |
| Exportação para Omie | ✅ | Detecta itens novos (★), gera .xlsx no formato template Omie_Produtos_v1_9_5 |
| Gerador de Etiquetas de Rolo | ✅ | .xlsx com xlsx-js-style (bordas, negrito, cores turquesa), duas etiquetas por aba, aba QTYE PER CUSTOMER |
| Campo Cliente por item | ✅ | Coluna Cliente na tabela de itens do processo |
| PV Fixo USD | ✅ | Campo texto livre, aceita vírgula e ponto, recalcula no onblur sem reset do cursor |
| Cadastro de Produto (Calculadora) | ✅ | index.html: produto inexistente → "＋ Cadastrar no banco" (form inline NCM + alíquotas), salva via POST /api/produtos + localStorage; produto existente → alíquotas read-only com "✏ Editar alíquotas" (ajuste só no cálculo) |
| Wizard Importar Montagem | ✅ | Botão "📋 Importar Montagem" ao lado de "+ Novo Processo"; 3 etapas: texto livre → dados do processo → preview com FOB editável por item; parser aceita "22 mil metros", "22.000" etc; cria processo completo com itens novos (★) |
| Etiquetas HTML | ✅ | Sub-aba "🏷️ Etiquetas" dentro do Order Request; layout print-ready, 2 por linha, logo PILAR, @media print esconde o resto; substitui o gerador xlsx |
| Persistência no servidor | ✅ | Processos salvos em dados.json via /api/processos (GET/POST/DELETE); localStorage como cache; servidor prevalece no init |
| Banco DI automático | ✅ | banco_di.json servido por GET /api/banco-di; carrega automático ao abrir Resumo Despachante; lookup por prefixo (4 letras) com substituição de GSM e largura |
| Alíquotas II corrigidas | ✅ | 28 itens nos processos PIL-005/006/048 corrigidos via script por NCM (produtos_com_aliquotas.json); II agora calculado corretamente (ex: 26% para NCMs 5407.x) |

### Pendente

| Item | Prioridade |
|---|---|
| produtos.json do Omie não tem alíquotas de importação (ii=0); fonte correta é produtos_com_aliquotas.json (332 produtos, 325 com ii>0) — manter sincronizado com o banco da calculadora | Alta |
| Templates de descrição DI por família | Alta — banco_DI_cruzado_PILAR_v2.xlsx gerado, aguarda preenchimento manual |
| HTTPS + domínio próprio no VPS | Média |
| Integração Omie via proxy funcionando | ✅ Resolvido — 817 produtos sincronizados via API |
| Formatação visual dos arquivos Excel | Média — cores, logo, estilos |
| PDF cotação para cliente | Média |
| Timeline SVG de pagamentos | Baixa |

### Infraestrutura
- **VPS:** 217.9.14.234:8080 (Node.js + PM2)
- **Projeto:** `/opt/pilar-calculadora`
- **Dados persistidos:** `dados.json` e `produtos.json` no servidor
- **Credenciais Omie:** `pilar-config.json` (não versionado)
- **GitHub:** github.com/henriquehog-cpu/pilar-calculadora

### Regras de negócio confirmadas em produção
- Ao gerar Order Request: atualiza automaticamente `valor_fob` e `menor_fob` em `pilar_produtos`
- Autocomplete por código OU descrição preenche: código, descrição, NCM, unidade, pesos, alíquotas completas (II, IPI, PIS, COFINS e variantes)
- Distribuição de parcelas de recebimento: redistribuição automática de % ao adicionar/remover
- Custos operacionais no Resumo: soma direta dos `custos_defaults` (despachante fixo + container × n)
- calc.js usa alocação proporcional ao FOB para distribuir frete e custos de container entre itens
- Calculadora (index.html) e Painel compartilham o banco de produtos via `POST /api/produtos` (array completo) + `localStorage.pilar_produtos`; produto novo salvo na calculadora grava `pis_venda:0.0165`, `cofins_venda:0.076`, `reg_espec_intra:0.14` por padrão (não expostos no form)
