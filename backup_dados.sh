#!/bin/bash
# Backup dos dados runtime do Painel PILAR (cron: 0 */6 * * *).
#   • backups/          → snapshot a cada 6h, retém 28 (≈7 dias)
#   • backups/diario/   → 1 snapshot por dia (o primeiro do dia), retém 30 (≈30 dias)
# Antes: retinha só 7 (≈36h) — não cobria nem de uma terça à seguinte (incidente out/2026).
BACKUP_DIR="/opt/pilar-calculadora/backups"
DIARIO_DIR="$BACKUP_DIR/diario"
cd /opt/pilar-calculadora
mkdir -p "$BACKUP_DIR" "$DIARIO_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
DIA=$(date +%Y%m%d)
cp dados.json "$BACKUP_DIR/dados_$STAMP.json"
cp produtos_genericos.json "$BACKUP_DIR/produtos_genericos_$STAMP.json" 2>/dev/null
cp catalogo_omie.json "$BACKUP_DIR/catalogo_omie_$STAMP.json" 2>/dev/null
ls -t $BACKUP_DIR/dados_*.json | tail -n +29 | xargs rm -f
ls -t $BACKUP_DIR/produtos_genericos_*.json 2>/dev/null | tail -n +29 | xargs rm -f
ls -t $BACKUP_DIR/catalogo_omie_*.json 2>/dev/null | tail -n +29 | xargs rm -f

# Diário: só se ainda não há snapshot de hoje.
if [ ! -f "$DIARIO_DIR/dados_$DIA.json" ]; then
  cp dados.json "$DIARIO_DIR/dados_$DIA.json"
  cp produtos_genericos.json "$DIARIO_DIR/produtos_genericos_$DIA.json" 2>/dev/null
  cp catalogo_omie.json "$DIARIO_DIR/catalogo_omie_$DIA.json" 2>/dev/null
fi
ls -t $DIARIO_DIR/dados_*.json | tail -n +31 | xargs rm -f
ls -t $DIARIO_DIR/produtos_genericos_*.json 2>/dev/null | tail -n +31 | xargs rm -f
ls -t $DIARIO_DIR/catalogo_omie_*.json 2>/dev/null | tail -n +31 | xargs rm -f
