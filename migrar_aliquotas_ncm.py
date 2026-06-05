#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Corrige alíquotas zeradas em dados.json (itens com aliquotas.ii == 0).

Fonte das alíquotas corretas: produtos_com_aliquotas.json.
Esse arquivo NÃO tem 'codigo' (logo não dá para indexar por prefixo), mas tem
'ncm'. Como cada NCM mapeia para um conjunto consistente de alíquotas, o índice
é montado por NCM e cada item zerado é corrigido pelo seu próprio item['ncm'].

Faz backup de dados.json antes de gravar e imprime quantos itens foram corrigidos.
"""
import json, collections, shutil, datetime, os

BASE  = os.path.dirname(os.path.abspath(__file__))
PRODS = os.path.join(BASE, 'produtos_com_aliquotas.json')
DADOS = os.path.join(BASE, 'dados.json')

ALIQ_KEYS = ['ii', 'ipi', 'pis_importacao', 'cofins_importacao', 'pis_venda',
             'cofins_venda', 'icms_intra', 'icms_inter', 'reg_espec_intra', 'reg_espec_inter']
DEFAULTS = {'ii': 0, 'ipi': 0, 'pis_importacao': 0.021, 'cofins_importacao': 0.1065,
            'pis_venda': 0.0165, 'cofins_venda': 0.076, 'icms_intra': 0.14,
            'icms_inter': 0.04, 'reg_espec_intra': 0.14, 'reg_espec_inter': 0.015}

prods = json.load(open(PRODS, encoding='utf-8'))

# Índice por NCM → alíquotas (produto com o ii mais comum daquele NCM)
ncm_prod = collections.defaultdict(list)
for p in prods:
    ncm = str(p.get('ncm') or '').strip()
    if ncm and p.get('ii'):
        ncm_prod[ncm].append(p)

by_ncm = {}
for ncm, lst in ncm_prod.items():
    cnt = collections.Counter(round(x['ii'], 6) for x in lst)
    ii_comum = cnt.most_common(1)[0][0]
    ref = next(x for x in lst if round(x['ii'], 6) == ii_comum)
    by_ncm[ncm] = {k: (ref.get(k) if ref.get(k) is not None else DEFAULTS[k]) for k in ALIQ_KEYS}

print(f'Índice por NCM: {len(by_ncm)} NCMs com alíquota')

d = json.load(open(DADOS, encoding='utf-8'))
corrigidos = 0
sem_match = 0
detalhe = collections.Counter()
for p in d.get('pilar_processos') or []:
    for it in (p.get('itens') or []):
        al = it.get('aliquotas')
        if not al or not al.get('ii'):
            ncm = str(it.get('ncm') or '').strip()
            ref = by_ncm.get(ncm)
            if ref:
                it['aliquotas'] = dict(ref)
                corrigidos += 1
                detalhe[(p.get('numero'), ncm, ref['ii'])] += 1
            else:
                sem_match += 1

ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
shutil.copy(DADOS, DADOS + '.bak_' + ts)
json.dump(d, open(DADOS, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

print(f'Itens corrigidos: {corrigidos} | sem match por NCM: {sem_match}')
for (num, ncm, ii), n in sorted(detalhe.items()):
    print(f'  {num} | NCM {ncm} -> ii {ii} : {n} itens')
print(f'Backup salvo: dados.json.bak_{ts}')
