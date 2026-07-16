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
import copy
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


def _set_run_text(r, text):
    for t in r.findall(qn('w:t')):
        r.remove(t)
    t = OxmlElement('w:t'); t.set(qn('xml:space'), 'preserve'); t.text = text
    r.append(t)


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

    # F) variante (ii) A PRAZO — duplica o (ii) à vista com texto de parcelas.
    #    O gerador remove a variante que não se aplica (à vista x a prazo).
    if achar(doc, '{{N_PARCELAS}}') is None:
        pav = None
        for p in paras(doc):
            if '(ii) Saldo' in p.text and '{{DIAS_ANTES_DESEMBARQUE}}' in p.text:
                pav = p
                break
        if pav is not None:
            novo = copy.deepcopy(pav._p)
            runs = novo.findall(qn('w:r'))
            # run[0] (negrito) mantém "(ii) Saldo de {{PCT_SALDO}}";
            # run[1] recebe o texto a prazo; runs extras são descartados.
            _set_run_text(runs[1],
                          ': em {{N_PARCELAS}} parcelas {{PERIODICIDADE}} e iguais de '
                          'USD {{VALOR_PARCELA_USD}} ({{VALOR_PARCELA_EXTENSO}}), vencendo a '
                          'primeira em {{DATA_1A_PARCELA}} e as demais a cada período '
                          'subsequente;')
            for r in runs[2:]:
                novo.remove(r)
            pav._p.addnext(novo)
            print('OK variante (ii) a prazo adicionada')

    # G) SEM SINAL — item único "(i) Pagamento integral" (à vista e a prazo).
    #    Clona o (ii) Saldo à vista (label negrito + corpo) e insere após o (ii)
    #    a prazo, para o gerador escolher a variante conforme sinal/modalidade.
    if achar(doc, 'Pagamento integral') is None:
        base = None
        for p in paras(doc):
            if '(ii) Saldo' in p.text and '{{DIAS_ANTES_DESEMBARQUE}}' in p.text:
                base = p
                break
        anchor = None  # último parágrafo de "(ii) Saldo" (o a prazo)
        for p in paras(doc):
            if '(ii) Saldo' in p.text:
                anchor = p
        if base is not None and anchor is not None:
            integral_avista = (
                ': o valor total da mercadoria deverá ser pago e quitado em até no '
                'máximo {{DIAS_ANTES_DESEMBARQUE}} dias antes do desembarque do navio '
                'em território nacional, o que será devidamente comunicado pela Pilar '
                'Imports por e-mail e WhatsApp;')
            integral_aprazo = (
                ': em {{N_PARCELAS}} parcelas {{PERIODICIDADE}} e iguais de {{PCT_PARCELA}} '
                'do valor total apurado na data do faturamento (valor estimado nesta '
                'data: USD {{VALOR_PARCELA_USD}} cada), vencendo a primeira '
                '{{DIAS_1A_PARCELA}} dias a partir do faturamento e as demais a cada '
                'período subsequente;')
            anchor_el = anchor._p
            for corpo in (integral_avista, integral_aprazo):
                novo = copy.deepcopy(base._p)
                runs = novo.findall(qn('w:r'))
                _set_run_text(runs[0], '(i) Pagamento integral')
                _set_run_text(runs[1], corpo)
                for r in runs[2:]:
                    novo.remove(r)
                anchor_el.addnext(novo)
                anchor_el = novo
            print('OK itens "(i) Pagamento integral" (à vista + a prazo) adicionados')

    # H) bullet PERDA DO SINAL — 2 variantes (com sinal, à vista/a prazo); corrige
    #    "no presente e-mail"->"nesta proposta" e "à título"->"a título".
    old = achar(doc, 'no presente e-mail')
    if old is not None:
        perda_avista = ('Caso o Saldo de {{PCT_SALDO}} não seja pago na data estipulada '
                        'nesta proposta, vocês perderão o valor pago a título de sinal.')
        perda_aprazo = ('Caso qualquer parcela do saldo não seja paga na data de seu '
                        'vencimento, vocês perderão o valor pago a título de sinal.')
        for txt in (perda_avista, perda_aprazo):
            novo = copy.deepcopy(old._p)
            runs = novo.findall(qn('w:r'))
            _set_run_text(runs[0], txt)
            for r in runs[1:]:
                novo.remove(r)
            old._p.addprevious(novo)
        remover(old)
        print('OK bullet perda do sinal -> 2 variantes')

    # I) bullet FECHAMENTO DO CÂMBIO — 4 variantes (com_sinal x modalidade);
    #    corrige "será considerada"->"será considerado".
    old = achar(doc, 'será considerada o valor')
    if old is not None:
        variantes = [
            'Para fechamento do câmbio, será considerado o valor fechado na data do '
            'sinal e o valor fechado na data do pagamento do saldo.',
            'Para fechamento do câmbio, será considerado o valor fechado na data do '
            'sinal e os valores fechados nas datas de pagamento de cada parcela do saldo.',
            'Para fechamento do câmbio, será considerado o valor fechado na data do '
            'pagamento.',
            'Para fechamento do câmbio, serão considerados os valores fechados nas '
            'datas de pagamento de cada parcela.',
        ]
        for txt in variantes:
            novo = copy.deepcopy(old._p)
            runs = novo.findall(qn('w:r'))
            _set_run_text(runs[0], txt)
            for r in runs[1:]:
                novo.remove(r)
            old._p.addprevious(novo)
        remover(old)
        print('OK bullet fechamento do câmbio -> 4 variantes')

    doc.save(SAIDA)
    print('salvo:', SAIDA)


if __name__ == '__main__':
    main()
