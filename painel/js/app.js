/**
 * app.js — SPA Router + Estado Global + Renders de View
 * Painel Operacional PILAR Imports — Fase 1
 */

/* ── Estado global ─────────────────────────────────────────────────────── */
const App = {
  config: null,
  omieOk: null,
  processos: [],

  async init() {
    await this.loadConfig();
    this.checkOmie();
    this.setupNav();
    this.router();
    window.addEventListener('hashchange', () => this.router());
  },

  async loadConfig() {
    try {
      const r = await fetch('/api/config');
      this.config = await r.json();
    } catch { this.config = {}; }
  },

  async checkOmie() {
    const dot = document.getElementById('omie-dot');
    const lbl = document.getElementById('omie-label');
    if (dot) { dot.className = 'omie-dot loading'; }
    if (lbl) lbl.textContent = 'Omie: verificando...';

    const status = await Omie.status();
    this.omieOk = status.ok;

    if (dot) dot.className = `omie-dot ${status.ok ? 'ok' : 'error'}`;
    if (lbl) lbl.textContent = status.ok ? 'Omie: conectado' : 'Omie: desconectado';
  },

  setupNav() {
    document.querySelectorAll('[data-route]').forEach(el => {
      el.addEventListener('click', () => {
        location.hash = el.dataset.route;
      });
    });
  },

  router() {
    const hash = location.hash.replace('#', '') || 'dashboard';
    const [view, param] = hash.split('/');

    // Atualizar nav ativo
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.route === hash || el.dataset.route === view);
    });

    const content = document.getElementById('content');
    const topbarTitle = document.getElementById('topbar-title');

    const views = {
      dashboard:  () => this.renderDashboard(content, topbarTitle),
      catalogo:   () => this.renderCatalogo(content, topbarTitle),
      config:     () => this.renderConfig(content, topbarTitle),
      processos:  () => this.renderProcessos(content, topbarTitle),
    };

    if (views[view]) views[view]();
    else this.renderDashboard(content, topbarTitle);
  },

  /* ── DASHBOARD ─────────────────────────────────────────────────────────── */
  async renderDashboard(el, title) {
    title.textContent = 'Dashboard';
    el.innerHTML = '<div class="kpi-grid" id="kpi-area"></div><div id="dash-body"></div>';

    let processos = [];
    try {
      processos = await Processos.listar();
      this.processos = processos;
    } catch { /* offline */ }

    const ativos    = processos.filter(p => p.status === 'ativo').length;
    const fobTotal  = processos.reduce((s, p) => s + (p.resultado?.fob_total_usd || 0), 0);
    const itensTotal = processos.reduce((s, p) => s + (p.itens?.length || 0), 0);

    document.getElementById('kpi-area').innerHTML = `
      <div class="kpi-card accent">
        <div class="kpi-label">Processos Ativos</div>
        <div class="kpi-value">${ativos}</div>
        <div class="kpi-sub">${processos.length} total</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">FOB Total (USD)</div>
        <div class="kpi-value mono">${fmtUSD(fobTotal)}</div>
        <div class="kpi-sub">processos ativos</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Itens Cadastrados</div>
        <div class="kpi-value">${itensTotal}</div>
        <div class="kpi-sub">todos os processos</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Catálogo Omie</div>
        <div class="kpi-value" id="kpi-omie-count">—</div>
        <div class="kpi-sub">
          <span class="omie-dot ${this.omieOk ? 'ok' : 'error'}" style="vertical-align:middle"></span>
          ${this.omieOk ? 'conectado' : 'desconectado'}
        </div>
      </div>`;

    // Carregar contagem do catálogo
    Omie.buscarProdutos('').then(p => {
      const el = document.getElementById('kpi-omie-count');
      if (el) el.textContent = p.length >= 200 ? '200+' : String(p.length);
    }).catch(() => {});

    const ultimos = processos.slice(0, 5);
    document.getElementById('dash-body').innerHTML = `
      <div class="g2" style="margin-top:0; gap:20px">
        <div class="card">
          <div class="card-hd tq">Últimos Processos</div>
          <div class="card-bd" style="padding:0">
            ${ultimos.length === 0
              ? '<div class="empty-state" style="padding:30px"><p>Nenhum processo cadastrado</p></div>'
              : `<table class="pilar-table">
                  <thead><tr>
                    <th>Número</th><th>Cliente</th><th>Status</th><th>FOB USD</th>
                  </tr></thead>
                  <tbody>
                    ${ultimos.map(p => `
                      <tr style="cursor:pointer" onclick="location.hash='processos/${p.id}'">
                        <td class="mono">${p.numero}</td>
                        <td>${p.dados_gerais?.cliente || '—'}</td>
                        <td>${badgeStatus(p.status)}</td>
                        <td class="num">${fmtUSD(p.resultado?.fob_total_usd || 0)}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>`}
          </div>
        </div>
        <div class="card">
          <div class="card-hd">Ações Rápidas</div>
          <div class="card-bd" style="display:flex;flex-direction:column;gap:10px">
            <button class="btn btn-primary" onclick="location.hash='processos/novo'">
              ＋ Novo Processo
            </button>
            <button class="btn btn-secondary" onclick="location.hash='catalogo'">
              📦 Catálogo de Produtos
            </button>
            <button class="btn btn-secondary" onclick="location.hash='config'">
              ⚙ Configurações
            </button>
            <div class="divider"></div>
            <a href="/" class="btn btn-ghost" target="_blank">
              ↗ Abrir Calculadora
            </a>
          </div>
        </div>
      </div>`;
  },

  /* ── PROCESSOS LIST ────────────────────────────────────────────────────── */
  async renderProcessos(el, title) {
    title.textContent = 'Processos';
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🚧</div><h3>Em construção</h3><p>Disponível na Fase 2</p></div>';
  },

  /* ── CATÁLOGO ──────────────────────────────────────────────────────────── */
  async renderCatalogo(el, title) {
    title.textContent = 'Catálogo de Produtos';
    el.innerHTML = `
      <div class="page-hd">
        <div>
          <h2>Catálogo de Produtos</h2>
          <div class="page-sub">Sincronizado com o Omie — atualiza produtos.json da calculadora</div>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-secondary btn-sm" id="btn-sync" onclick="App.syncOmie()">
            ↻ Sincronizar Omie
          </button>
        </div>
      </div>

      <div class="card mb-6">
        <div class="card-bd" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <div class="field" style="flex:1;min-width:200px;margin:0">
            <input type="text" id="cat-search" placeholder="Buscar produto, código ou NCM..."
                   oninput="App.filtrarCatalogo()">
          </div>
          <div class="field" style="width:180px;margin:0">
            <select id="cat-familia" onchange="App.filtrarCatalogo()">
              <option value="">Todas as famílias</option>
            </select>
          </div>
          <span class="text-muted" id="cat-count" style="font-size:12px"></span>
        </div>
      </div>

      <div id="catalogo-grid" class="catalogo-grid">
        <div class="empty-state"><div class="spin">↻</div> Carregando...</div>
      </div>`;

    this._produtosCatalogo = [];
    this._carregarCatalogo();
  },

  async _carregarCatalogo() {
    try {
      const [produtos, familias] = await Promise.all([
        Omie.buscarProdutos(''),
        Omie.listarFamilias()
      ]);
      this._produtosCatalogo = produtos;

      const sel = document.getElementById('cat-familia');
      if (sel) {
        familias.forEach(f => {
          const o = document.createElement('option');
          o.value = f; o.textContent = f;
          sel.appendChild(o);
        });
      }

      this._renderProdutos(produtos);
    } catch {
      const grid = document.getElementById('catalogo-grid');
      if (grid) grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📦</div>
          <h3>Catálogo vazio</h3>
          <p>Clique em "Sincronizar Omie" para importar os produtos</p>
        </div>`;
    }
  },

  _renderProdutos(lista) {
    const grid  = document.getElementById('catalogo-grid');
    const count = document.getElementById('cat-count');
    if (!grid) return;
    if (count) count.textContent = `${lista.length} produto${lista.length !== 1 ? 's' : ''}`;

    if (!lista.length) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-icon">🔍</div>
          <h3>Nenhum produto encontrado</h3>
        </div>`;
      return;
    }

    grid.innerHTML = lista.slice(0, 200).map(p => `
      <div class="produto-card">
        <div class="produto-nome">${p.produto}</div>
        <div class="produto-meta">
          ${p.codigo ? `<span>${p.codigo}</span>` : ''}
          ${p.ncm    ? `<span>NCM: ${p.ncm}</span>` : ''}
          ${p.familia ? `<span>${p.familia}</span>` : ''}
          ${p.unidade ? `<span>${p.unidade}</span>` : ''}
        </div>
        ${p.ii ? `<div class="produto-meta" style="margin-top:4px">
          <span>II: ${fmtPct(p.ii)}</span>
          <span>IPI: ${fmtPct(p.ipi)}</span>
        </div>` : ''}
      </div>`).join('');
  },

  filtrarCatalogo() {
    const q       = document.getElementById('cat-search')?.value.toLowerCase() || '';
    const familia = document.getElementById('cat-familia')?.value || '';
    let lista = this._produtosCatalogo || [];
    if (familia) lista = lista.filter(p => p.familia === familia);
    if (q)       lista = lista.filter(p =>
      p.produto.toLowerCase().includes(q) ||
      (p.codigo || '').toLowerCase().includes(q) ||
      (p.ncm || '').includes(q)
    );
    this._renderProdutos(lista);
  },

  async syncOmie() {
    const btn = document.getElementById('btn-sync');
    if (btn) { btn.disabled = true; btn.textContent = '↻ Sincronizando...'; }
    try {
      const r = await Omie.sincronizar();
      toast(`✓ ${r.total} produtos sincronizados com sucesso`, 'success');
      this._carregarCatalogo();
      this.checkOmie();
    } catch (e) {
      toast(`Erro: ${e.message}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '↻ Sincronizar Omie'; }
    }
  },

  /* ── CONFIG ────────────────────────────────────────────────────────────── */
  async renderConfig(el, title) {
    title.textContent = 'Configurações';

    const cfg = this.config || {};
    const emp = cfg.empresa || {};
    const def = cfg.defaults || {};
    const omie = cfg.omie || {};

    el.innerHTML = `
      <div class="page-hd">
        <div><h2>Configurações</h2></div>
        <button class="btn btn-primary" onclick="App.salvarConfig()">Salvar Configurações</button>
      </div>

      <div class="g2" style="gap:20px;align-items:start">
        <div>
          <!-- Omie -->
          <div class="card mb-6">
            <div class="card-hd tq">🔌 Integração Omie</div>
            <div class="card-bd">
              <div class="config-section" style="margin-bottom:0">
                <div class="flex items-center gap-2 mb-4" style="font-size:13px">
                  <span class="omie-dot ${this.omieOk ? 'ok' : 'error'}"></span>
                  <span>${this.omieOk ? 'Conexão ativa' : 'Desconectado'}</span>
                  ${omie.app_key_preview ? `<span class="text-muted">· Chave: ${omie.app_key_preview}</span>` : ''}
                </div>
                <div class="g2" style="margin-bottom:12px">
                  <div class="field">
                    <label>App Key</label>
                    <input type="text" id="cfg-app-key" placeholder="Omie App Key" autocomplete="off">
                  </div>
                  <div class="field">
                    <label>App Secret</label>
                    <input type="password" id="cfg-app-secret" placeholder="Omie App Secret" autocomplete="off">
                  </div>
                </div>
                <div class="note text-muted">As credenciais ficam somente no servidor — nunca expostas ao browser.</div>
              </div>
            </div>
          </div>

          <!-- Empresa -->
          <div class="card">
            <div class="card-hd">🏢 Dados da Empresa</div>
            <div class="card-bd">
              <div class="g2" style="margin-bottom:12px">
                <div class="field" style="grid-column:span 2">
                  <label>Razão Social</label>
                  <input type="text" id="cfg-razao" value="${emp.razao_social || 'PILAR Imports'}">
                </div>
                <div class="field">
                  <label>CNPJ</label>
                  <input type="text" id="cfg-cnpj" value="${emp.cnpj || ''}">
                </div>
                <div class="field">
                  <label>Site</label>
                  <input type="text" id="cfg-site" value="${emp.site || 'www.pilarimports.com.br'}">
                </div>
                <div class="field">
                  <label>E-mail</label>
                  <input type="text" id="cfg-email" value="${emp.email || ''}">
                </div>
                <div class="field">
                  <label>Endereço</label>
                  <input type="text" id="cfg-endereco" value="${emp.endereco || ''}">
                </div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <!-- Defaults -->
          <div class="card">
            <div class="card-hd">⚙ Valores Default dos Processos</div>
            <div class="card-bd">
              <div class="g2">
                <div class="field">
                  <label>Siscomex (R$)</label>
                  <input type="number" id="cfg-siscomex" value="${def.siscomex || 192.79}" step="0.01">
                </div>
                <div class="field">
                  <label>Despachante (R$)</label>
                  <input type="number" id="cfg-despachante" value="${def.despachante || 2500}" step="100">
                </div>
                <div class="field">
                  <label>Agente de Cargas (R$/ctn)</label>
                  <input type="number" id="cfg-agente" value="${def.agente_cargas || 1700}" step="100">
                </div>
                <div class="field">
                  <label>Armazenagem Porto (R$/ctn)</label>
                  <input type="number" id="cfg-armazenagem" value="${def.armazenagem || 2500}" step="100">
                </div>
                <div class="field">
                  <label>Capatazia (R$/ctn)</label>
                  <input type="number" id="cfg-capatazia" value="${def.capatazia || 1010}" step="10">
                </div>
                <div class="field">
                  <label>Operador Logístico (R$/ctn)</label>
                  <input type="number" id="cfg-oplog" value="${def.operador_logistico || 1000}" step="100">
                </div>
                <div class="field">
                  <label>Comissão de Vendas (%)</label>
                  <input type="number" id="cfg-comissao" value="${((def.comissao_pct || 0.015) * 100).toFixed(2)}" step="0.1">
                </div>
                <div class="field">
                  <label>Dif. Frete Intl (%)</label>
                  <input type="number" id="cfg-difrete" value="${((def.dif_frete_pct || 0.025) * 100).toFixed(1)}" step="0.1">
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  },

  async salvarConfig() {
    const val = id => document.getElementById(id)?.value || '';
    const num = id => parseFloat(document.getElementById(id)?.value) || 0;

    const body = {
      empresa: {
        razao_social: val('cfg-razao'),
        cnpj:         val('cfg-cnpj'),
        site:         val('cfg-site'),
        email:        val('cfg-email'),
        endereco:     val('cfg-endereco')
      },
      defaults: {
        siscomex:           num('cfg-siscomex'),
        despachante:        num('cfg-despachante'),
        agente_cargas:      num('cfg-agente'),
        armazenagem:        num('cfg-armazenagem'),
        capatazia:          num('cfg-capatazia'),
        operador_logistico: num('cfg-oplog'),
        comissao_pct:       num('cfg-comissao') / 100,
        dif_frete_pct:      num('cfg-difrete') / 100
      }
    };

    const appKey    = val('cfg-app-key');
    const appSecret = val('cfg-app-secret');
    if (appKey || appSecret) {
      body.omie = { app_key: appKey, app_secret: appSecret };
    }

    try {
      const r = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) throw new Error();
      toast('Configurações salvas', 'success');
      await this.loadConfig();
      this.checkOmie();
    } catch {
      toast('Erro ao salvar configurações', 'error');
    }
  }
};

/* ── Helpers de formatação ─────────────────────────────────────────────── */
function fmtBRL(v) {
  if (!isFinite(v)) return '—';
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUSD(v) {
  if (!isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(v) {
  if (!isFinite(v)) return '—';
  return (v * 100).toFixed(2) + '%';
}

function badgeStatus(status) {
  const map = {
    ativo:     '<span class="badge badge-green">ativo</span>',
    concluido: '<span class="badge badge-blue">concluído</span>',
    arquivado: '<span class="badge badge-gray">arquivado</span>'
  };
  return map[status] || `<span class="badge badge-gray">${status}</span>`;
}

/* ── Toast ─────────────────────────────────────────────────────────────── */
function toast(msg, tipo = 'info', ms = 4000) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.innerHTML = `<span class="toast-msg">${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* ── Boot ──────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => App.init());
