#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gerador da Proposta Comercial PILAR.

Lê os dados via stdin (JSON), preenche o modelo proposta_modelo.docx e escreve
o .docx resultante em stdout (binário). Todo diagnóstico vai para stderr.

Entrada (stdin), todos os campos opcionais exceto o que define o conteúdo:
{
  "numero_pil": "PIL-003-2026",
  "cliente": "JUMA",
  "descricao_resumida": "Tecido Microfibra 85gsm estampada 250cm de largura",
  "qtd_total": 120000,
  "unidade": "metros",
  "fob_unit": 0.966,
  "pct_sinal": 20,
  "cambio_sinal": 5.0399,
  "data_sinal": "2026-04-14",        # ISO (yyyy-mm-dd)
  "data_venc_sinal": "2026-04-22",   # ISO
  "dias_antes_desembarque": 20,
  "frete_usd": 2200,
  "prazo_entrega": 60,
  "observacoes": ""
}

Cálculos derivados:
  fob_total       = qtd_total * fob_unit
  valor_sinal_usd = fob_total * pct_sinal/100
  valor_sinal_brl = valor_sinal_usd * cambio_sinal
  pct_saldo       = 100 - pct_sinal
Os campos *_EXTENSO são gerados por extenso em português (sem dependências).
"""
import io
import os
import re
import sys
import json

from docx import Document

MODELO = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      'proposta_modelo.docx')

# ── Número por extenso (PT-BR) ───────────────────────────────────────────────
_UNID = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete',
         'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze',
         'dezesseis', 'dezessete', 'dezoito', 'dezenove']
_DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta',
        'setenta', 'oitenta', 'noventa']
_CENT = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
         'seiscentos', 'setecentos', 'oitocentos', 'novecentos']
_ESCALA_S = ['', 'mil', 'milhão', 'bilhão', 'trilhão']
_ESCALA_P = ['', 'mil', 'milhões', 'bilhões', 'trilhões']


def _ate999(n):
    if n == 0:
        return ''
    if n == 100:
        return 'cem'
    partes = []
    c = n // 100
    resto = n % 100
    if c:
        partes.append(_CENT[c])
    if resto:
        if resto < 20:
            partes.append(_UNID[resto])
        else:
            d, u = resto // 10, resto % 10
            partes.append(_DEZ[d] + (' e ' + _UNID[u] if u else ''))
    return ' e '.join(partes)


def extenso_int(n):
    n = int(round(n))
    if n == 0:
        return 'zero'
    if n < 0:
        return 'menos ' + extenso_int(-n)
    grupos = []
    while n > 0:
        grupos.append(n % 1000)
        n //= 1000
    termos = []
    for i in range(len(grupos) - 1, -1, -1):
        g = grupos[i]
        if g == 0:
            continue
        if i == 0:
            termos.append(_ate999(g))
        elif i == 1:
            termos.append('mil' if g == 1 else _ate999(g) + ' mil')
        else:
            nome = _ESCALA_S[i] if g == 1 else _ESCALA_P[i]
            termos.append(_ate999(g) + ' ' + nome)
    if len(termos) == 1:
        return termos[0]
    # valor do grupo de menor ordem presente define o conector final
    ultimo = next(g for g in grupos if g)
    conector = ' e ' if (ultimo < 100 or ultimo % 100 == 0) else ' '
    return ', '.join(termos[:-1]) + conector + termos[-1]


def _cap(s):
    return s[0].upper() + s[1:] if s else s


def _parte_centavos(valor):
    inteiro = int(valor)
    cent = int(round((valor - inteiro) * 100))
    if cent == 100:
        inteiro += 1
        cent = 0
    return inteiro, cent


def extenso_moeda(valor, sing, plur, csing, cplur):
    valor = round(float(valor) + 1e-9, 2)
    inteiro, cent = _parte_centavos(valor)
    partes = []
    if inteiro:
        partes.append(extenso_int(inteiro) + ' ' + (sing if inteiro == 1 else plur))
    if cent:
        partes.append(extenso_int(cent) + ' ' + (csing if cent == 1 else cplur))
    if not partes:
        partes.append('zero ' + plur)
    return _cap(' e '.join(partes))


def extenso_brl(v):
    return extenso_moeda(v, 'real', 'reais', 'centavo', 'centavos')


def extenso_usd(v):
    return extenso_moeda(v, 'dólar', 'dólares',
                         'centavo de dólar', 'centavos de dólar')


# ── Formatação numérica pt-BR ────────────────────────────────────────────────
def fmt_num(v, dec=2):
    s = ('{:,.%df}' % dec).format(float(v))
    return s.replace(',', '#').replace('.', ',').replace('#', '.')


def fmt_preco(v):
    """Preço unitário: 2 a 4 casas, sem zeros à direita supérfluos (mín. 2)."""
    frac = '{:.4f}'.format(float(v)).split('.')[1].rstrip('0')
    return fmt_num(v, max(2, len(frac)))


_MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
          'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']


def fmt_data_curta(iso):
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', str(iso or ''))
    if not m:
        return str(iso or '')
    y, mo, d = m.groups()
    return '%s/%s/%s' % (d, mo, y)


def fmt_data_longa(iso):
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', str(iso or ''))
    if not m:
        return str(iso or '')
    y, mo, d = m.groups()
    return '%d de %s de %s' % (int(d), _MESES[int(mo)], y)


def num(v, default=0.0):
    try:
        if v is None or v == '':
            return default
        return float(str(v).replace('.', '').replace(',', '.')) \
            if isinstance(v, str) and ',' in str(v) else float(v)
    except Exception:
        return default


def montar_mapa(d):
    cliente = str(d.get('cliente', '') or '')
    numero_pil = str(d.get('numero_pil', '') or '')
    descricao = str(d.get('descricao_resumida', '') or '')
    unidade = str(d.get('unidade', 'metros') or 'metros')
    qtd = num(d.get('qtd_total'), 0)
    fob_unit = num(d.get('fob_unit'), 0)
    pct_sinal = num(d.get('pct_sinal'), 20)
    pct_saldo = 100 - pct_sinal
    cambio = num(d.get('cambio_sinal'), 0)
    dias_antes = num(d.get('dias_antes_desembarque'), 20)
    frete = num(d.get('frete_usd'), 0)
    prazo = num(d.get('prazo_entrega'), 60)
    obs = str(d.get('observacoes', '') or '').strip()

    fob_total = round(qtd * fob_unit, 2)
    valor_sinal_usd = round(fob_total * pct_sinal / 100.0, 2)
    valor_sinal_brl = round(valor_sinal_usd * cambio, 2)

    def pct_txt(p):
        return '%s%% (%s por cento)' % (fmt_num(p, 0).split(',')[0],
                                        extenso_int(p))

    def dias_txt(n):
        return '%s (%s)' % (fmt_num(n, 0).split(',')[0], extenso_int(n))

    qtd_txt = fmt_num(qtd, 0).split(',')[0]

    return {
        '{{CLIENTE}}': cliente,
        '{{NUMERO_PIL}}': numero_pil,
        '{{QTD_TOTAL}}': qtd_txt,
        '{{UNIDADE}}': unidade,
        '{{DESCRICAO_RESUMIDA}}': descricao,
        '{{FOB_UNIT}}': fmt_preco(fob_unit),
        '{{FOB_UNIT_EXTENSO}}': extenso_usd(fob_unit),
        '{{FOB_TOTAL}}': fmt_num(fob_total, 2),
        '{{FOB_TOTAL_EXTENSO}}': extenso_usd(fob_total),
        '{{PCT_SINAL}}': pct_txt(pct_sinal),
        '{{PCT_SALDO}}': pct_txt(pct_saldo),
        '{{VALOR_SINAL_USD}}': fmt_num(valor_sinal_usd, 2),
        '{{VALOR_SINAL_USD_EXTENSO}}': extenso_usd(valor_sinal_usd),
        '{{CAMBIO_SINAL}}': fmt_num(cambio, 4),
        '{{DATA_SINAL}}': fmt_data_curta(d.get('data_sinal')),
        '{{VALOR_SINAL_BRL}}': fmt_num(valor_sinal_brl, 2),
        '{{VALOR_SINAL_BRL_EXTENSO}}': extenso_brl(valor_sinal_brl),
        '{{DATA_VENC_SINAL}}': fmt_data_longa(d.get('data_venc_sinal')),
        '{{DIAS_ANTES_DESEMBARQUE}}': dias_txt(dias_antes),
        '{{FRETE_USD}}': fmt_num(frete, 0).split(',')[0],
        '{{PRAZO_ENTREGA}}': dias_txt(prazo),
        '{{OBSERVACOES}}': obs,
    }


def substituir(doc, mapa):
    for p in list(doc.paragraphs):
        txt = p.text
        if '{{' not in txt:
            continue
        # Parágrafo exclusivo das observações: remove se vazio
        if '{{OBSERVACOES}}' in txt:
            if not mapa['{{OBSERVACOES}}']:
                p._element.getparent().remove(p._element)
                continue
        for run in p.runs:
            if '{{' not in run.text:
                continue
            novo = run.text
            for k, v in mapa.items():
                if k in novo:
                    novo = novo.replace(k, v)
            run.text = novo


def main():
    raw = sys.stdin.read()
    try:
        d = json.loads(raw) if raw.strip() else {}
    except Exception as e:
        sys.stderr.write('JSON inválido em stdin: %s\n' % e)
        sys.exit(1)
    if not isinstance(d, dict):
        d = {}

    if not os.path.isfile(MODELO):
        sys.stderr.write('Modelo não encontrado: %s\n' % MODELO)
        sys.exit(1)

    mapa = montar_mapa(d)
    doc = Document(MODELO)
    substituir(doc, mapa)

    buf = io.BytesIO()
    doc.save(buf)
    sys.stdout.buffer.write(buf.getvalue())


if __name__ == '__main__':
    main()
