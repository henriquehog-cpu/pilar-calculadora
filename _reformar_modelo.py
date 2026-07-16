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
                          'primeira {{DIAS_1A_PARCELA}} dias a partir do faturamento e as '
                          'demais a cada período subsequente;')
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

    # J) 1ª parcela em DIAS a partir do faturamento (unifica com/sem sinal e
    #    remove a data absoluta {{DATA_1A_PARCELA}} do (ii) Saldo a prazo).
    for p in paras(doc):
        if '{{DATA_1A_PARCELA}}' in p.text:
            for r in p._p.findall(qn('w:r')):
                for t in r.findall(qn('w:t')):
                    if t.text and '{{DATA_1A_PARCELA}}' in t.text:
                        t.text = t.text.replace(
                            'vencendo a primeira em {{DATA_1A_PARCELA}}',
                            'vencendo a primeira {{DIAS_1A_PARCELA}} dias a partir do faturamento')
            print('OK (ii) a prazo com sinal -> dias a partir do faturamento')

    # K) {{GRUPOS}}: remover a cor (404040) da marca de parágrafo — texto preto
    #    padrão. Os runs gerados (gerar_proposta._mk_run) já não recebem cor.
    p = achar(doc, '{{GRUPOS}}')
    if p is not None:
        ppr = p._p.find(qn('w:pPr'))
        rpr = ppr.find(qn('w:rPr')) if ppr is not None else None
        if rpr is not None:
            c = rpr.find(qn('w:color'))
            if c is not None:
                rpr.remove(c)
                print('OK {{GRUPOS}} cor removida')

    # L) "Valor de referência…": trocar pStyle SemEspaamento -> PargrafodaLista
    #    (entrelinha 360) + ind 720/0, e limpar b/bCs/color/highlight da marca e
    #    dos runs (texto sem negrito, sem realce, sem cor).
    p = achar(doc, 'Valor de referência')
    if p is not None:
        ppr = p._p.find(qn('w:pPr'))
        if ppr is not None:
            pstyle = ppr.find(qn('w:pStyle'))
            if pstyle is not None:
                pstyle.set(qn('w:val'), 'PargrafodaLista')
            if ppr.find(qn('w:spacing')) is None:
                sp = OxmlElement('w:spacing')
                sp.set(qn('w:after'), '0'); sp.set(qn('w:line'), '360')
                sp.set(qn('w:lineRule'), 'auto')
                (pstyle.addnext(sp) if pstyle is not None else ppr.insert(0, sp))
            ind = ppr.find(qn('w:ind'))
            if ind is None:
                ind = OxmlElement('w:ind'); ppr.append(ind)
            ind.set(qn('w:left'), '720'); ind.set(qn('w:firstLine'), '0')
            rpr = ppr.find(qn('w:rPr'))
            if rpr is not None:
                for tag in ('w:b', 'w:bCs', 'w:color', 'w:highlight'):
                    e = rpr.find(qn(tag))
                    if e is not None:
                        rpr.remove(e)
        for r in p._p.findall(qn('w:r')):
            rr = r.find(qn('w:rPr'))
            if rr is not None:
                for tag in ('w:b', 'w:bCs', 'w:color', 'w:highlight'):
                    e = rr.find(qn(tag))
                    if e is not None:
                        rr.remove(e)
        print('OK "Valor de referência" -> pPr alvo, sem negrito/realce/cor')

    # M) sectPr: cabeçalho (logo) e rodapé institucional em TODAS as páginas —
    #    remove titlePg e aponta um único par default (header1 + footer2).
    def _relid(reltype_suffix, target_contains):
        for rid, rel in doc.part.rels.items():
            if rel.reltype.endswith(reltype_suffix) and target_contains in str(rel.target_ref):
                return rid
        return None
    hdr_id = _relid('/header', 'header1')
    ftr_id = _relid('/footer', 'footer2')
    sect = doc.sections[0]._sectPr
    tp = sect.find(qn('w:titlePg'))
    if tp is not None:
        sect.remove(tp)
    for ref in (sect.findall(qn('w:headerReference')) + sect.findall(qn('w:footerReference'))):
        sect.remove(ref)
    if ftr_id:
        f = OxmlElement('w:footerReference'); f.set(qn('w:type'), 'default'); f.set(qn('r:id'), ftr_id)
        sect.insert(0, f)
    if hdr_id:
        h = OxmlElement('w:headerReference'); h.set(qn('w:type'), 'default'); h.set(qn('r:id'), hdr_id)
        sect.insert(0, h)
    print('OK sectPr -> header1 + footer2 em todas as páginas (sem titlePg)')

    # N) nº de página (campo PAGE) discreto no canto direito do footer2.
    if ftr_id:
        ftr_el = doc.part.rels[ftr_id].target_part._element
        ja_tem = any('PAGE' in (fs.get(qn('w:instr')) or '')
                     for fs in ftr_el.iter(qn('w:fldSimple')))
        if not ja_tem:
            p0 = ftr_el.find(qn('w:p'))
            if p0 is not None:
                ppr = p0.find(qn('w:pPr'))
                if ppr is None:
                    ppr = OxmlElement('w:pPr'); p0.insert(0, ppr)
                if ppr.find(qn('w:jc')) is None:
                    jc = OxmlElement('w:jc'); jc.set(qn('w:val'), 'right')
                    rpr = ppr.find(qn('w:rPr'))
                    (rpr.addprevious(jc) if rpr is not None else ppr.append(jc))
                else:
                    ppr.find(qn('w:jc')).set(qn('w:val'), 'right')
                fld = OxmlElement('w:fldSimple')
                fld.set(qn('w:instr'), r' PAGE   \* MERGEFORMAT ')
                r = OxmlElement('w:r'); rp = OxmlElement('w:rPr')
                rf = OxmlElement('w:rFonts'); rf.set(qn('w:ascii'), 'Arial'); rf.set(qn('w:hAnsi'), 'Arial'); rp.append(rf)
                col = OxmlElement('w:color'); col.set(qn('w:val'), '808080'); rp.append(col)
                sz = OxmlElement('w:sz'); sz.set(qn('w:val'), '14'); rp.append(sz)
                r.append(rp)
                t = OxmlElement('w:t'); t.text = '1'; r.append(t)
                fld.append(r); p0.append(fld)
                print('OK footer2 -> nº de página (campo PAGE) à direita')

    doc.save(SAIDA)
    print('salvo:', SAIDA)


if __name__ == '__main__':
    main()
