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

// dados.json — lê garantindo a chave pilar_processos; cria o arquivo se não existir
function lerDados() {
  const d = lerJson(DADOS_FILE, null);
  if (!d || typeof d !== 'object') return { pilar_processos: [] };
  if (!Array.isArray(d.pilar_processos)) d.pilar_processos = [];
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
