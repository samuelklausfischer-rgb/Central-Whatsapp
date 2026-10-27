// Tabela do fim do relatório da unidade com urgência e rotina separadas (pedido de 27/10/2026).
// Rodar: bun test src/pages/tools/faturamento   (o projeto não tem runner de teste; o bun lê o TS direto)
// Com FAT_EXEMPLO=<pasta> grava um Excel de exemplo (dados fictícios) nessa pasta.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { faturaUnidadeXlsx } from './faturaUnidadeXlsx'
import { juntarResumo, lerPrioridadesUrgencia, separarUrgenciaRotina, URGENCIA_PADRAO, type ResumoLinhaRel } from './relatorioUnidade'
import type { ExameLinha } from './excel'

const exame = (modalidade: string, prioridade: string, valor: number, quantidade = 1, nome = 'SANTAREM - PA'): ExameLinha =>
  ({ nome_bruto: nome, modalidade, prioridade, quantidade, valor_unitario: valor, valor_total: Math.round(valor * quantidade * 100) / 100 })

// Santarém, 14/06–13/07/2026 (4º termo aditivo): 44 CT de rotina a 27,10, 1241 CT de urgência a 30,22, RT 1.602,96
const santarem: ExameLinha[] = [
  ...Array.from({ length: 44 }, () => exame('CT', 'ROTINA', 27.10)),
  ...Array.from({ length: 1000 }, () => exame('CT', 'URGENCIA', 30.22)),
  ...Array.from({ length: 200 }, () => exame('CT', 'Emergência', 30.22)),
  ...Array.from({ length: 41 }, () => exame('ct ', 'PLANTAO', 30.22, 1, 'SANTAREM - PA APICE')),
]
// resumo como o motor grava (simulacao_resumo, um por nome) e o front junta
const resumoMotor = juntarResumo([
  { rotulo: 'CT', quantidade: 1244, valor_unitario: null, total: 1192.40 + 1200 * 30.22, fixo: false },
  { rotulo: 'CT', quantidade: 41, valor_unitario: 30.22, total: 41 * 30.22, fixo: false },
  { rotulo: 'RESPONSÁVEL TÉCNICO', quantidade: 1, valor_unitario: 1602.96, total: 1602.96, fixo: true },
])
const soma = (xs: ResumoLinhaRel[]) => Math.round(xs.reduce((s, x) => s + x.total, 0) * 100) / 100

describe('separarUrgenciaRotina', () => {
  it('Santarém: CT - ROTINA e CT - URGÊNCIA com as quantidades e valores das planilhas, RT e TOTAL iguais', () => {
    const r = separarUrgenciaRotina(resumoMotor, santarem, URGENCIA_PADRAO)
    assert.deepEqual(r.map(l => [l.rotulo, l.quantidade, l.total]), [
      ['CT - ROTINA', 44, 1192.40],
      ['CT - URGÊNCIA', 1241, 37503.02],
      ['RESPONSÁVEL TÉCNICO', 1, 1602.96],
    ])
    assert.equal(soma(r), 40298.38)
    assert.equal(soma(r), soma(resumoMotor))
  })

  it('a soma das linhas separadas é a da modalidade de antes, e os fixos ficam iguais e no fim', () => {
    const exames = [
      exame('CR', 'ROTINA', 12.5), exame('CR', 'URGENCIA', 15), exame('CR', '', 12.5),
      exame('MG', 'ELETIVO', 40, 2), exame('CT', 'URGÊNCIA', 90),
    ]
    const resumo = juntarResumo([
      { rotulo: 'CR', quantidade: 3, valor_unitario: null, total: 40, fixo: false },
      { rotulo: 'CT', quantidade: 1, valor_unitario: 90, total: 90, fixo: false },
      { rotulo: 'MG', quantidade: 2, valor_unitario: 40, total: 80, fixo: false },
      { rotulo: 'LOCAÇÃO', quantidade: 1, valor_unitario: 500, total: 500, fixo: true },
      { rotulo: 'MENSALIDADE', quantidade: 1, valor_unitario: 1000, total: 1000, fixo: true },
    ])
    const r = separarUrgenciaRotina(resumo, exames, URGENCIA_PADRAO)
    // só as classes que existem: não há CT - ROTINA nem MG - URGÊNCIA
    assert.deepEqual(r.map(l => l.rotulo), ['CR - ROTINA', 'CR - URGÊNCIA', 'CT - URGÊNCIA', 'MG - ROTINA', 'LOCAÇÃO', 'MENSALIDADE'])
    for (const mod of ['CR', 'CT', 'MG']) {
      const antes = resumo.find(l => l.rotulo === mod)!
      const depois = r.filter(l => l.rotulo.startsWith(`${mod} - `))
      assert.equal(Math.round(depois.reduce((s, l) => s + l.total, 0) * 100) / 100, antes.total, mod)
      assert.equal(depois.reduce((s, l) => s + l.quantidade, 0), antes.quantidade, mod)
    }
    assert.deepEqual(r.filter(l => l.fixo), resumo.filter(l => l.fixo))
    assert.equal(soma(r), soma(resumo))
    assert.deepEqual(r.find(l => l.rotulo === 'CR - ROTINA'), { rotulo: 'CR - ROTINA', quantidade: 2, valor_unitario: 12.5, total: 25, fixo: false })
  })

  it('usa a lista da config (sem acento e sem caixa) e, vazia, o padrão', () => {
    assert.deepEqual(lerPrioridadesUrgencia(' URGENCIA,  Plantão ,'), ['URGENCIA', 'Plantão'])
    assert.deepEqual(lerPrioridadesUrgencia(''), URGENCIA_PADRAO)
    assert.deepEqual(lerPrioridadesUrgencia(null), URGENCIA_PADRAO)
    const exames = [exame('CR', 'PLANTAO', 10), exame('CR', 'EMERGENCIA', 10)]
    const resumo = [{ rotulo: 'CR', quantidade: 2, valor_unitario: 10, total: 20, fixo: false }]
    // config só com PLANTÃO: emergência vira rotina
    assert.deepEqual(separarUrgenciaRotina(resumo, exames, lerPrioridadesUrgencia('plantão')).map(l => [l.rotulo, l.quantidade]),
      [['CR - ROTINA', 1], ['CR - URGÊNCIA', 1]])
  })

  it('se os exames não batem com o resumo do motor, devolve o resumo como veio (TOTAL não muda)', () => {
    const resumo = [
      { rotulo: 'CR', quantidade: 3, valor_unitario: 10, total: 30, fixo: false },
      { rotulo: 'RT', quantidade: 1, valor_unitario: 100, total: 100, fixo: true },
    ]
    assert.equal(separarUrgenciaRotina(resumo, [exame('CR', 'URGENCIA', 10)], URGENCIA_PADRAO), resumo)
  })

  it('o Excel mostra MOD - URGÊNCIA e MOD - ROTINA na tabela do fim, com o TOTAL de antes', { timeout: 60_000 }, async () => {
    const ExcelJS = (await import('exceljs')).default
    const resumo = separarUrgenciaRotina(resumoMotor, santarem, URGENCIA_PADRAO)
    const bytes = await faturaUnidadeXlsx({} as never, '2026-06', resumo, santarem)
    if (process.env.FAT_EXEMPLO) writeFileSync(`${process.env.FAT_EXEMPLO}/EXEMPLO SANTAREM - PA 14.06 A 13.07.2026.xlsx`, bytes)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(bytes as unknown as ArrayBuffer)
    const ws = wb.getWorksheet('Relatório')!
    const fim: unknown[][] = []
    for (let r = santarem.length + 3; r <= ws.rowCount; r++) fim.push([1, 2, 3].map(c => ws.getCell(r, c).value))
    assert.deepEqual(fim, [
      ['MODALIDADE', 'QUANTIDADE', 'VALOR'],
      ['CT - ROTINA', 44, 1192.4],
      ['CT - URGÊNCIA', 1241, 37503.02],
      ['RESPONSÁVEL TÉCNICO', 1, 1602.96],
      ['TOTAL', 1286, 40298.38],
    ])
  })
})
