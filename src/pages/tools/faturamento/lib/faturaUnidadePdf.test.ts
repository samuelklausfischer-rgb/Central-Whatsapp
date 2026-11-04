// PDFs de Unaí (rotina × urgência) e Abdon Batista (lista + demonstrativo) — pedido da Ketlin em 04/11/2026.
// Rodar: bun test src/pages/tools/faturamento   (o projeto não tem runner de teste; o bun lê o TS direto)
// Com FAT_EXEMPLO=<pasta> grava os PDFs de exemplo (dados fictícios) nessa pasta, para conferir o visual.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import {
  caminhoPdf, dataDoDemonstrativo, dividirPorPrioridade, examesBatemComResumo, lerRegraPdf, linhasDemonstrativo,
  pdfsDaUnidade, pdfsDoRelatorio, PDF_PADRAO, textoPeriodo,
} from './faturaUnidadePdf'
import { caminhoRelatorio, juntarResumo, URGENCIA_PADRAO, type Relatorio, type ResumoLinhaRel } from './relatorioUnidade'
import type { ExameLinha } from './excel'

const exame = (nome: string, estudo: string, modalidade: string, prioridade: string, valor: number, i: number): ExameLinha => ({
  nome_bruto: nome, nome_paciente: `Paciente Ficticio ${i}`, estudo_descricao: estudo, modalidade, prioridade,
  medico: 'MEDICO FICTICIO', quantidade: 1, valor_unitario: valor, valor_total: valor,
  data_exame: `${String(1 + (i % 28)).padStart(2, '0')}/10/2026 10:00`, data_conclusao: `${String(1 + (i % 28)).padStart(2, '0')}/10/2026 12:00`,
})
const rel = (pasta: string, nomes: string[]): Relatorio =>
  ({ grupo: 'Medimagem', rotuloGrupo: 'Medimagem', pasta, empresa: 'MEDIMAGEM', subunidade: null, periodo: '', nomes, grupos: ['Medimagem'] })

// Unaí: rotina R$ 20,00, urgência e emergência R$ 33,98, PACS R$ 2.514,07 (cadastro)
const unai: ExameLinha[] = [
  ...Array.from({ length: 30 }, (_, i) => exame('MEDIMAGEM UNAI', 'CRANIO S/C', 'CT', 'ROTINA', 20, i)),
  ...Array.from({ length: 50 }, (_, i) => exame('MEDIMAGEM UNAI', 'TORAX S/C', 'CT', 'URGENCIA', 33.98, i)),
  ...Array.from({ length: 5 }, (_, i) => exame('MEDIMAGEM UNAÍ APICE TELE', 'ABDOME TOTAL', 'CT', 'Emergência', 33.98, i)),
]
const resumoUnai = juntarResumo([
  { rotulo: 'CT', quantidade: 80, valor_unitario: null, total: 600 + 50 * 33.98, fixo: false },
  { rotulo: 'CT', quantidade: 5, valor_unitario: 33.98, total: 5 * 33.98, fixo: false },
  { rotulo: 'PACS - mensalidade', quantidade: 1, valor_unitario: 2514.07, total: 2514.07, fixo: true },
])
// Abdon Batista set/2026 (Word da equipe): 105 RX a 7,00 + RT 1.600 + PACS 500 = R$ 2.835,00
const abdon: ExameLinha[] = Array.from({ length: 105 }, (_, i) => exame('MEDIMAGEM ABDON BATISTA - SC', 'TORAX', 'RX', i % 3 ? 'ROTINA' : 'URGENCIA', 7, i))
const resumoAbdon: ResumoLinhaRel[] = [
  { rotulo: 'RX', quantidade: 105, valor_unitario: 7, total: 735, fixo: false },
  { rotulo: 'Responsabilidade técnica radiologista - mensal', quantidade: 1, valor_unitario: 1600, total: 1600, fixo: true },
  { rotulo: 'Sistema de gerenciamento de imagem PACS - mensal', quantidade: 1, valor_unitario: 500, total: 500, fixo: true },
]
const ehPdf = (b: Uint8Array) => new TextDecoder().decode(b.slice(0, 5)) === '%PDF-'

describe('regra dos PDFs (config)', () => {
  it('sem chave na config: Unaí por prioridade e Abdon com demonstrativo', () => {
    assert.deepEqual(lerRegraPdf({}), PDF_PADRAO)
    assert.deepEqual(pdfsDaUnidade({ pasta: 'UNAI' }, lerRegraPdf({})), ['rotina', 'urgencia'])
    assert.deepEqual(pdfsDaUnidade({ pasta: 'Abdon Batista - SC' }, lerRegraPdf({})), ['lista', 'demonstrativo'])
    for (const pasta of ['SANTAREM - PA', 'FAEPU - MG', null]) assert.deepEqual(pdfsDaUnidade({ pasta }, lerRegraPdf({})), [], String(pasta))
  })
  it('a chave da config troca a lista; vazia desliga', () => {
    const r = lerRegraPdf({ pdf_prioridade_pastas: ' Unaí , OUTRA - UF ', pdf_demonstrativo_pastas: '', pdf_demonstrativo_cidade: 'Balneário Camboriú' })
    assert.deepEqual(r.prioridade, ['Unaí', 'OUTRA - UF'])
    assert.deepEqual(pdfsDaUnidade({ pasta: 'ABDON BATISTA - SC' }, r), [])
    assert.deepEqual(pdfsDaUnidade({ pasta: 'OUTRA - UF' }, r), ['rotina', 'urgencia'])
    assert.equal(r.cidade, 'Balneário Camboriú')
  })
})

describe('contas', () => {
  it('Unaí: rotina e urgência (urgência = prioridades_urgencia, sem acento e sem caixa)', () => {
    const { rotina, urgencia } = dividirPorPrioridade(unai, URGENCIA_PADRAO)
    assert.equal(rotina.length, 30); assert.equal(urgencia.length, 55)
    assert.ok(rotina.every(e => e.valor_unitario === 20)); assert.ok(urgencia.every(e => e.valor_unitario === 33.98))
    assert.ok(examesBatemComResumo(unai, resumoUnai))
    assert.equal(examesBatemComResumo(unai.slice(1), resumoUnai), false)
  })
  it('Abdon: demonstrativo igual ao Word de set/2026', () => {
    const l = linhasDemonstrativo(resumoAbdon)
    assert.deepEqual(l.map(x => [x.quantidade, x.exame, x.valor_unitario, x.total]), [
      [105, 'RAIO-X', 7, 735],
      [1, 'RESPONSABILIDADE TÉCNICA RADIOLOGISTA', 1600, 1600],
      [1, 'SISTEMA DE GERENCIAMENTO DE IMAGEM PACS', 500, 500],
    ])
    assert.equal(l[0].item, 'EMISSÃO DE LAUDOS DOS EXAMES DE RAIO-X')
    assert.equal(l.reduce((s, x) => s + x.total, 0), 2835)
  })
  it('datas: demonstrativo no dia 1º do mês seguinte; período do mês inteiro', () => {
    assert.equal(dataDoDemonstrativo('2026-09'), '01/10/2026')
    assert.equal(dataDoDemonstrativo('2026-12'), '01/01/2027')
    assert.equal(textoPeriodo('2026-10', ''), '01/10/2026 a 31/10/2026')
    assert.equal(textoPeriodo('2026-02', '1ª QUINZENA'), '01/02/2026 a 28/02/2026 · 1ª QUINZENA')
  })
  it('caminho do PDF segue o do Excel', () => {
    const c = caminhoRelatorio(rel('UNAI', ['MEDIMAGEM UNAI']), '2026-10')
    assert.equal(c, 'Medimagem/UNAI 10.2026.xlsx')
    assert.equal(caminhoPdf(c, 'ROTINA'), 'Medimagem/UNAI 10.2026 ROTINA.pdf')
    assert.equal(caminhoPdf(c, ''), 'Medimagem/UNAI 10.2026.pdf')
  })
})

describe('pdfsDoRelatorio', () => {
  const regra = lerRegraPdf({})
  it('Unaí: dois PDFs (rotina e urgência)', async () => {
    const { pdfs: r, avisos } = await pdfsDoRelatorio(rel('UNAI', ['MEDIMAGEM UNAI', 'MEDIMAGEM UNAÍ APICE TELE']), '2026-10', resumoUnai, unai, regra, URGENCIA_PADRAO)
    assert.deepEqual(r.map(p => p.sufixo), ['ROTINA', 'URGENCIA'])
    assert.deepEqual(avisos, [])
    assert.ok(r.every(p => ehPdf(p.bytes)))
    if (process.env.FAT_EXEMPLO) for (const p of r) writeFileSync(`${process.env.FAT_EXEMPLO}/UNAI 10.2026 ${p.sufixo}.pdf`, p.bytes)
  })
  it('Abdon: lista e demonstrativo', async () => {
    const { pdfs: r } = await pdfsDoRelatorio(rel('ABDON BATISTA - SC', ['MEDIMAGEM ABDON BATISTA - SC']), '2026-10', resumoAbdon, abdon, regra, URGENCIA_PADRAO)
    assert.deepEqual(r.map(p => p.tipo), ['lista', 'demonstrativo'])
    assert.ok(r.every(p => ehPdf(p.bytes)))
    if (process.env.FAT_EXEMPLO) for (const p of r) writeFileSync(`${process.env.FAT_EXEMPLO}/ABDON BATISTA - SC 10.2026${p.sufixo ? ' ' + p.sufixo : ''}.pdf`, p.bytes)
  })
  it('outras unidades: nada; exames que não batem: sem lista, com aviso (o demonstrativo sai assim mesmo)', async () => {
    assert.deepEqual(await pdfsDoRelatorio(rel('SANTAREM - PA', ['SANTAREM - PA']), '2026-10', resumoUnai, unai, regra, URGENCIA_PADRAO), { pdfs: [], avisos: [] })
    const u = await pdfsDoRelatorio(rel('UNAI', ['MEDIMAGEM UNAI']), '2026-10', resumoUnai, unai.slice(2), regra, URGENCIA_PADRAO)
    assert.deepEqual(u.pdfs, []); assert.equal(u.avisos.length, 1); assert.match(u.avisos[0], /^UNAI: /)
    const a = await pdfsDoRelatorio(rel('ABDON BATISTA - SC', ['MEDIMAGEM ABDON BATISTA - SC']), '2026-10', resumoAbdon, abdon.slice(1), regra, URGENCIA_PADRAO)
    assert.deepEqual(a.pdfs.map(p => p.tipo), ['demonstrativo']); assert.equal(a.avisos.length, 1)
  })
  it('unidade só com rotina: só o PDF de rotina', async () => {
    const soRotina = unai.slice(0, 30)
    const resumo: ResumoLinhaRel[] = [{ rotulo: 'CT', quantidade: 30, valor_unitario: 20, total: 600, fixo: false }]
    const { pdfs: r } = await pdfsDoRelatorio(rel('UNAI', ['MEDIMAGEM UNAI']), '2026-10', resumo, soRotina, regra, URGENCIA_PADRAO)
    assert.deepEqual(r.map(p => p.sufixo), ['ROTINA'])
  })
  it('Unaí sem exame nenhum: sai o de rotina, vazio, levando o resumo com o PACS', async () => {
    const resumo: ResumoLinhaRel[] = [{ rotulo: 'PACS - mensalidade', quantidade: 1, valor_unitario: 2514.07, total: 2514.07, fixo: true }]
    const { pdfs: r } = await pdfsDoRelatorio(rel('UNAI', ['MEDIMAGEM UNAI']), '2026-10', resumo, [], regra, URGENCIA_PADRAO)
    assert.deepEqual(r.map(p => p.sufixo), ['ROTINA'])
  })
  it('demonstrativo: DX e CR juntos numa linha RAIO-X; nome com quebra de linha não cola', async () => {
    const l = linhasDemonstrativo([
      { rotulo: 'DX', quantidade: 70, valor_unitario: 7, total: 490, fixo: false },
      { rotulo: 'CR', quantidade: 6, valor_unitario: 7, total: 42, fixo: false },
      ...resumoAbdon.filter(x => x.fixo),
    ])
    assert.deepEqual(l.map(x => [x.quantidade, x.exame, x.valor_unitario, x.total]).slice(0, 1), [[76, 'RAIO-X', 7, 532]])
    assert.equal(l.length, 3)
    const { pdfs } = await pdfsDoRelatorio({ ...rel('ABDON BATISTA - SC', ['MEDIMAGEM ABDON BATISTA - SC', 'MEDIMAGEM ABDON BATISTA - SC APICE TELE COM UM NOME BEM COMPRIDO']), subunidade: 'HOSPITAL', periodo: '1ª QUINZENA' },
      '2026-10', resumoAbdon, abdon.map(e => ({ ...e, estudo_descricao: 'TORAX\nPA' })), regra, URGENCIA_PADRAO)
    assert.equal(pdfs.length, 2)
  })
})
