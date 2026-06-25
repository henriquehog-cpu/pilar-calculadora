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
const PROD_FILE   = path.join(ROOT, 'produtos.json');            // legado: só fonte da migração
const PROD_GEN_FILE      = path.join(ROOT, 'produtos_genericos.json');      // runtime (gitignorado)
const PROD_GEN_SEED      = path.join(ROOT, 'produtos_genericos.seed.json'); // semente versionada
const CATALOGO_OMIE_FILE = path.join(ROOT, 'catalogo_omie.json');          // runtime (gitignorado)
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
// Escrita atômica: grava num temporário no MESMO diretório e renomeia por cima.
// rename() é atômico no mesmo filesystem — um crash no meio da escrita não deixa
// o arquivo truncado/corrompido (o arquivo antigo permanece intacto até o rename).
function gravarAtomico(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}
function salvarDados(d) { gravarAtomico(DADOS_FILE, d); }
if (!fs.existsSync(DADOS_FILE)) {
  try { fs.writeFileSync(DADOS_FILE, JSON.stringify({ pilar_processos: [] }, null, 2)); }
  catch {}
}

// ── Migração única dos catálogos (idempotente: nunca sobrescreve runtime) ─────
// produtos_genericos.json: a partir do produtos.json atual (332, validados como
// genéricos) marcando origem:"generico"; se ausente, usa a semente versionada.
// catalogo_omie.json: nasce vazio até o primeiro sync Omie.
function migrarCatalogos() {
  try {
    if (!fs.existsSync(PROD_GEN_FILE)) {
      let base = lerJson(PROD_FILE, null);
      if (!Array.isArray(base)) base = lerJson(PROD_GEN_SEED, []);
      const comFlag = (Array.isArray(base) ? base : []).map(p => ({ ...p, origem: 'generico' }));
      gravarAtomico(PROD_GEN_FILE, comFlag);
      console.log('Migração: produtos_genericos.json criado com', comFlag.length, 'itens (origem=generico).');
    }
    if (!fs.existsSync(CATALOGO_OMIE_FILE)) {
      gravarAtomico(CATALOGO_OMIE_FILE, []);
      console.log('Migração: catalogo_omie.json criado vazio.');
    }
  } catch (e) { console.error('Falha na migração de catálogos:', e.message); }
}
migrarCatalogos();

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

// Merge por ID de uma fatia-array do dados.json (pilar_simulacoes / pilar_demandas).
// CORREÇÃO (pós-incidente): antes a rota fazia `dados[chave] = arr`, então uma lista
// PARCIAL apagava as fatias omitidas (apagou 20 de 24 simulações). Agora:
//   • DEFAULT = MERGE POR ID: atualiza itens de mesmo id, adiciona novos e NUNCA
//     remove os que não vieram no payload. Cada item precisa ter `id`.
//   • ?modo=substituir = substituição total EXPLÍCITA (única forma de encolher o
//     array por POST). Deleção pontual continua só pelo DELETE /api/<fatia>/:id.
//   • Escrita ATÔMICA (salvarDados → .tmp + rename). Payload malformado → 400 SEM
//     tocar no arquivo (validação antes de qualquer escrita).
// Validação de código de item de processo — MESMA regra do front (painel.html):
// FAMILIA(4 letras).LARGURA(3díg).GRAMATURA(3díg).SEQ(4díg numéricos). Código
// vazio/ausente é ACEITO (a geração do sufixo é uma fatia separada); só rejeita
// código PRESENTE e mal formado (ex.: nome de cor no lugar do sufixo).
const RE_CODIGO_PRODUTO = /^[A-Z]{4}\.\d{3}\.\d{3}\.\d{4}$/;

// Varre os processos recebidos; retorna mensagem de erro (string) no 1º item com
// código presente e inválido, ou null se tudo ok. Não muta nada.
function validarCodigosProcessos(processos) {
  if (!Array.isArray(processos)) return null;
  for (const proc of processos) {
    if (!proc || typeof proc !== 'object' || !Array.isArray(proc.itens)) continue;
    for (let i = 0; i < proc.itens.length; i++) {
      const item = proc.itens[i];
      if (!item || typeof item !== 'object') continue;
      const cod = item.codigo;
      if (cod == null || cod === '') continue;            // vazio/ausente: aceito nesta fatia
      if (!RE_CODIGO_PRODUTO.test(cod)) {
        const proref = proc.numero || proc.id || '(sem número)';
        return `Código inválido no processo ${proref}, item #${i + 1}: "${cod}". `
             + `O sufixo deve ser sequencial de 4 dígitos numéricos (ex.: 0001), não texto/cor. `
             + `Use o formato FAMÍLIA.LARGURA.GRAMATURA.NNNN (família 4 letras), `
             + `ou deixe o código vazio que o servidor irá gerá-lo.`;
      }
    }
  }
  return null;
}

function mergeFatiaPorId(req, res, chave, label) {
  const substituir = new URLSearchParams(req.url.split('?')[1] || '').get('modo') === 'substituir';
  readBody(req).then(body => {
    const arr = Array.isArray(body) ? body
              : (body && Array.isArray(body[chave]) ? body[chave]
              : (body && typeof body === 'object' && !Array.isArray(body) && body.id != null ? [body] : null));
    if (!arr) return json(res, 400, { erro: `Esperado array de ${label}, {${chave}:[...]} ou uma ${label} única com id` });
    // Validação de código (só processos): rejeita gravação inteira se algum item
    // tiver código presente e mal formado. Antes dos dois modos → cobre merge e substituir.
    if (chave === 'pilar_processos') {
      const erroCod = validarCodigosProcessos(arr);
      if (erroCod) return json(res, 400, { erro: erroCod });
    }
    const dados = lerDados();
    if (substituir) {
      dados[chave] = arr;                       // escape hatch explícito
      salvarDados(dados);
      return json(res, 200, { ok: true, modo: 'substituir', total: arr.length });
    }
    // Merge por id: cada item precisa de id estável.
    for (const item of arr) {
      if (!item || typeof item !== 'object' || item.id == null || item.id === '') {
        return json(res, 400, { erro: `Cada item de ${label} precisa de um id para o merge` });
      }
    }
    const porId = new Map(dados[chave].map(x => [String(x.id), x]));
    let atualizados = 0, adicionados = 0;
    for (const item of arr) {
      const k = String(item.id);
      if (porId.has(k)) atualizados++; else adicionados++;
      porId.set(k, item);                       // atualiza no lugar ou adiciona
    }
    dados[chave] = [...porId.values()];         // nenhum id omitido é removido
    salvarDados(dados);
    json(res, 200, { ok: true, modo: 'merge', total: dados[chave].length, atualizados, adicionados });
  }).catch(() => json(res, 400, { erro: 'JSON inválido' }));
}

// ── IA: helpers ──────────────────────────────────────────────────────────────
// Lê o system prompt do fluxo a partir de prompts/*.md (versionados, sem segredos).
function lerPromptFluxo(fluxo) {
  const arquivo = fluxo === 'qualificacao' ? 'qualificacao.md'
                : fluxo === 'extracao'     ? 'extracao.md'
                : 'proposta.md';
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
  // BLINDADO (Fase 5, item 0) — antes sobrescrevia o dados.json INTEIRO, então
  // quem esquecesse uma chave (pilar_simulacoes, pilar_demandas…) a apagava
  // silenciosamente: a causa-raiz do R1. Agora faz MERGE DEFENSIVO:
  //   • parte do dados.json atual (lerDados) e só substitui as chaves PRESENTES
  //     no payload; chave AUSENTE no payload → a do disco é PRESERVADA;
  //   • grava de forma ATÔMICA (.tmp + rename, via salvarDados);
  //   • VALIDA a estrutura e rejeita payload malformado SEM tocar no arquivo.
  // Assim, mesmo um chamador que esqueça uma chave (ex.: a Astrid, antes de ser
  // reapontada para as rotas de merge) nunca mais apaga as demais fatias.
  if (req.method === 'POST' && url === '/api/dados') {
    readBody(req).then(data => {
      // Estrutura: precisa ser objeto simples (não array, null ou primitivo).
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return json(res, 400, { erro: 'Esperado objeto com as chaves do dados.json' });
      }
      // Tipos das chaves conhecidas, quando presentes (não corromper o store).
      for (const k of ['pilar_processos', 'pilar_demandas', 'pilar_simulacoes']) {
        if (k in data && !Array.isArray(data[k])) {
          return json(res, 400, { erro: `${k} deve ser um array` });
        }
      }
      for (const k of ['pilar_config', 'pilar_descricoes_di']) {
        if (k in data && (typeof data[k] !== 'object' || data[k] === null || Array.isArray(data[k]))) {
          return json(res, 400, { erro: `${k} deve ser um objeto` });
        }
      }
      // Validação de código dos processos (se presentes): rejeita ANTES de escrever.
      if ('pilar_processos' in data) {
        const erroCod = validarCodigosProcessos(data.pilar_processos);
        if (erroCod) return json(res, 400, { erro: erroCod });
      }
      // Merge defensivo: base = disco; só as chaves enviadas sobrescrevem.
      const merged = Object.assign({}, lerDados(), data);
      salvarDados(merged);   // escrita atômica (.tmp + rename)
      json(res, 200, { ok: true });
    }).catch(() => json(res, 400, { erro: 'JSON inválido' }));
    return;
  }

  // ── GET /api/produtos-genericos ────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/produtos-genericos') {
    json(res, 200, lerJson(PROD_GEN_FILE, []));
    return;
  }
  // ── POST /api/produtos-genericos ───────────────────────────────────────────
  // MERGE POR NOME (default): upsert por nome de produto (normalizado), NUNCA
  // remove o que foi omitido. Remoção só pelo DELETE /api/produtos-genericos/:nome.
  // ?modo=substituir = replace total explícito, COM GUARDA: se a operação removeria
  // >=20 produtos e não vier ?confirmar_reducao=true → 409 e arquivo intacto.
  if (req.method === 'POST' && url === '/api/produtos-genericos') {
    const q          = new URLSearchParams(req.url.split('?')[1] || '');
    const substituir = q.get('modo') === 'substituir';
    const confirmarReducao = q.get('confirmar_reducao') === 'true';
    const nomeKey = p => String((p && p.produto) || '').trim().toLowerCase();
    readBody(req).then(data => {
      if (!Array.isArray(data)) return json(res, 400, { erro: 'Esperado array de produtos' });
      const atual = lerJson(PROD_GEN_FILE, []);

      if (substituir) {
        // Replace total explícito — guarda contra encolhimento brusco.
        const novosNomes = new Set(data.map(nomeKey));
        const removeria  = atual.filter(p => !novosNomes.has(nomeKey(p))).length;
        if (removeria >= 20 && !confirmarReducao) {
          return json(res, 409, { erro: `Operação removeria ${removeria} produtos do catálogo. `
            + `Para confirmar a substituição, reenvie com ?confirmar_reducao=true.`, removeria });
        }
        gravarAtomico(PROD_GEN_FILE, data);
        return json(res, 200, { ok: true, modo: 'substituir', total: data.length, removidos: removeria });
      }

      // Merge por nome: cada produto precisa de nome para servir de chave.
      for (const p of data) {
        if (!nomeKey(p)) return json(res, 400, { erro: 'Cada produto precisa do campo "produto" (nome) para o merge' });
      }
      const porNome = new Map(atual.map(p => [nomeKey(p), p]));
      let atualizados = 0, adicionados = 0;
      for (const p of data) {
        const k = nomeKey(p);
        if (porNome.has(k)) atualizados++; else adicionados++;
        porNome.set(k, p);                        // atualiza no lugar ou adiciona
      }
      const merged = [...porNome.values()];        // nenhum nome omitido é removido
      gravarAtomico(PROD_GEN_FILE, merged);
      json(res, 200, { ok: true, modo: 'merge', total: merged.length, atualizados, adicionados });
    }).catch(() => json(res, 400, { erro: 'JSON inválido' }));
    return;
  }
  // ── DELETE /api/produtos-genericos/:nome ──── remoção explícita de 1 produto ──
  // Único caminho que remove produtos. Casa por nome normalizado (trim+lowercase).
  if (req.method === 'DELETE' && url.startsWith('/api/produtos-genericos/')) {
    const nome  = decodeURIComponent(url.slice('/api/produtos-genericos/'.length)).trim().toLowerCase();
    const atual = lerJson(PROD_GEN_FILE, []);
    const antes = atual.length;
    const restante = atual.filter(p => String((p && p.produto) || '').trim().toLowerCase() !== nome);
    gravarAtomico(PROD_GEN_FILE, restante);
    json(res, 200, { ok: true, removidos: antes - restante.length, total: restante.length });
    return;
  }

  // ── GET /api/catalogo-omie ─────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/catalogo-omie') {
    json(res, 200, lerJson(CATALOGO_OMIE_FILE, []));
    return;
  }
  // ── POST /api/catalogo-omie ────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/catalogo-omie') {
    readBody(req).then(data => {
      if (!Array.isArray(data)) return json(res, 400, { erro: 'Esperado array de produtos' });
      gravarAtomico(CATALOGO_OMIE_FILE, data);
      json(res, 200, { ok: true, total: data.length });
    }).catch(() => json(res, 400, { erro: 'JSON inválido' }));
    return;
  }

  // ── GET /api/produtos ──── alias READ-ONLY do catálogo genérico (compat) ────
  if (req.method === 'GET' && url === '/api/produtos') {
    json(res, 200, lerJson(PROD_GEN_FILE, []));
    return;
  }
  // ── POST /api/produtos ──── descontinuado (use as rotas separadas) ──────────
  if (req.method === 'POST' && url === '/api/produtos') {
    return json(res, 410, { erro: 'Rota descontinuada. Use /api/produtos-genericos ou /api/catalogo-omie.' });
  }

  // ── GET /api/processos ─────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/processos') {
    json(res, 200, lerDados().pilar_processos);
    return;
  }

  // ── POST /api/processos ────────────────────────────────────────────────────
  // MERGE POR ID (default): atualiza/adiciona por id, nunca remove o omitido.
  // Uniformiza com simulações/demandas — protege a criação de processos pela
  // Astrid (payload parcial não apaga mais os demais). Mesmo helper, sem duplicar.
  // ?modo=substituir = substituição total explícita. Deleção: DELETE /api/processos/:id.
  if (req.method === 'POST' && url === '/api/processos') {
    mergeFatiaPorId(req, res, 'pilar_processos', 'processos');
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
  // MERGE POR ID (default): atualiza/adiciona por id, nunca remove o omitido.
  // ?modo=substituir = substituição total explícita. Deleção: DELETE /api/demandas/:id.
  if (req.method === 'POST' && url === '/api/demandas') {
    mergeFatiaPorId(req, res, 'pilar_demandas', 'demandas');
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
  // MERGE POR ID (default): atualiza/adiciona por id, nunca remove o omitido.
  // Corrige o overwrite que apagou 20 de 24 simulações ao receber lista parcial.
  // ?modo=substituir = substituição total explícita. Deleção: DELETE /api/simulacoes/:id.
  if (req.method === 'POST' && url === '/api/simulacoes') {
    mergeFatiaPorId(req, res, 'pilar_simulacoes', 'simulações');
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

      if (fluxo !== 'qualificacao' && fluxo !== 'proposta' && fluxo !== 'extracao')
        return json(res, 400, { erro: 'fluxo inválido (use "qualificacao", "proposta" ou "extracao")' });
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
