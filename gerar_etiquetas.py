#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gerador de etiquetas de rolo PILAR.

Lê o processo via stdin (JSON) e escreve o .xlsx em stdout (binário).

Entrada (stdin), aceita ambos os formatos:
  { "processo": { "numero", "cliente", "itens": [...] }, "logoPath": null }
  ou diretamente:
  { "numero", "cliente", "itens": [{ "codigo", "composicao", "largura_cm", "gsm" }] }

Toda mensagem de diagnóstico vai para stderr — stdout carrega apenas o binário .xlsx.
"""
import sys
import io
import json
import os
import re

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment
from openpyxl.utils import get_column_letter

LOGO_PADRAO = '/opt/pilar-calculadora/logo_pilar.png'
IMPORTADOR  = 'PILAR IMPORTS LTDA'
CNPJ        = '43.954.200/0001-96'
PAIS        = 'CHINA'

THIN   = Side(style='thin', color='000000')
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
FILL   = PatternFill('solid', fgColor='F5F5F5')
ALIGN  = Alignment(vertical='center', wrap_text=True)

FONT_NORMAL = Font(name='Arial', size=9)
FONT_LABEL  = Font(name='Arial', size=9, bold=True)
FONT_TURQ   = Font(name='Arial', size=9, bold=True, color='00B5AD')

# linhas (0-index) cujo VALOR sai em negrito turquesa: ORDEM NRO, CODIGO, CLIENTE
TURQ_ROWS = {0, 1, 5}


def label_rows(proc, item):
    """Retorna as 10 linhas da etiqueta como tuplas de 4 colunas."""
    largura = item.get('largura_cm')
    gsm     = item.get('gsm')
    return [
        ['ORDEM NRO',      str(proc.get('numero', '') or ''),            '',           ''],
        ['CODIGO',         str(item.get('codigo', '') or ''),            '',           ''],
        ['COMPOSIÇÃO',     str(item.get('composicao', '') or ''),        '',           ''],
        ['LARGURA',        f'{largura}CM' if largura not in (None, '') else '', 'GRAMATURA', f'{gsm}GSM' if gsm not in (None, '') else ''],
        ['ROLO',           '',                                           'de',         ''],
        ['CLIENTE',        str(proc.get('cliente', '') or ''),           '',           ''],
        ['PESO LÍQUIDO',   '',                                           'PESO BRUTO', ''],
        ['IMPORTADOR',     IMPORTADOR,                                   '',           ''],
        ['CNPJ',           CNPJ,                                         '',           ''],
        ['PAÍS DE ORIGEM', PAIS,                                         '',           ''],
    ]


def sanitize_sheet_name(name, usados):
    base = re.sub(r'[:\\/?*\[\]]', '-', name)[:31] or 'ITEM'
    nome = base
    c = 1
    while nome in usados:
        c += 1
        nome = (base[:28] + '_' + str(c))
    usados.add(nome)
    return nome


def style_cell(ws, r, c, value, is_label, is_turq=False):
    cell = ws.cell(row=r, column=c, value=value if value != '' else None)
    cell.border = BORDER
    cell.alignment = ALIGN
    if is_label:
        cell.font = FONT_LABEL
        cell.fill = FILL
    elif is_turq:
        cell.font = FONT_TURQ
    else:
        cell.font = FONT_NORMAL
    return cell


def montar_aba(ws, proc, item, logo_img_factory):
    rows = label_rows(proc, item)
    # blocos: (labelCol, valueCol, label2Col, value2Col) — esquerda 1-4, direita 6-9
    blocos = [(1, 2, 3, 4), (6, 7, 8, 9)]
    for ri, row in enumerate(rows):
        excel_row = ri + 1
        ws.row_dimensions[excel_row].height = 13.5  # ~18px
        for (lc, vc, l2, v2) in blocos:
            style_cell(ws, excel_row, lc, row[0], is_label=True)
            style_cell(ws, excel_row, vc, row[1], is_label=False, is_turq=(ri in TURQ_ROWS))
            tem_l2 = row[2] not in (None, '')
            style_cell(ws, excel_row, l2, row[2], is_label=tem_l2)
            style_cell(ws, excel_row, v2, row[3], is_label=False)

    larguras = {1: 15, 2: 20, 3: 15, 4: 12, 5: 2, 6: 15, 7: 20, 8: 15, 9: 12}
    for col, w in larguras.items():
        ws.column_dimensions[get_column_letter(col)].width = w

    # Logo flutuante à direita das etiquetas (não desloca a grade); silencioso se ausente
    img = logo_img_factory()
    if img is not None:
        ws.add_image(img, 'K1')


def main():
    raw = sys.stdin.read()
    try:
        data = json.loads(raw) if raw.strip() else {}
    except Exception as e:
        sys.stderr.write('JSON inválido em stdin: %s\n' % e)
        sys.exit(1)

    proc = data.get('processo', data) if isinstance(data, dict) else {}
    logo_path = (data.get('logoPath') if isinstance(data, dict) else None) or LOGO_PADRAO
    itens = proc.get('itens') or []

    if not itens:
        sys.stderr.write('Processo sem itens.\n')
        sys.exit(1)

    # Fábrica de imagem: cria uma instância nova por aba (openpyxl não reaproveita a mesma).
    def logo_img_factory():
        if not logo_path or not os.path.isfile(logo_path):
            return None
        try:
            from openpyxl.drawing.image import Image as XLImage
            img = XLImage(logo_path)
            # limita altura a ~50px mantendo proporção
            if img.height:
                ratio = 50.0 / float(img.height)
                img.height = 50
                img.width = int(img.width * ratio)
            return img
        except Exception as e:
            sys.stderr.write('Logo ignorado (%s)\n' % e)
            return None

    wb = Workbook()
    wb.remove(wb.active)  # remove a planilha vazia inicial
    usados = set()

    for i, item in enumerate(itens):
        nome = sanitize_sheet_name('%d_%s' % (i + 1, item.get('codigo') or 'ITEM'), usados)
        ws = wb.create_sheet(title=nome)
        montar_aba(ws, proc, item, logo_img_factory)

    buf = io.BytesIO()
    wb.save(buf)
    sys.stdout.buffer.write(buf.getvalue())


if __name__ == '__main__':
    main()
