// Gera o seed do mapa unidade -> departamento do Omie a partir do CSV rascunho.
// Node puro, sem dependências.
//   node scripts/rateio/gerar-seed-mapa.mjs [caminho-do-csv]
// Saídas:
//   supabase/migrations-financeiro/20261007120100_rateio_omie_mapa_seed.sql
//   scripts/rateio/seed-mapa-conflitos.txt   (relatório de duplicatas, conflitos e linhas fora)
// Não aplica nada em banco.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');
export const CSV_PADRAO =
  'C:\\Users\\OPERACIONAL\\Desktop\\Projetos PRN\\PROJETO RATEIO\\.claude\\worktrees\\ajuste-automacao-portal-153c98\\automacao_rateio\\mapa_unidade_departamento_RASCUNHO.csv';
const SAIDA_SQL = resolve(RAIZ, 'supabase/migrations-financeiro/20261007120100_rateio_omie_mapa_seed.sql');
const SAIDA_RELATORIO = resolve(AQUI, 'seed-mapa-conflitos.txt');

export const EMPRESAS = ['PRN', 'PRN_APICE', 'MEDIMAGEM', 'MEDIMAGEM_APICE'];
const RANK = { ALTA: 3, MEDIA: 2, BAIXA: 1 };

// Mesma regra da função chave() do n8n (n8n_calcular_rateio.js): travessões unicode -> '-',
// remove U+FFFD, NFKD, tira acentos, MAIÚSCULAS, espaços colapsados.
export function chave(nome) {
  if (nome === null || nome === undefined) return '';
  let s = String(nome);
  for (const d of ['\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015']) s = s.split(d).join('-');
  s = s.split('\uFFFD').join('');
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return s.toUpperCase().split(/\s+/).filter(Boolean).join(' ');
}

// Lê CSV `;` (UTF-8, com ou sem BOM). Sem aspas no arquivo, mas tolera campos entre aspas.
export function lerCsv(texto) {
  const linhas = texto.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const cab = linhas[0].split(';').map((c) => c.trim());
  return linhas.slice(1).map((l, i) => {
    const cols = l.split(';').map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
    const o = { _linha: i + 2 };
    cab.forEach((c, j) => { o[c] = cols[j] ?? ''; });
    return o;
  });
}

const nMeses = (r) => (r.meses_confirmados || '').split(',').map((x) => x.trim()).filter(Boolean).length;

// Vence quem tem maior confiança; empate: mais meses; empate: a que veio primeiro.
function melhor(a, b) {
  const ra = RANK[a.confianca], rb = RANK[b.confianca];
  if (ra !== rb) return ra > rb ? a : b;
  const ma = nMeses(a), mb = nMeses(b);
  if (ma !== mb) return ma > mb ? a : b;
  return a._linha <= b._linha ? a : b;
}

// rows: linhas do CSV. Devolve { mapa, descartadas, duplicatas, conflitos }.
export function consolidar(rows) {
  const descartadas = []; // { r, motivo }
  const grupos = new Map(); // "empresa|chave" -> linhas
  for (const r of rows) {
    if (!EMPRESAS.includes(r.empresa)) { descartadas.push({ r, motivo: `empresa inválida (${r.empresa})` }); continue; }
    if (!(r.confianca in RANK)) { descartadas.push({ r, motivo: `confiança "${r.confianca}" (não é ALTA/MEDIA/BAIXA)` }); continue; }
    if (!/^\d+$/.test(r.cCodDep || '')) { descartadas.push({ r, motivo: 'sem cCodDep' }); continue; }
    const k = chave(r.unidade);
    if (!k) { descartadas.push({ r, motivo: 'unidade vazia' }); continue; }
    const id = `${r.empresa}|${k}`;
    if (!grupos.has(id)) grupos.set(id, []);
    grupos.get(id).push({ ...r, _chave: k });
  }
  const mapa = [], duplicatas = [], conflitos = [];
  for (const arr of grupos.values()) {
    const escolhida = arr.reduce(melhor);
    mapa.push(escolhida);
    if (arr.length > 1) {
      const deptos = new Set(arr.map((x) => x.cCodDep));
      (deptos.size > 1 ? conflitos : duplicatas).push({ escolhida, grupo: arr });
    }
  }
  mapa.sort((a, b) => EMPRESAS.indexOf(a.empresa) - EMPRESAS.indexOf(b.empresa) || a._chave.localeCompare(b._chave));
  return { mapa, descartadas, duplicatas, conflitos };
}

const q = (s) => (s === null || s === undefined || s === '' ? 'null' : `'${String(s).replace(/'/g, "''")}'`);

export function montarSql(mapa) {
  const valores = mapa.map((r) =>
    `  (${q(r.empresa)}, ${q(r.unidade)}, ${q(r._chave)}, ${r.cCodDep}, ${q(r.departamento)}, ${q(r.confianca)}, 'csv', ${q(r.observacao)})`);
  return [
    '-- =====================================================================================',
    '-- Rateio -> Omie: seed do mapa unidade -> departamento (GERADO por scripts/rateio/gerar-seed-mapa.mjs)',
    '-- Fonte: mapa_unidade_departamento_RASCUNHO.csv. NÃO editar à mão: regenere o arquivo.',
    '-- BANCO: Supabase FINANCEIRO. Rodar depois de 20261007120000_rateio_omie.sql.',
    `-- ${mapa.length} vínculos. Duplicatas já consolidadas (ver scripts/rateio/seed-mapa-conflitos.txt).`,
    "-- Rodar de novo é seguro: só atualiza linhas com origem = 'csv'; vínculos feitos pela tela",
    "-- (origem = 'tela') nunca são sobrescritos.",
    '-- =====================================================================================',
    '',
    'insert into public.rateio_omie_mapa',
    '  (empresa, unidade, unidade_chave, cod_departamento, departamento_nome, confianca, origem, observacao)',
    'values',
    valores.join(',\n'),
    'on conflict (empresa, unidade_chave) do update set',
    '  unidade           = excluded.unidade,',
    '  cod_departamento  = excluded.cod_departamento,',
    '  departamento_nome = excluded.departamento_nome,',
    '  confianca         = excluded.confianca,',
    '  observacao        = excluded.observacao,',
    '  atualizado_em     = now()',
    "where public.rateio_omie_mapa.origem = 'csv';",
    '',
  ].join('\n');
}

export function contar(mapa) {
  const porEmpresa = {}, porConfianca = {};
  for (const r of mapa) {
    porEmpresa[r.empresa] = (porEmpresa[r.empresa] || 0) + 1;
    porConfianca[r.confianca] = (porConfianca[r.confianca] || 0) + 1;
  }
  return { porEmpresa, porConfianca };
}

export function montarRelatorio({ mapa, descartadas, duplicatas, conflitos }) {
  const fmt = (r) => `    linha ${r._linha}: ${r.empresa} | ${r.unidade} -> ${r.cCodDep} (${r.departamento}) ${r.confianca}, ${nMeses(r)} mes(es)`;
  const out = [];
  const { porEmpresa, porConfianca } = contar(mapa);
  out.push('RELATÓRIO DO SEED DO MAPA (gerado por gerar-seed-mapa.mjs)', '');
  out.push(`Vínculos no seed: ${mapa.length}`);
  out.push(`  por empresa:   ${JSON.stringify(porEmpresa)}`);
  out.push(`  por confiança: ${JSON.stringify(porConfianca)}`, '');
  out.push(`== CONFLITOS: mesma empresa e unidade, departamentos DIFERENTES (${conflitos.length}) ==`);
  out.push('Ficou a de maior confiança (empate: mais meses). Um humano deve confirmar.');
  for (const c of conflitos) { out.push(`  ${c.escolhida.empresa} | ${c.escolhida._chave}`); c.grupo.forEach((g) => out.push(fmt(g) + (g === c.escolhida ? '   <= escolhida' : ''))); }
  out.push('', `== DUPLICATAS: mesmo departamento, consolidadas em uma (${duplicatas.length}) ==`);
  for (const c of duplicatas) { out.push(`  ${c.escolhida.empresa} | ${c.escolhida._chave}`); c.grupo.forEach((g) => out.push(fmt(g) + (g === c.escolhida ? '   <= escolhida' : ''))); }
  out.push('', `== FORA DO SEED (${descartadas.length}) ==`);
  for (const d of descartadas) out.push(`  linha ${d.r._linha}: ${d.r.empresa} | ${d.r.unidade} | confiança=${d.r.confianca} | cCodDep=${d.r.cCodDep || '(vazio)'} -> ${d.motivo}`);
  out.push('');
  return out.join('\n');
}

function principal() {
  const caminho = process.argv[2] || CSV_PADRAO;
  const rows = lerCsv(readFileSync(caminho, 'utf8'));
  const res = consolidar(rows);
  writeFileSync(SAIDA_SQL, montarSql(res.mapa), 'utf8');
  writeFileSync(SAIDA_RELATORIO, montarRelatorio(res), 'utf8');
  const { porEmpresa, porConfianca } = contar(res.mapa);
  console.log(`CSV: ${rows.length} linhas | seed: ${res.mapa.length} vínculos`);
  console.log('por empresa  :', porEmpresa);
  console.log('por confiança:', porConfianca);
  console.log(`duplicatas: ${res.duplicatas.length} | conflitos: ${res.conflitos.length} | fora do seed: ${res.descartadas.length}`);
  console.log(`SQL: ${SAIDA_SQL}\nRelatório: ${SAIDA_RELATORIO}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal();
