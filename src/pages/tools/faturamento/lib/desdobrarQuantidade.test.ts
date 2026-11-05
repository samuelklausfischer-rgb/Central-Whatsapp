// Lista do relatório com o exame de quantidade N em N linhas de quantidade 1 (pedido de 05/11/2026) — só nas pastas da
// config desdobrar_quantidade_pastas (hoje Marabá); as outras unidades ficam exatamente como antes.
// Rodar: bun test src/pages/tools/faturamento
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { desdobraQuantidade, desdobrarQuantidade, examesDoRelatorio, lerDesdobrarPastas } from './relatorioUnidade'
import type { ExameLinha } from './excel'

const exame = (estudo: string, quantidade: number, valor_unitario: number, valor_total = Math.round(valor_unitario * quantidade * 100) / 100): ExameLinha =>
  ({ nome_bruto: 'MARABA (PRN)', estudo_descricao: estudo, modalidade: 'CT', quantidade, valor_unitario, valor_total })

const soma = (xs: ExameLinha[], k: 'quantidade' | 'valor_total') => Math.round(xs.reduce((s, e) => s + Number(e[k]), 0) * 100) / 100

describe('desdobrarQuantidade', () => {
  it('abdome total que conta 2 vira 2 linhas iguais de quantidade 1; o resto fica como está', () => {
    const r = desdobrarQuantidade([exame('TC CRANIO', 1, 40), exame('TC ABDOME TOTAL', 2, 40), exame('TC TORAX', 1, 40)])
    assert.deepEqual(r.map(e => [e.estudo_descricao, e.quantidade, e.valor_total]), [
      ['TC CRANIO', 1, 40], ['TC ABDOME TOTAL', 1, 40], ['TC ABDOME TOTAL', 1, 40], ['TC TORAX', 1, 40],
    ])
  })
  it('a soma de quantidade e valor não muda, nem com unitário de mais de 2 casas', () => {
    const xs = [exame('TC ABDOME TOTAL', 2, 8.5535), exame('TC ABDOME TOTAL', 3, 10.005), exame('TC CRANIO', 1, 8.55)]
    const r = desdobrarQuantidade(xs)
    assert.equal(r.length, 6)
    assert.ok(r.every(e => e.quantidade === 1))
    assert.equal(soma(r, 'quantidade'), soma(xs, 'quantidade'))
    assert.equal(soma(r, 'valor_total'), soma(xs, 'valor_total'))
  })
  it('exame a R$ 0 (ex.: franquia) também desdobra, sem valor', () => {
    assert.deepEqual(desdobrarQuantidade([exame('TC ABDOME TOTAL', 2, 0)]).map(e => e.valor_total), [0, 0])
  })
})

describe('examesDoRelatorio (só as pastas de desdobrar_quantidade_pastas desdobram)', () => {
  const pastas = lerDesdobrarPastas({ desdobrar_quantidade_pastas: ' maraba ' })
  const xs = [exame('TC ABDOME TOTAL', 2, 40)]
  it('Marabá desdobra; a pasta é comparada sem acento e sem caixa', () => {
    assert.equal(examesDoRelatorio({ pasta: 'maraba' }, xs, pastas).length, 2)
    assert.ok(desdobraQuantidade({ pasta: 'MARABÁ' }, pastas))
  })
  it('outra unidade (ou sem a chave na config) fica igual', () => {
    assert.equal(examesDoRelatorio({ pasta: 'UNAI' }, xs, pastas), xs)
    assert.equal(examesDoRelatorio({ pasta: 'maraba' }, xs, lerDesdobrarPastas({})), xs)
    assert.equal(examesDoRelatorio({ pasta: null }, xs, pastas), xs)
  })
})
