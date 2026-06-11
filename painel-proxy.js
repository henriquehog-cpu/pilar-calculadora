'use strict';
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { spawn } = require('child_process');

const PORT        = process.env.PORT || 8080;
const ROOT        = __dirname;
const CONFIG_FILE = path.join(ROOT, 'pilar-config.json');
const DADOS_FILE  = path.join(ROOT, 'dados.json');
const PROD_FILE   = path.join(ROOT, 'produtos.json');
const BANCODI_FILE = path.join(ROOT, 'banco_di.json');
const OMIE_HOST   = 'app.omie.com.br';
const OMIE_PATH   = '/api/v1/geral/produtos/';

// ── IA (Fase 3) ──────────────────────────────────────────────────────────────
const PROMPTS_DIR     = path.join(ROOT, 'prompts');
const FORNEC_BLOQ_FILE = path.join(ROOT, 'config', 'fornecedores-bloqueados.json');
const LOG_DIR         = path.join(ROOT, 'logs');
const IA_LOG_FILE     = path.join(LOG_DIR, 'ia-chat.log');
const ANTHROPIC_HOST  = 'api.anthropic.com';
const ANTHROPIC_PATH  = '/v1/messages';
const IA_MODELO       = 'claude-sonnet-4-6';
const IA_MAX_TOKENS   = 2048;
const IA_RATE_LIMIT   = 20;     // máx. de requisições
const IA_RATE_WINDOW  = 60000;  // por janela (ms) = 1 minuto

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function lerConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}

function lerJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// dados.json — lê garantindo as chaves pilar_processos, pilar_demandas e pilar_simulacoes; cria o arquivo se não existir
function lerDados() {
  const d = lerJson(DADOS_FILE, null);
  if (!d || typeof d !== 'object') return { pilar_processos: [], pilar_demandas: [], pilar_simulacoes: [] };
  if (!Array.isArray(d.pilar_processos))  d.pilar_processos  = [];
  if (!Array.isArray(d.pilar_demandas))   d.pilar_demandas   = [];
  if (!Array.isArray(d.pilar_simulacoes)) d.pilar_simulacoes = [];
  return d;
}
function salvarDados(d) {
  fs.writeFileSync(DADOS_FILE, JSON.stringify(d, null, 2));
}
if (!fs.existsSync(DADOS_FILE)) {
  try { fs.writeFileSync(DADOS_FILE, JSON.stringify({ pilar_processos: [] }, null, 2)); }
  catch {}
}

function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ── IA: helpers ──────────────────────────────────────────────────────────────
// Lê o system prompt do fluxo a partir de prompts/*.md (versionados, sem segredos).
function lerPromptFluxo(fluxo) {
  const arquivo = fluxo === 'qualificacao' ? 'qualificacao.md' : 'proposta.md';
  try { return fs.readFileSync(path.join(PROMPTS_DIR, arquivo), 'utf8'); }
  catch { return null; }
}

// Rate limit simples em memória (por processo): IA_RATE_LIMIT por IA_RATE_WINDOW.
const _iaReqTimes = [];
function iaRateLimited() {
  const agora = Date.now();
  while (_iaReqTimes.length && agora - _iaReqTimes[0] > IA_RATE_WINDOW) _iaReqTimes.shift();
  if (_iaReqTimes.length >= IA_RATE_LIMIT) return true;
  _iaReqTimes.push(agora);
  return false;
}

// Guardrail determinístico (fluxo proposta): bloqueia se achar dado interno.
// Retorna o termo detectado (string) ou null se o texto estiver limpo.
function verificarGuardrail(texto) {
  const t = texto || '';
  const reTermos = /\b(fob|custo|margem|markup)/i; // erra para o lado de bloquear
  const m = t.match(reTermos);
  if (m) return m[1].toUpperCase();
  const lista = lerJson(FORNEC_BLOQ_FILE, []);
  if (Array.isArray(lista)) {
    const lower = t.toLowerCase();
    for (const nome of lista) {
      if (typeof nome === 'string' && nome.trim() && lower.includes(nome.toLowerCase().trim()))
        return nome.trim();
    }
  }
  return null;
}

// Registra custo por chamada em logs/ia-chat.log (gitignorado).
function logIA(fluxo, usage) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const linha = JSON.stringify({
      ts: new Date().toISOString(),
      fluxo,
      input_tokens:  (usage && usage.input_tokens)  || 0,
      output_tokens: (usage && usage.output_tokens) || 0,
    }) + '\n';
    fs.appendFileSync(IA_LOG_FILE, linha);
  } catch {}
}

// Chama POST https://api.anthropic.com/v1/messages (raw HTTPS, sem dependências).
// A chave vem SOMENTE de process.env.ANTHROPIC_API_KEY — nunca de arquivo.
function chamarAnthropic(systemPrompt, mensagens) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { const e = new Error('ANTHROPIC_API_KEY ausente'); e.code = 'NO_KEY'; return reject(e); }
    const payload = JSON.stringify({
      model: IA_MODELO,
      max_tokens: IA_MAX_TOKENS,
      system: systemPrompt,
      messages: mensagens,
    });
    const opts = {
      hostname: ANTHROPIC_HOST, path: ANTHROPIC_PATH, method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    };
    const areq = https.request(opts, ares => {
      let data = '';
      ares.on('data', c => data += c);
      ares.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { return reject(new Error('Resposta inválida da API')); }
        if (ares.statusCode >= 400) {
          const e = new Error((parsed.error && parsed.error.message) || ('HTTP ' + ares.statusCode));
          e.status = ares.statusCode;
          return reject(e);
        }
        resolve(parsed);
      });
    });
    areq.on('error', reject);
    areq.write(payload);
    areq.end();
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'OPTIONS') {
    cors(res); res.writeHead(204); res.end(); return;
  }

  // ── Proxy Omie ─────────────────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/omie') {
    readBody(req).then(parsed => {
      const cfg = lerConfig();
      if (!cfg.omie_app_key || !cfg.omie_app_secret)
        return json(res, 500, { erro: 'Credenciais não configuradas em pilar-config.json' });

      const payload = JSON.stringify({
        call:       parsed.call,
        app_key:    cfg.omie_app_key,
        app_secret: cfg.omie_app_secret,
        param:      parsed.params
      });

      const opts = {
        hostname: OMIE_HOST, path: OMIE_PATH, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      };
      const omieReq = https.request(opts, omieRes => {
        let data = '';
        omieRes.on('data', chunk => data += chunk);
        omieRes.on('end', () => {
          cors(res);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(data);
        });
      });
      omieReq.on('error', err => json(res, 502, { erro: err.message }));
      omieReq.write(payload);
      omieReq.end();
    }).catch(() => json(res, 400, { erro: 'Body JSON inválido' }));
    return;
  }

  // ── GET /api/dados ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/dados') {
    json(res, 200, lerJson(DADOS_FILE, {}));
    return;
  }

  // ── POST /api/dados ────────────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/dados') {
    readBody(req).then(data => {
      fs.writeFileSync(DADOS_FILE, JSON.stringify(data, null, 2));
      json(res, 200, { ok: true });
    }).catch(() => json(res, 400, { erro: 'JSON inválido' }));
    return;
  }

  // ── GET /api/produtos ──────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/produtos') {
    json(res, 200, lerJson(PROD_FILE, []));
    return;
  }

  // ── POST /api/produtos ─────────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/produtos') {
    readBody(req).then(data => {
      fs.writeFileSync(PROD_FILE, JSON.stringify(data, null, 2));
      json(res, 200, { ok: true });
    }).catch(() => json(res, 400, { erro: 'JSON inválido' }));
    return;
  }

  // ── GET /api/processos ─────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/processos') {
    json(res, 200, lerDados().pilar_processos);
    return;
  }

  // ── POST /api/processos ────────────────────────────────────────────────────
  // Body: array completo de processos (ou { pilar_processos: [...] }).
  if (req.method === 'POST' && url === '/api/processos') {
    readBody(req).then(body => {
      const arr = Array.isArray(body) ? body
                : (body && Array.isArray(body.pilar_processos) ? body.pilar_processos : null);
      if (!arr) return json(res, 400, { erro: 'Esperado array de processos' });
      const dados = lerDados();
      dados.pilar_processos = arr;
      salvarDados(dados);
      json(res, 200, { ok: true, total: arr.length });
    }).catch(() => json(res, 400, { erro: 'JSON inválido' }));
    return;
  }

  // ── GET /api/processos/:id ─────────────────────────────────────────────────
  if (req.method === 'GET' && url.startsWith('/api/processos/')) {
    const id   = decodeURIComponent(url.slice('/api/processos/'.length));
    const proc = lerDados().pilar_processos.find(p => String(p.id) === id);
    if (!proc) return json(res, 404, { erro: 'Processo não encontrado' });
    json(res, 200, proc);
    return;
  }

  // ── DELETE /api/processos/:id ──────────────────────────────────────────────
  if (req.method === 'DELETE' && url.startsWith('/api/processos/')) {
    const id    = decodeURIComponent(url.slice('/api/processos/'.length));
    const dados = lerDados();
    const antes = dados.pilar_processos.length;
    dados.pilar_processos = dados.pilar_processos.filter(p => String(p.id) !== id);
    salvarDados(dados);
    json(res, 200, { ok: true, removidos: antes - dados.pilar_processos.length });
    return;
  }

  // ── GET /api/demandas ──────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/demandas') {
    json(res, 200, lerDados().pilar_demandas);
    return;
  }

  // ── POST /api/demandas ─────────────────────────────────────────────────────
  // Body: array completo de demandas (ou { pilar_demandas: [...] }).
  if (req.method === 'POST' && url === '/api/demandas') {
    readBody(req).then(body => {
      const arr = Array.isArray(body) ? body
                : (body && Array.isArray(body.pilar_demandas) ? body.pilar_demandas : null);
      if (!arr) return json(res, 400, { erro: 'Esperado array de demandas' });
      const dados = lerDados();
      dados.pilar_demandas = arr;
      salvarDados(dados);
      json(res, 200, { ok: true, total: arr.length });
    }).catch(() => json(res, 400, { erro: 'JSON inválido' }));
    return;
  }

  // ── DELETE /api/demandas/:id ───────────────────────────────────────────────
  if (req.method === 'DELETE' && url.startsWith('/api/demandas/')) {
    const id    = decodeURIComponent(url.slice('/api/demandas/'.length));
    const dados = lerDados();
    const antes = dados.pilar_demandas.length;
    dados.pilar_demandas = dados.pilar_demandas.filter(d => String(d.id) !== id);
    salvarDados(dados);
    json(res, 200, { ok: true, removidos: antes - dados.pilar_demandas.length });
    return;
  }

  // ── GET /api/simulacoes ────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/simulacoes') {
    json(res, 200, lerDados().pilar_simulacoes);
    return;
  }

  // ── POST /api/simulacoes ───────────────────────────────────────────────────
  // Body: array completo de simulações (ou { pilar_simulacoes: [...] }).
  if (req.method === 'POST' && url === '/api/simulacoes') {
    readBody(req).then(body => {
      const arr = Array.isArray(body) ? body
                : (body && Array.isArray(body.pilar_simulacoes) ? body.pilar_simulacoes : null);
      if (!arr) return json(res, 400, { erro: 'Esperado array de simulações' });
      const dados = lerDados();
      dados.pilar_simulacoes = arr;
      salvarDados(dados);
      json(res, 200, { ok: true, total: arr.length });
    }).catch(() => json(res, 400, { erro: 'JSON inválido' }));
    return;
  }

  // ── DELETE /api/simulacoes/:id ─────────────────────────────────────────────
  if (req.method === 'DELETE' && url.startsWith('/api/simulacoes/')) {
    const id    = decodeURIComponent(url.slice('/api/simulacoes/'.length));
    const dados = lerDados();
    const antes = dados.pilar_simulacoes.length;
    dados.pilar_simulacoes = dados.pilar_simulacoes.filter(s => String(s.id) !== id);
    salvarDados(dados);
    json(res, 200, { ok: true, removidos: antes - dados.pilar_simulacoes.length });
    return;
  }

  // ── GET /api/banco-di ──────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/banco-di') {
    json(res, 200, lerJson(BANCODI_FILE, []));
    return;
  }

  // ── POST /api/etiquetas ──────────────────────────────────────────────────
  // Recebe { processo: {...}, logoPath } e devolve o .xlsx gerado pelo Python.
  if (req.method === 'POST' && url === '/api/etiquetas') {
    readBody(req).then(data => {
      const py = spawn('python3', [path.join(ROOT, 'gerar_etiquetas.py')]);
      const chunks = [];
      let errBuf = '';
      py.stdout.on('data', c => chunks.push(c));
      py.stderr.on('data', c => { errBuf += c; });
      py.on('error', err =>
        json(res, 500, { erro: 'Falha ao executar python3: ' + err.message }));
      py.on('close', code => {
        if (code !== 0)
          return json(res, 500, { erro: 'gerar_etiquetas.py falhou', detalhe: errBuf.trim() });
        const buf = Buffer.concat(chunks);
        const numero = (data && data.processo && data.processo.numero) || 'PROCESSO';
        cors(res);
        res.writeHead(200, {
          'Content-Type': MIME['.xlsx'],
          'Content-Disposition': `attachment; filename="ETIQUETAS_${numero}.xlsx"`,
          'Content-Length': buf.length
        });
        res.end(buf);
      });
      py.stdin.write(JSON.stringify(data || {}));
      py.stdin.end();
    }).catch(() => json(res, 400, { erro: 'Body JSON inválido' }));
    return;
  }

  // ── POST /api/proposta ─────────────────────────────────────────────────────
  // Recebe os campos da proposta e devolve o .docx gerado por gerar_proposta.py.
  if (req.method === 'POST' && url === '/api/proposta') {
    readBody(req).then(data => {
      const py = spawn('python3', [path.join(ROOT, 'gerar_proposta.py')]);
      const chunks = [];
      let errBuf = '';
      py.stdout.on('data', c => chunks.push(c));
      py.stderr.on('data', c => { errBuf += c; });
      py.on('error', err =>
        json(res, 500, { erro: 'Falha ao executar python3: ' + err.message }));
      py.on('close', code => {
        if (code !== 0)
          return json(res, 500, { erro: 'gerar_proposta.py falhou', detalhe: errBuf.trim() });
        const buf = Buffer.concat(chunks);
        const numero = (data && data.numero_pil) || 'PROPOSTA';
        const cliente = ((data && data.cliente) || '').replace(/[\\/:*?"<>|]/g, '').trim();
        const nomeArq = `Proposta Comercial ${numero}${cliente ? ' - ' + cliente : ''}.docx`;
        cors(res);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nomeArq)}`,
          'Content-Length': buf.length
        });
        res.end(buf);
      });
      py.stdin.write(JSON.stringify(data || {}));
      py.stdin.end();
    }).catch(() => json(res, 400, { erro: 'Body JSON inválido' }));
    return;
  }

  // ── GET /api/resumo-diario ───────────────────────────────────────────────
  // Read-only. Monta o briefing diário consumido pela Astrid (Telegram).
  // Proteção opcional: se PAINEL_INTERNAL_TOKEN existir, exige header X-Painel-Token.
  if (req.method === 'GET' && url === '/api/resumo-diario') {
    const tokenEsperado = process.env.PAINEL_INTERNAL_TOKEN;
    if (tokenEsperado && req.headers['x-painel-token'] !== tokenEsperado) {
      return json(res, 401, { erro: 'Token inválido ou ausente' });
    }

    const TZ = 'America/Sao_Paulo';
    // "hoje" no fuso de São Paulo, como YYYY-MM-DD (independe do fuso do servidor)
    const hojeStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const hoje = new Date(hojeStr + 'T00:00:00Z');
    // diferença em dias corridos entre uma data (YYYY-MM-DD) e hoje (SP)
    const diasEntre = (dataStr) => {
      if (!dataStr) return null;
      const d = new Date(String(dataStr).slice(0, 10) + 'T00:00:00Z');
      return Math.round((d - hoje) / 86400000);
    };
    // carimbo ISO com offset de São Paulo (Brasil sem horário de verão desde 2019)
    const relogioSP = new Intl.DateTimeFormat('sv-SE', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(new Date());
    const geradoEm = relogioSP.replace(' ', 'T') + '-03:00';

    const ativos = lerDados().pilar_processos.filter(p => p.status === 'ativo');

    const eventosProximos  = [];
    const eventosAtrasados = [];
    let aReceber = 0, aPagar = 0;

    // ── Eventos financeiros (têm campo `status` indicando conclusão) ──────────
    // grupos: [chave no processo, status que significa "concluído", rótulo, sinal]
    const gruposFin = [
      ['recebimentos_cliente',  'recebido', 'Recebimento', 'entrada'],
      ['pagamentos_fornecedor', 'pago',     'Pagamento',   'saida'],
    ];

    ativos.forEach(proc => {
      const cliente = (proc.dados_gerais || {}).cliente || null;

      gruposFin.forEach(([chave, statusOk, rotulo, sinal]) => {
        (proc[chave] || []).forEach(item => {
          if (!item.data_prevista || item.status === statusOk) return;
          const dias  = diasEntre(item.data_prevista);
          const valor = item.valor_reais || 0;
          const base  = {
            processo: proc.numero,
            cliente,
            tipo: item.descricao ? `${rotulo}: ${item.descricao}` : rotulo,
            data: String(item.data_prevista).slice(0, 10),
            valor,
            moeda: 'BRL',
          };
          if (dias < 0)       eventosAtrasados.push({ ...base, diasAtraso: -dias });
          else if (dias <= 7) eventosProximos.push({ ...base, diasRestantes: dias });
          // pendências financeiras: tudo ainda em aberto com vencimento até 30 dias
          if (dias <= 30) { if (sinal === 'entrada') aReceber += valor; else aPagar += valor; }
        });
      });

      // Numerário ao despachante: consolidado (1 evento por processo = soma dos itens)
      const numItens = proc.numerario_despachante || [];
      const num0 = numItens[0];
      if (num0 && num0.status !== 'pago' && num0.data_prevista) {
        const total = numItens.reduce((s, n) => s + (n.valor_reais || 0), 0);
        const dias  = diasEntre(num0.data_prevista);
        const base  = {
          processo: proc.numero, cliente, tipo: 'Numerário Despachante',
          data: String(num0.data_prevista).slice(0, 10), valor: total, moeda: 'BRL',
        };
        if (dias < 0)       eventosAtrasados.push({ ...base, diasAtraso: -dias });
        else if (dias <= 7) eventosProximos.push({ ...base, diasRestantes: dias });
        if (dias <= 30) aPagar += total;
      }

      // ── Milestones de navio (NÃO têm campo de conclusão no dados.json) ──────
      const g = proc.dados_gerais || {};
      const navio = [
        { tipo: 'Embarque',        data: g.prev_embarque },
        { tipo: 'Chegada Porto',   data: g.prev_chegada_porto },
        { tipo: 'Chegada Cliente', data: g.prev_chegada_cliente },
      ];
      navio.forEach((m, i) => {
        if (!m.data) return;
        const dias = diasEntre(m.data);
        const base = { processo: proc.numero, cliente, tipo: m.tipo, data: String(m.data).slice(0, 10) };
        if (dias >= 0 && dias <= 7) {
          eventosProximos.push({ ...base, diasRestantes: dias });
        } else if (dias < 0) {
          // atrasado só se a etapa seguinte ainda não tem data (processo parado nesta etapa)
          const proxima = navio[i + 1];
          if (!proxima || !proxima.data) eventosAtrasados.push({ ...base, diasAtraso: -dias });
        }
      });
    });

    eventosProximos.sort((a, b) => a.data < b.data ? -1 : a.data > b.data ? 1 : 0);
    eventosAtrasados.sort((a, b) => b.diasAtraso - a.diasAtraso);

    json(res, 200, {
      geradoEm,
      processosAtivos: ativos.length,
      eventosProximos,
      eventosAtrasados,
      pendenciasFinanceiras30d: {
        aReceber: Math.round(aReceber * 100) / 100,
        aPagar:   Math.round(aPagar   * 100) / 100,
      },
    });
    return;
  }

  // ── POST /api/ia/chat ──────────────────────────────────────────────────────
  // Body: { fluxo: "qualificacao"|"proposta", mensagens: [{role, content}, ...] }
  // A API Anthropic é stateless: o frontend envia o histórico completo a cada turno.
  if (req.method === 'POST' && url === '/api/ia/chat') {
    readBody(req).then(async body => {
      const fluxo     = body && body.fluxo;
      const mensagens = body && body.mensagens;

      if (fluxo !== 'qualificacao' && fluxo !== 'proposta')
        return json(res, 400, { erro: 'fluxo inválido (use "qualificacao" ou "proposta")' });
      if (!Array.isArray(mensagens) || mensagens.length === 0)
        return json(res, 400, { erro: 'mensagens deve ser um array não vazio' });
      for (const m of mensagens) {
        if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string')
          return json(res, 400, { erro: 'cada mensagem precisa de role (user|assistant) e content string' });
      }
      if (mensagens[0].role !== 'user')
        return json(res, 400, { erro: 'a primeira mensagem deve ser do usuário' });

      if (iaRateLimited())
        return json(res, 429, { erro: 'Limite de requisições atingido (20/min). Aguarde um instante.' });

      const systemPrompt = lerPromptFluxo(fluxo);
      if (!systemPrompt)
        return json(res, 500, { erro: 'System prompt não encontrado para o fluxo "' + fluxo + '"' });

      let resposta;
      try {
        resposta = await chamarAnthropic(systemPrompt, mensagens);
      } catch (e) {
        if (e.code === 'NO_KEY')
          return json(res, 503, { erro: 'IA indisponível: ANTHROPIC_API_KEY não configurada no servidor.' });
        if (e.status === 429)
          return json(res, 429, { erro: 'A API da Anthropic limitou as requisições. Tente em instantes.' });
        return json(res, 502, { erro: 'Falha ao falar com a IA: ' + e.message });
      }

      logIA(fluxo, resposta.usage);

      const texto = (resposta.content || [])
        .filter(b => b && b.type === 'text')
        .map(b => b.text).join('\n').trim();

      // Guardrail determinístico — só no fluxo proposta (documento vai ao cliente final)
      if (fluxo === 'proposta') {
        const termo = verificarGuardrail(texto);
        if (termo)
          return json(res, 200, {
            bloqueado: true,
            aviso: `Rascunho bloqueado: possível dado interno detectado (termo: ${termo}). Revise a entrada.`,
          });
      }

      json(res, 200, { texto });
    }).catch(() => json(res, 400, { erro: 'Body JSON inválido' }));
    return;
  }

  // ── Arquivos estáticos ─────────────────────────────────────────────────────
  let filePath = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403); res.end(); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') { res.writeHead(404); res.end('Not found'); }
      else { res.writeHead(500); res.end('Server error'); }
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    cors(res);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () =>
  console.log(`PILAR → http://localhost:${PORT}`)
);
