'use strict';
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static painel files
app.use('/', express.static(path.join(__dirname, '..')));

// API routes
app.use('/api/processos', require('./routes/processos'));
app.use('/api/omie',      require('./routes/omie'));
app.use('/api/ptax',      require('./routes/ptax'));
app.use('/api/xlsx',      require('./routes/xlsx'));
app.use('/api/config',    require('./routes/config'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`PILAR API rodando em http://localhost:${PORT}`);
  console.log(`Painel disponível em http://localhost:${PORT}/index.html`);
});
