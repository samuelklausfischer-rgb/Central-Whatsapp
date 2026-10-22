// node --test scripts/rateio/gerar-seed-mapa.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { chave, lerCsv, consolidar, montarSql, contar, CSV_PADRAO } from './gerar-seed-mapa.mjs';

let n = 1;
const linha = (empresa, unidade, cCodDep, confianca, meses = '', departamento = 'DEP') =>
  ({ _linha: n++, empresa, unidade, cCodDep, departamento, confianca, meses_confirmados: meses, observacao: '' });

test('chave(): acento, maiúsculas, espaços e travessões unicode', () => {
  assert.equal(chave('EXÉRCITO – HGEJF'), 'EXERCITO - HGEJF');
  assert.equal(chave('EXÉRCITO - HGEJF'), 'EXERCITO - HGEJF');
  assert.equal(chave('EXÉRCITO  - P M PRAIA VERMELHA'), 'EXERCITO - P M PRAIA VERMELHA');
  assert.equal(chave('  Hospital   Infantil João Paulo II (PRN) — FHEMIG '), 'HOSPITAL INFANTIL JOAO PAULO II (PRN) - FHEMIG');
  assert.equal(chave('ARIQUEMES RONDÔNIA (PRN)'), 'ARIQUEMES RONDONIA (PRN)');
  assert.equal(chave('A‐B‑C‒D–E—F―G'), 'A-B-C-D-E-F-G');
  assert.equal(chave(null), '');
  assert.equal(chave(undefined), '');
});

test('chave(): variações do mesmo nome caem na mesma chave', () => {
  assert.equal(chave('Exército – HGUFL'), chave('EXERCITO - HGUFL'));
});

test('dedupe: mesma empresa e unidade (por chave), mesmo departamento -> fica uma, a de maior confiança', () => {
  const r = consolidar([
    linha('PRN', 'EXÉRCITO – HGES', '111', 'MEDIA', 'jul,ago,set'),
    linha('PRN', 'EXERCITO - HGES', '111', 'ALTA', 'jul'),
  ]);
  assert.equal(r.mapa.length, 1);
  assert.equal(r.mapa[0].confianca, 'ALTA');
  assert.equal(r.duplicatas.length, 1);
  assert.equal(r.conflitos.length, 0);
});

test('dedupe: empate de confiança -> mais meses; empate total -> a primeira', () => {
  const a = consolidar([linha('PRN', 'X', '1', 'ALTA', 'jul'), linha('PRN', 'x', '1', 'ALTA', 'jul,ago')]);
  assert.equal(a.mapa[0].meses_confirmados, 'jul,ago');
  const b = consolidar([linha('PRN', 'X', '1', 'ALTA', 'jul', 'primeira'), linha('PRN', 'x', '1', 'ALTA', 'ago', 'segunda')]);
  assert.equal(b.mapa[0].departamento, 'primeira');
});

test('mesma unidade em empresas diferentes não é duplicata', () => {
  const r = consolidar([linha('PRN', 'SESI MS 1', '1', 'MEDIA'), linha('MEDIMAGEM', 'SESI MS 1', '2', 'ALTA')]);
  assert.equal(r.mapa.length, 2);
  assert.equal(r.duplicatas.length + r.conflitos.length, 0);
});

test('conflito: departamento diferente -> não escolhe no escuro, registra e usa a de maior confiança', () => {
  const r = consolidar([
    linha('PRN_APICE', 'JANDAIA', '1', 'BAIXA', ''),
    linha('PRN_APICE', 'Jandaia', '2', 'MEDIA', 'ago'),
  ]);
  assert.equal(r.mapa.length, 1);
  assert.equal(r.mapa[0].cCodDep, '2');
  assert.equal(r.conflitos.length, 1);
  assert.equal(r.conflitos[0].grupo.length, 2);
  assert.equal(r.duplicatas.length, 0);
});

test('fora do seed: sem cCodDep, confiança fora de ALTA/MEDIA/BAIXA, empresa inválida', () => {
  const r = consolidar([
    linha('PRN', 'A', '', 'SEM_MAPA'),
    linha('PRN', 'B', '', 'ALTA'),
    linha('PRN', '(SEM UNIDADE)', '9', 'SEM_UNIDADE'),
    linha('XYZ', 'C', '1', 'ALTA'),
    linha('PRN', 'D', '1', 'ALTA'),
  ]);
  assert.equal(r.mapa.length, 1);
  assert.equal(r.descartadas.length, 4);
});

test('SQL: aspas escapadas, on conflict por (empresa, unidade_chave), não sobrescreve origem tela', () => {
  const r = consolidar([linha('MEDIMAGEM', "DIAS D'AVILA", '5', 'ALTA', 'jul', "D'Avila")]);
  const sql = montarSql(r.mapa);
  assert.match(sql, /'DIAS D''AVILA'/);
  assert.match(sql, /on conflict \(empresa, unidade_chave\) do update/);
  assert.match(sql, /where public\.rateio_omie_mapa\.origem = 'csv'/);
});

test('lerCsv: BOM, separador ; e colunas do rascunho', () => {
  const rows = lerCsv('﻿empresa;unidade;cCodDep;departamento;confianca;meses_confirmados;observacao\r\nPRN;A (PRN);10;A;ALTA;jul,ago;\r\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].empresa, 'PRN');
  assert.equal(rows[0].cCodDep, '10');
  assert.equal(rows[0].meses_confirmados, 'jul,ago');
});

test('CSV real: contagem por empresa e por confiança', { skip: !existsSync(CSV_PADRAO) }, () => {
  const r = consolidar(lerCsv(readFileSync(CSV_PADRAO, 'utf8')));
  const { porEmpresa, porConfianca } = contar(r.mapa);
  // 2026-10-07: o financeiro confirmou 4 vinculos (+3 gemeos Apice) e 4 linhas sem confirmacao
  // perderam o departamento (MGS Porto Seguro, SESI MS 1, JANDAIA Apice x2) - vinculam na tela.
  // Depois da 2a rodada (mesmo dia): os 20 com duvida foram confirmados e JANDAIA Apice da PRN ->
  // JANDAIA. Pendentes (sem departamento): MGS Porto Seguro, SESI MS 1 e JANDAIA na MedImagem Apice.
  assert.deepEqual(porEmpresa, { PRN: 83, PRN_APICE: 67, MEDIMAGEM: 27, MEDIMAGEM_APICE: 14 });
  assert.deepEqual(porConfianca, { ALTA: 191 });
  assert.equal(r.mapa.length, 191);
  assert.equal(r.descartadas.length, 9);
  assert.equal(r.conflitos.length, 0);
  // chave única por empresa
  const ids = new Set(r.mapa.map((x) => `${x.empresa}|${x._chave}`));
  assert.equal(ids.size, r.mapa.length);
});
