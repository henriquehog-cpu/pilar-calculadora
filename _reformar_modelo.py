#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transforma proposta_modelo.docx para a nova estrutura da Proposta Comercial.

Uso: python3 _reformar_modelo.py [entrada.docx] [saida.docx]
(default: proposta_modelo.docx -> proposta_modelo.docx)

Mudancas estruturais (ver tarefa A1/A3/A4):
  - Remove a linha "{{QTD_CONTAINERS}} Container(es) de {{TIPO_CONTAINER}} contendo:"
  - Remove a linha standalone "O valor total estimado ... {{PV_TOTAL_USD}} ..."
    (o total passa a ser emendado no ultimo grupo pelo gerador)
  - {{ITENS}} -> {{GRUPOS}}: tira o marcador de lista (numPr) e recua como os
    blocos vizinhos (ind left=720 firstLine=0)
  - Une os dois paragrafos do Sinal (i) num unico paragrafo continuo
  - Frete: "o container de 40hc" -> "{{MODALIDADE_FRETE}}"
"""
import sys
from docx import Document
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

ENTRADA = sys.argv[1] if len(sys.argv) > 1 else 'proposta_modelo.docx'
SAIDA = sys.argv[2] if len(sys.argv) > 2 else ENTRADA


def paras(doc):
    return list(doc.paragraphs)


def achar(doc, sub):
    for p in paras(doc):
        if sub in p.text:
            return p
    return None


def remover(p):
    p._element.getparent().remove(p._element)


def main():
    doc = Document(ENTRADA)

    # A) remover linha do container
    p = achar(doc, '{{QTD_CONTAINERS}} Container')
    if p is not None:
        remover(p)
        print('OK removido: linha container')

    # C) remover linha standalone do total (No Spacing)
    for p in paras(doc):
        t = p.text.strip()
        if t.startswith('O valor total estimado') and '{{PV_TOTAL_USD}}' in t:
            remover(p)
            print('OK removido: linha total standalone')
            break

    # B) {{ITENS}} -> {{GRUPOS}} sem marcador, recuado
    p = achar(doc, '{{ITENS}}')
    if p is not None:
        ppr = p._p.find(qn('w:pPr'))
        numpr = ppr.find(qn('w:numPr'))
        if numpr is not None:
            ppr.remove(numpr)
        # remove ind existente e recria left=720 firstLine=0
        old = ppr.find(qn('w:ind'))
        if old is not None:
            ppr.remove(old)
        ind = OxmlElement('w:ind')
        ind.set(qn('w:left'), '720')
        ind.set(qn('w:firstLine'), '0')
        # inserir ind logo apos spacing (ou no fim se nao houver)
        spacing = ppr.find(qn('w:spacing'))
        if spacing is not None:
            spacing.addnext(ind)
        else:
            ppr.append(ind)
        for r in p._p.findall(qn('w:r')):
            for t in r.findall(qn('w:t')):
                if t.text and '{{ITENS}}' in t.text:
                    t.text = t.text.replace('{{ITENS}}', '{{GRUPOS}}')
        print('OK {{ITENS}} -> {{GRUPOS}} (sem marcador, ind 720/0)')

    # D) unir os dois paragrafos do Sinal (i)
    p13 = achar(doc, '(i) Sinal de {{PCT_SINAL}}')
    p14 = achar(doc, '{{VALOR_SINAL_BRL}}')
    if p13 is not None and p14 is not None and p13._p is not p14._p:
        # mover todos os runs (w:r) de p14 para o fim de p13
        for r in p14._p.findall(qn('w:r')):
            p13._p.append(r)
        remover(p14)
        print('OK sinal (i) unido em um paragrafo')

    # E) frete: modalidade parametrizada
    p = achar(doc, 'o container de 40hc')
    if p is not None:
        for r in p._p.findall(qn('w:r')):
            for t in r.findall(qn('w:t')):
                if t.text and 'o container de 40hc' in t.text:
                    t.text = t.text.replace('o container de 40hc',
                                            '{{MODALIDADE_FRETE}}')
        print('OK frete -> {{MODALIDADE_FRETE}}')

    doc.save(SAIDA)
    print('salvo:', SAIDA)


if __name__ == '__main__':
    main()
