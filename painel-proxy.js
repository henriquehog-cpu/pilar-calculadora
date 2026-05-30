'use strict';
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT        = 3001;
const CONFIG_FILE = path.join(__dirname, 'pilar-config.json');
const OMIE_HOST   = 'app.omie.com.br';
const OMIE_PATH   = '/api/v1/geral/produtos/';

function lerConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/omie') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch { return json(res, 400, { erro: 'Body JSON inválido' }); }

      const cfg = lerConfig();
      if (!cfg.omie_app_key || !cfg.omie_app_secret) {
        return json(res, 500, { erro: 'Credenciais não configuradas em pilar-config.json' });
      }

      const payload = JSON.stringify({
        call:       parsed.call,
        app_key:    cfg.omie_app_key,
        app_secret: cfg.omie_app_secret,
        param:      parsed.params
      });

      const options = {
        hostname: OMIE_HOST,
        path:     OMIE_PATH,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };

      const omieReq = https.request(options, omieRes => {
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
    });
    return;
  }

  json(res, 404, { erro: 'Rota não encontrada' });
});

server.listen(PORT, () =>
  console.log(`Proxy Omie → http://localhost:${PORT}/omie`)
);
