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
import copy

from docx import Document
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

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


# Normaliza a lista de itens da proposta (preço de venda em USD; nunca FOB/custo).
def itens_norm(d):
    out = []
    for it in (d.get('itens') or []):
        it = it or {}
        prod = str(it.get('produto', '') or '').strip()
        qtd = num(it.get('quantidade'), 0)
        unidade = str(it.get('unidade', '') or '').strip()
        pvu = num(it.get('pv_unit_usd'), 0)
        if not prod and qtd <= 0:
            continue
        out.append({'produto': prod, 'qtd': qtd, 'unidade': unidade,
                    'pv_unit_usd': pvu, 'total_usd': round(qtd * pvu, 2)})
    return out


def singular_un(u):
    u = (u or '').strip()
    return u[:-1] if len(u) > 1 and u.lower().endswith('s') else u


# Linha de item SEM "•": o marcador vem do estilo de lista do parágrafo clonado.
def linha_item(it):
    qtd_txt = fmt_num(it['qtd'], 0).split(',')[0]
    pvu = fmt_preco(it['pv_unit_usd'])
    ext = extenso_usd(it['pv_unit_usd'])
    tot = fmt_num(it['total_usd'], 2)
    un = it['unidade']
    if un:
        return ('%s %s de %s — USD %s por %s (%s), total USD %s'
                % (qtd_txt, un, it['produto'], pvu, singular_un(un), ext, tot))
    return ('%s de %s — USD %s (%s), total USD %s'
            % (qtd_txt, it['produto'], pvu, ext, tot))


def montar_mapa(d, itens):
    cliente = str(d.get('cliente', '') or '')
    numero_pil = str(d.get('numero_pil', '') or '')
    qtd_containers = num(d.get('qtd_containers'), 1)
    tipo_container = str(d.get('tipo_container', '40HC') or '40HC')
    pct_sinal = num(d.get('pct_sinal'), 20)
    pct_saldo = 100 - pct_sinal
    cambio = num(d.get('cambio_sinal'), 0)
    cambio_ref = num(d.get('cambio_ref'), 0)
    dias_antes = num(d.get('dias_antes_desembarque'), 20)
    frete = num(d.get('frete_usd'), 0)
    prazo = num(d.get('prazo_entrega'), 60)
    obs = str(d.get('observacoes', '') or '').strip()

    # Preço de venda em USD (âncora). R$ é apenas referência do dia.
    pv_total_usd = round(sum(i['total_usd'] for i in itens), 2)
    valor_sinal_usd = round(pv_total_usd * pct_sinal / 100.0, 2)
    valor_sinal_brl = round(valor_sinal_usd * cambio, 2)
    pv_total_brl_ref = round(pv_total_usd * cambio_ref, 2)

    def pct_txt(p):
        return '%s%% (%s por cento)' % (fmt_num(p, 0).split(',')[0],
                                        extenso_int(p))

    def dias_txt(n):
        return '%s (%s)' % (fmt_num(n, 0).split(',')[0], extenso_int(n))

    return {
        '{{CLIENTE}}': cliente,
        '{{NUMERO_PIL}}': numero_pil,
        '{{QTD_CONTAINERS}}': fmt_num(qtd_containers, 0).split(',')[0],
        '{{TIPO_CONTAINER}}': tipo_container,
        '{{PV_TOTAL_USD}}': fmt_num(pv_total_usd, 2),
        '{{PV_TOTAL_USD_EXTENSO}}': extenso_usd(pv_total_usd),
        '{{PV_TOTAL_BRL_REF}}': fmt_num(pv_total_brl_ref, 2),
        '{{CAMBIO_REF}}': fmt_num(cambio_ref, 4),
        '{{DATA_REF}}': fmt_data_curta(d.get('data_ref')),
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


# Substitui o texto de um parágrafo (elemento w:p) preservando a formatação do
# 1º run (fonte/tamanho/estilo). Remove realce residual.
def _set_par_text(p_el, text):
    runs = p_el.findall(qn('w:r'))
    for r in runs[1:]:
        p_el.remove(r)
    runs = p_el.findall(qn('w:r'))
    if not runs:
        r0 = OxmlElement('w:r'); p_el.append(r0)
    else:
        r0 = runs[0]
    rpr = r0.find(qn('w:rPr'))
    if rpr is not None:
        h = rpr.find(qn('w:highlight'))
        if h is not None:
            rpr.remove(h)
    for t in r0.findall(qn('w:t')):
        r0.remove(t)
    t = OxmlElement('w:t'); t.set(qn('xml:space'), 'preserve'); t.text = text
    r0.append(t)


# Expande {{ITENS}} clonando o próprio parágrafo-placeholder (que já tem o
# estilo de lista/recuo/fonte do modelo) — uma cópia por item.
def expandir_itens(doc, itens):
    for p in list(doc.paragraphs):
        if '{{ITENS}}' not in p.text:
            continue
        for it in itens:
            novo = copy.deepcopy(p._p)
            _set_par_text(novo, linha_item(it))
            p._p.addprevious(novo)
        p._p.getparent().remove(p._p)
        return


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

    itens = itens_norm(d)
    mapa = montar_mapa(d, itens)
    doc = Document(MODELO)
    expandir_itens(doc, itens)
    substituir(doc, mapa)

    buf = io.BytesIO()
    doc.save(buf)
    sys.stdout.buffer.write(buf.getvalue())


if __name__ == '__main__':
    main()
