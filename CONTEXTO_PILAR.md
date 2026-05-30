# CONTEXTO DO PROJETO — PILAR Imports · Calculadora de Importação

> Documento de referência rápida para retomar o projeto em qualquer sessão.
> Atualizado em: 2026-05-29

---

## 1. O que é o projeto

**Calculadora de Importação da PILAR Imports** — ferramenta web interna para precificação de importações da China com todos os tributos do regime **Lucro Real | MG | Venda Interestadual**.

O objetivo é substituir a planilha Excel ("TABELA DE PREÇOS - MATRIZ - JUROS - LR.xlsx") por uma interface web moderna, rápida e compartilhável.

---

## 2. Arquitetura

### Stack
| Camada | Tecnologia |
|---|---|
| Frontend | HTML5 + CSS puro + JavaScript vanilla (sem framework) |
| Dados de produtos | `produtos.json` (carregado via `fetch`) |
| Persistência | `localStorage` (chave: `pilar_sims`) |
| Compartilhamento | URL com `?sim=<base64 do estado>` |
| Câmbio | API PTAX do Banco Central (`olinda.bcb.gov.br`) |

### Arquivos
```
~/pilar-calculadora/
├── index.html                              # aplicação completa (tudo inline)
├── produtos.json                           # banco de produtos com NCMs e alíquotas
├── web_Logo_sem assinatura_turquesa.png    # logo PILAR (usada na tela e na cotação)
└── TABELA DE PREÇOS - MATRIZ - JUROS - LR.xlsx  # planilha original de referência
```

### Fluxo da aplicação
```
Usuário abre index.html
  → fetch produtos.json
  → carrega PTAX (tenta até 7 dias úteis para trás)
  → restaura estado da URL (?sim=) se houver
  → usuário preenche processo + itens
  → calcAll() recalcula tudo em tempo real
  → [opcional] Gerar Cotação → visualização para impressão/PDF
```

---

## 3. Lógica fiscal (Lucro Real · MG · Interestadual)

### Importação
| Tributo | Base de cálculo |
|---|---|
| II | CIF |
| IPI | CIF |
| PIS importação | CIF |
| COFINS importação | CIF |
| ICMS importação | (CIF + II + IPI + PIS + COFINS + Siscomex) × alíquota — **informativo**, não entra no custo (Lucro Real credita) |

**Custo de Importação Final** = CIF + II + IPI + PIS_imp + COFINS_imp + custos operacionais − créditos (IPI + PIS + COFINS)

### Custos operacionais (defaults)
| Item | Valor padrão | Rateio |
|---|---|---|
| Siscomex | R$ 192,79 | proporcional ao FOB |
| AFRMM | 8% × frete R$ + R$ 20 (auto) | por item |
| Despachante | R$ 2.500 | proporcional ao FOB |
| Dif. Frete Intl | 2,5% × frete R$ (auto, editável) | por item |
| Agente de Cargas | R$ 1.800 | × nº containers |
| Armazenagem Porto | R$ 2.600 | × nº containers |
| Capatazia | R$ 1.010 | × nº containers |
| Operador Logístico | R$ 1.000 | × nº containers |

### Venda
| Tributo | Alíquota | Base |
|---|---|---|
| ICMS NF destacado | 4% (interestadual) | — |
| ICMS efetivo recolhido | **1,5%** (Regime Especial MG) | PV |
| PIS venda | 1,65% | PV − IPI − ICMS_efetivo |
| COFINS venda | 7,60% | PV − IPI − ICMS_efetivo |
| IPI venda | por produto | calculado "por fora" |
| CSLL | 9% | lucro antes do IR |
| IR | 15% | lucro antes do IR |
| IR Adicional | 10% | lucro acima de R$ 60.000/trimestre |

### Algoritmo de precificação
O PV é calculado por **convergência iterativa (até 300 iterações)** — o preço de venda influencia os tributos sobre vendas, que por sua vez influenciam o custo total e o preço. O loop converge com precisão de R$ 0,0001.

**Modo manual de PV**: o usuário pode fixar o PV em USD; a margem é então calculada de forma informativa.

---

## 4. Banco de produtos (`produtos.json`)

Cada produto tem:
```json
{
  "produto": "NOME DO PRODUTO",
  "ncm": "0000.00.00",
  "ii": 0.162,
  "ipi": 0.0,
  "pis_importacao": 0.021,
  "cofins_importacao": 0.0965,
  "pis_venda": 0.0165,
  "cofins_venda": 0.076,
  "icms_intra": 0.18,
  "icms_inter": 0.04,
  "reg_espec_intra": 0.14,
  "reg_espec_inter": 0.015,
  "menor_fob": 3.05,
  "valor_fob": 3.05
}
```

**Categorias de produtos cadastrados:**
- Cama/banho: colchas, jogos de cama (poliéster/percal), protetores de colchão, pillow tops
- Têxteis: cortinas, fibra de poliéster, fio de poliéster
- Outros: motos 110cc, capacetes, parafina, computador all-in-one, monitor, empilhadeiras, cadeira de massagem, fragrâncias, plástico para embalagem, mala de viagem, carpete, fita adesiva

---

## 5. Funcionalidades implementadas

- [x] Câmbio PTAX automático (Banco Central, até 7 dias retroativos)
- [x] Multi-item por processo (número ilimitado de itens)
- [x] Busca/autocomplete de produtos com alíquotas automáticas
- [x] Cálculo em tempo real (oninput)
- [x] Bidireccional: Margem ↔ PV USD
- [x] AFRMM e Dif. Frete calculados automaticamente
- [x] Resumo geral do processo (FOB, CIF, impostos, lucro, margem média)
- [x] Geração de cotação para cliente (layout imprimível)
  - Opção à vista
  - Opção a prazo (acréscimo configurável)
  - Validade automática (data do processo + 7 dias)
- [x] Salvar/restaurar simulações via localStorage (até 20)
- [x] Compartilhamento via link (base64 na URL, `?sim=...`)
- [x] Logo PILAR integrada na calculadora e na cotação
- [x] Responsivo (breakpoints 900px e 560px)

---

## 6. Deploy / VPS

<!-- PREENCHER: informações do servidor onde está hospedado -->

| Item | Valor |
|---|---|
| Provedor VPS | _a preencher_ |
| IP / hostname | _a preencher_ |
| Porta HTTP/HTTPS | _a preencher_ |
| Diretório no servidor | _a preencher_ |
| URL de acesso | _a preencher_ |
| Usuário SSH | _a preencher_ |

**Comando de deploy (exemplo):**
```bash
rsync -avz ~/pilar-calculadora/ usuario@ip:/var/www/pilar-calculadora/
```

---

## 7. Credenciais e acessos (mencionar apenas internamente)

<!-- PREENCHER: senhas e acessos — não versionar em repositório público -->

| Serviço | Usuário / Chave | Observação |
|---|---|---|
| VPS SSH | _a preencher_ | |
| Painel de controle VPS | _a preencher_ | |
| Domínio / DNS | _a preencher_ | |
| E-mail corporativo | _a preencher_ | |

---

## 8. Links úteis

| Recurso | URL |
|---|---|
| API PTAX (Banco Central) | `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/` |
| Consulta NCM (Siscomex) | `https://www.siscomex.gov.br/` |
| Tabela TIPI (IPI) | `https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/tipi` |
| Calculadora online (produção) | _a preencher_ |
| Repositório / backup | _a preencher_ |

---

## 9. Próximos passos planejados

<!-- Atualizar conforme prioridades mudarem -->

### Alta prioridade
- [ ] Hospedagem em VPS com HTTPS (nginx + Let's Encrypt)
- [ ] Adicionar mais produtos ao `produtos.json` (especialmente têxteis faltantes)
- [ ] Validação de alíquotas contra tabela TIPI atualizada

### Média prioridade
- [ ] Campo de observações por item na cotação
- [ ] Exportação da simulação como PDF via API (sem depender do print do browser)
- [ ] Suporte a múltiplos containers por item com frete diferente
- [ ] Histórico de taxa PTAX (gráfico ou tabela para referência)

### Baixo / futuro
- [ ] Autenticação simples (senha única) para acesso externo
- [ ] Banco de clientes para preenchimento rápido do campo "Nome do Cliente"
- [ ] Modo "comparação de processos" (dois processos lado a lado)
- [ ] Integração com Google Sheets para sincronizar produtos.json

---

## 10. Notas técnicas importantes

- A aplicação **requer servidor HTTP** para funcionar (o `fetch('produtos.json')` falha em `file://`). Em local, usar `python3 -m http.server 8080` ou Live Server do VS Code.
- O campo **"Dif. Frete Intl"** é calculado automaticamente (2,5% do frete R$) mas é editável — qualquer edição manual prevalece enquanto o foco estiver no campo.
- O **AFRMM** é recalculado automaticamente e **não é editável** (campo read-only).
- O estado salvo no localStorage usa `pilar_sims` como chave — limpar o localStorage do browser apaga todas as simulações.
- A URL compartilhável (`?sim=`) codifica o estado completo em base64 — pode ficar longa com muitos itens.
- O **Regime Especial ICMS MG** aplica 1,5% de recolhimento efetivo (destacado na NF como 4% interestadual). Isso está hardcoded via `reg_espec_inter: 0.015` em cada produto.
