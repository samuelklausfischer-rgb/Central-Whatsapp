import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  analisarNucleo,
  nfNormalizada,
  statusEfetivo,
  chave,
  chaveIntegracao,
  competenciaParaData,
  dataBr,
  hashAnalise,
  jsonEstavel,
  montarDistribuicao,
  montarPayloadIncluir,
  paraCentavos,
  ultimoDiaDoMes,
} from './nucleo.ts'
import type { ConfigEmpresa, ContextoAnalise, EntradaAnalise, LinhaRateio, VinculoMapa } from './nucleo.ts'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

// PRNG determinístico (mulberry32) para os 500 casos aleatórios.
function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CONFIG: ConfigEmpresa = {
  empresa: 'MEDIMAGEM_APICE',
  conta_omie: 'MEDIMAGEM',
  cnpj_esperado: '12345678000199',
  cod_fornecedor: 1111,
  cod_categoria: '2.01.01',
  tipo_documento: 'BOL',
  conta_corrente_padrao: 777,
}

function vinculo(unidade: string, cod: number, confianca = 'ALTA', nome = `Dep ${cod}`): VinculoMapa {
  return { unidade_chave: chave(unidade), cod_departamento: cod, departamento_nome: nome, confianca }
}

function ctxBase(linhas: LinhaRateio[], mapa: VinculoMapa[], extra: Partial<ContextoAnalise> = {}): ContextoAnalise {
  const total = linhas.reduce((a, l) => a + paraCentavos(l.total), 0) / 100
  return {
    execucao: { linhas, total_geral: total, criado_por: 'u1' },
    mapa,
    usuarioId: 'u1',
    config: CONFIG,
    departamentosAtivos: null,
    cnpjsOmie: null,
    jaLancado: null,
    teto: 1_000_000,
    ...extra,
  }
}

const ENTRADA: EntradaAnalise = {
  empresa: 'MEDIMAGEM_APICE',
  nf: '12345',
  valor_nf: 556.07,
  competencia: '2026-09',
  emissao: '2026-10-07',
}

const tipos = (xs: Array<{ tipo: string }>) => xs.map((x) => x.tipo)

test('chave(): sem acento, maiúsculas, espaços e travessões normalizados', () => {
  assert.equal(chave('  São  João – Centro  '), 'SAO JOAO - CENTRO')
  assert.equal(chave('ARCO VERDE (PRN)'), 'ARCO VERDE (PRN)')
  assert.equal(chave('Vitória—ES'), 'VITORIA-ES')
  assert.equal(chave('a�b'), 'AB')
  assert.equal(chave(null), '')
  assert.equal(chave(undefined), '')
})

test('invariantes em 500 casos aleatórios: soma nValDep = NF e soma nPerDep = 100,00', () => {
  const rnd = prng(20261007)
  let executados = 0
  for (let caso = 0; caso < 500; caso++) {
    const nUnid = 1 + Math.floor(rnd() * 30)
    const nDep = 1 + Math.floor(rnd() * 8)
    const linhas: LinhaRateio[] = []
    const mapa: VinculoMapa[] = []
    let somaCent = 0
    for (let i = 0; i < nUnid; i++) {
      const cent = 1 + Math.floor(rnd() * 5_000_000)
      somaCent += cent
      const nome = `Unidade ${caso}-${i}`
      linhas.push({ unidade: nome, total: cent / 100 })
      mapa.push(vinculo(nome, 1000 + Math.floor(rnd() * nDep)))
    }
    const dif = Math.floor(rnd() * 201) - 100 // -100..+100 centavos
    const nfCent = somaCent + dif
    if (nfCent <= 0) continue
    executados++
    const d = montarDistribuicao({ linhas, mapa, valorNfCentavos: nfCent })
    assert.deepEqual(d.bloqueios, [], `caso ${caso}`)
    const somaVal = d.itens.reduce((a, it) => a + Math.round(it.valor * 100), 0)
    const somaPerc = d.itens.reduce((a, it) => a + Math.round(it.perc * 100), 0)
    assert.equal(somaVal, nfCent, `Σ nValDep caso ${caso}`)
    assert.equal(somaPerc, 10000, `Σ nPerDep caso ${caso}`)
    for (const it of d.itens) assert.ok(it.valor >= 0 && it.perc >= 0)
  }
  assert.equal(executados, 500)
})

test('ajuste de até R$ 1,00 vai para o maior departamento; acima disso bloqueia NF_DIVERGENTE', () => {
  const linhas = [{ unidade: 'A', total: 100 }, { unidade: 'B', total: 300 }]
  const mapa = [vinculo('A', 1), vinculo('B', 2)]
  const ok = montarDistribuicao({ linhas, mapa, valorNfCentavos: 40100 }) // +100 centavos
  assert.deepEqual(ok.ajuste, { cod_departamento: 2, centavos: 100 })
  assert.equal(ok.itens.find((i) => i.cod_departamento === 2)!.valor, 301)
  assert.equal(ok.itens.find((i) => i.cod_departamento === 1)!.valor, 100)
  assert.ok(tipos(ok.avisos).includes('AJUSTE_CENTAVOS'))

  const neg = montarDistribuicao({ linhas, mapa, valorNfCentavos: 39901 }) // -99 centavos
  assert.deepEqual(neg.ajuste, { cod_departamento: 2, centavos: -99 })

  // Pela análise completa: 101 centavos de diferença bloqueia.
  const r = analisarNucleo({ ...ENTRADA, valor_nf: 401.01 }, ctxBase(linhas, mapa))
  assert.ok(tipos(r.bloqueios).includes('NF_DIVERGENTE'))
  assert.equal(r.ajuste, null)
  assert.equal(r.diferenca, 1.01)
  // E 100 centavos exatos passa limpo.
  const r2 = analisarNucleo({ ...ENTRADA, valor_nf: 401 }, ctxBase(linhas, mapa))
  assert.deepEqual(r2.bloqueios, [])
  assert.ok(tipos(r2.avisos).includes('AJUSTE_CENTAVOS'))
})

test('unidade com valor e sem departamento bloqueia; unidade zerada sem vínculo não', () => {
  const linhas = [{ unidade: 'A', total: 50 }, { unidade: 'Órfã', total: 20.5 }, { unidade: 'Zero', total: 0 }]
  const r = analisarNucleo({ ...ENTRADA, valor_nf: 50 }, ctxBase(linhas, [vinculo('A', 1)]))
  const b = r.bloqueios.filter((x) => x.tipo === 'UNIDADE_SEM_DEPARTAMENTO')
  assert.equal(b.length, 1)
  assert.equal(b[0].referencia, 'Órfã')
})

test('N:1: várias unidades no mesmo departamento somam num item só', () => {
  const linhas = [{ unidade: 'Alfa', total: 10.01 }, { unidade: 'Beta', total: 20.02 }, { unidade: 'Gama', total: 5 }]
  const mapa = [vinculo('Alfa', 7), vinculo('beta', 7), vinculo('Gama', 8)]
  const d = montarDistribuicao({ linhas, mapa, valorNfCentavos: 3503 })
  assert.equal(d.itens.length, 2)
  const d7 = d.itens.find((i) => i.cod_departamento === 7)!
  assert.equal(d7.valor, 30.03)
  assert.deepEqual(d7.unidades, ['Alfa', 'Beta'])
  assert.deepEqual(d.bloqueios, [])
})

test('vínculo MEDIA/BAIXA gera aviso, não bloqueio', () => {
  const linhas = [{ unidade: 'A', total: 10 }, { unidade: 'B', total: 10 }]
  const r = analisarNucleo({ ...ENTRADA, valor_nf: 20 }, ctxBase(linhas, [vinculo('A', 1, 'MEDIA'), vinculo('B', 2, 'BAIXA')]))
  assert.deepEqual(r.bloqueios, [])
  assert.equal(r.avisos.filter((a) => a.tipo === 'VINCULO_BAIXA_CONFIANCA').length, 2)
})

test('chave de integração', () => {
  assert.equal(chaveIntegracao('PRN', '2026-09', '12345'), 'RATEIO-P-202609-12345')
  assert.equal(chaveIntegracao('PRN_APICE', '2026-09', '12345'), 'RATEIO-PA-202609-12345')
  assert.equal(chaveIntegracao('MEDIMAGEM', '2026-01', 'A 12-3/4'), 'RATEIO-M-202601-A1234')
  assert.equal(chaveIntegracao('MEDIMAGEM_APICE', '2026-12', '9'), 'RATEIO-MA-202612-9')
  assert.throws(() => chaveIntegracao('PRN', '2026-9', '1'))
  assert.throws(() => chaveIntegracao('PRN', '2026-13', '1'))
  assert.throws(() => chaveIntegracao('PRN', '2026-09', ' - '))
  assert.throws(() => chaveIntegracao('OUTRA', '2026-09', '1'))
})

test('último dia do mês, datas e competência', () => {
  assert.equal(ultimoDiaDoMes('2026-10-07'), '2026-10-31')
  assert.equal(ultimoDiaDoMes('2026-02-03'), '2026-02-28')
  assert.equal(ultimoDiaDoMes('2028-02-10'), '2028-02-29')
  assert.equal(ultimoDiaDoMes('2026-04-30'), '2026-04-30')
  assert.equal(ultimoDiaDoMes('2026-12'), '2026-12-31')
  assert.equal(dataBr('2026-10-07'), '07/10/2026')
  assert.equal(competenciaParaData('2026-09'), '2026-09-01')
})

test('vencimento padrão é o último dia do mês da emissão', () => {
  const r = analisarNucleo({ ...ENTRADA, valor_nf: 10 }, ctxBase([{ unidade: 'A', total: 10 }], [vinculo('A', 1)]))
  assert.equal(r.cabecalho.vencimento, '2026-10-31')
  assert.equal(r.cabecalho.conta_corrente, 777)
})

test('hash estável: independe da ordem e muda com qualquer valor', async () => {
  const linhas = [{ unidade: 'A', total: 100 }, { unidade: 'B', total: 300 }]
  const mapa = [vinculo('A', 1), vinculo('B', 2)]
  const a1 = analisarNucleo({ ...ENTRADA, valor_nf: 400 }, ctxBase(linhas, mapa))
  const a2 = analisarNucleo({ ...ENTRADA, valor_nf: 400 }, ctxBase([...linhas].reverse(), [...mapa].reverse()))
  const h1 = await hashAnalise(a1, sha)
  assert.match(h1, /^[0-9a-f]{64}$/)
  assert.equal(await hashAnalise(a2, sha), h1)
  assert.equal(jsonEstavel({ b: 1, a: [2, { d: 1, c: 2 }] }), jsonEstavel({ a: [2, { c: 2, d: 1 }], b: 1 }))
  const a3 = analisarNucleo({ ...ENTRADA, valor_nf: 400.5 }, ctxBase(linhas, mapa))
  assert.notEqual(await hashAnalise(a3, sha), h1)
  const a4 = analisarNucleo({ ...ENTRADA, valor_nf: 400, nf: '99999' }, ctxBase(linhas, mapa))
  assert.notEqual(await hashAnalise(a4, sha), h1)
  const a5 = analisarNucleo({ ...ENTRADA, valor_nf: 400, vencimento: '2026-11-15' }, ctxBase(linhas, mapa))
  assert.notEqual(await hashAnalise(a5, sha), h1)
  // função de hash assíncrona também é aceita
  assert.equal(await hashAnalise(a1, async (s) => sha(s)), h1)
})

test('payload do IncluirContaPagar segue o contrato', () => {
  const linhas = [{ unidade: 'A', total: 100.5 }, { unidade: 'B', total: 455.57 }]
  const a = analisarNucleo(ENTRADA, ctxBase(linhas, [vinculo('A', 123), vinculo('B', 456)]))
  const p = montarPayloadIncluir(a, CONFIG)
  assert.equal(p.codigo_lancamento_integracao, 'RATEIO-MA-202609-12345')
  assert.equal(p.codigo_cliente_fornecedor, 1111)
  assert.equal(p.codigo_categoria, '2.01.01')
  assert.equal(p.codigo_tipo_documento, 'BOL')
  assert.equal(p.id_conta_corrente, 777)
  assert.equal(p.data_emissao, '07/10/2026')
  assert.equal(p.data_entrada, '07/10/2026')
  assert.equal(p.data_vencimento, '31/10/2026')
  assert.equal(p.data_previsao, '31/10/2026')
  assert.equal(p.valor_documento, 556.07)
  assert.equal(p.numero_documento_fiscal, '12345')
  assert.equal(p.numero_parcela, '001/001')
  assert.equal(p.observacao, 'Rateio Mobilemed MEDIMAGEM_APICE competencia 09/2026 - gerado pelo Central-Whatsapp')
  assert.equal(p.distribuicao.length, 2)
  assert.equal(Math.round(p.distribuicao.reduce((s, d) => s + d.nValDep * 100, 0)), 55607)
  assert.equal(Math.round(p.distribuicao.reduce((s, d) => s + d.nPerDep * 100, 0)), 10000)
  assert.ok(!JSON.stringify(p).includes('app_key'))
})

test('demais bloqueios e avisos do contrato', () => {
  const linhas = [{ unidade: 'A', total: 100 }]
  const mapa = [vinculo('A', 1)]
  const base = { ...ENTRADA, valor_nf: 100 }
  const semCc = { ...CONFIG, conta_corrente_padrao: null }

  assert.deepEqual(tipos(analisarNucleo(base, ctxBase(linhas, mapa)).bloqueios), [])

  assert.ok(tipos(analisarNucleo({ ...base, nf: '  ' }, ctxBase(linhas, mapa)).bloqueios).includes('NF_VAZIA'))
  assert.ok(
    tipos(analisarNucleo(base, ctxBase([], mapa, { execucao: { linhas: null, total_geral: 0 } })).bloqueios).includes('EXECUCAO_SEM_LINHAS'),
  )
  assert.ok(
    tipos(analisarNucleo(base, ctxBase(linhas, mapa, { execucao: { linhas, total_geral: 105, criado_por: 'u1' } })).bloqueios).includes('EXECUCAO_INCONSISTENTE'),
  )
  // tolerância de 0,01 na consistência
  assert.ok(
    !tipos(analisarNucleo(base, ctxBase(linhas, mapa, { execucao: { linhas, total_geral: 100.01, criado_por: 'u1' } })).bloqueios).includes('EXECUCAO_INCONSISTENTE'),
  )
  assert.ok(tipos(analisarNucleo(base, ctxBase(linhas, mapa, { departamentosAtivos: [2, 3] })).bloqueios).includes('DEPARTAMENTO_INEXISTENTE'))
  assert.deepEqual(tipos(analisarNucleo(base, ctxBase(linhas, mapa, { departamentosAtivos: ['1'] })).bloqueios), [])
  assert.ok(tipos(analisarNucleo(base, ctxBase(linhas, mapa, { cnpjsOmie: ['99.999.999/0001-99'] })).bloqueios).includes('CREDENCIAL_EMPRESA_ERRADA'))
  assert.deepEqual(tipos(analisarNucleo(base, ctxBase(linhas, mapa, { cnpjsOmie: ['12.345.678/0001-99'] })).bloqueios), [])
  assert.ok(tipos(analisarNucleo(base, ctxBase(linhas, mapa, { teto: 99 })).bloqueios).includes('ACIMA_DO_TETO'))
  assert.ok(tipos(analisarNucleo(base, ctxBase(linhas, mapa, { teto: null })).bloqueios).includes('CONFIG_AUSENTE'))
  assert.ok(tipos(analisarNucleo(base, ctxBase(linhas, mapa, { config: null })).bloqueios).includes('CONFIG_AUSENTE'))
  assert.ok(tipos(analisarNucleo(base, ctxBase(linhas, mapa, { config: semCc })).bloqueios).includes('CONFIG_AUSENTE'))
  assert.deepEqual(tipos(analisarNucleo({ ...base, conta_corrente: 555 }, ctxBase(linhas, mapa, { config: semCc })).bloqueios), [])
  const jl = analisarNucleo(base, ctxBase(linhas, mapa, { jaLancado: { status: 'lancado', omie_codigo_lancamento: 5 } }))
  assert.ok(tipos(jl.bloqueios).includes('JA_LANCADO'))
  assert.equal(jl.ja_lancado?.status, 'lancado')
  assert.ok(
    tipos(analisarNucleo(base, ctxBase(linhas, mapa, { execucao: { linhas, total_geral: 100, pendencias: ['x'], criado_por: 'u1' } })).avisos).includes(
      'EXECUCAO_COM_PENDENCIAS',
    ),
  )
  assert.throws(() => analisarNucleo({ ...base, competencia: '2026-9' }, ctxBase(linhas, mapa)))
  assert.throws(() => analisarNucleo({ ...base, empresa: 'XYZ' }, ctxBase(linhas, mapa)))
})

test('conta Omie por empresa', () => {
  const l = [{ unidade: 'A', total: 1 }]
  const m = [vinculo('A', 1)]
  const c = (empresa: string) => analisarNucleo({ ...ENTRADA, empresa, valor_nf: 1 }, ctxBase(l, m)).conta_omie
  assert.equal(c('PRN'), 'PRN')
  assert.equal(c('PRN_APICE'), 'PRN')
  assert.equal(c('MEDIMAGEM'), 'MEDIMAGEM')
  assert.equal(c('MEDIMAGEM_APICE'), 'MEDIMAGEM')
})

test('DEPARTAMENTO_VALOR_INVALIDO: valor <= 0 ou percentual que arredonda para 0,00', () => {
  // dept B recebe 0,01 de 1.000.000,01: 0,00%
  const l1 = [{ unidade: 'A', total: 1000000 }, { unidade: 'B', total: 0.01 }]
  const r1 = analisarNucleo({ ...ENTRADA, valor_nf: 1000000.01 }, ctxBase(l1, [vinculo('A', 1), vinculo('B', 2)]))
  assert.deepEqual(r1.bloqueios.filter((b) => b.tipo === 'DEPARTAMENTO_VALOR_INVALIDO').map((b) => b.referencia), ['2'])
  // crédito: departamento com soma negativa
  const l2 = [{ unidade: 'A', total: 100 }, { unidade: 'B', total: -10 }]
  const r2 = analisarNucleo({ ...ENTRADA, valor_nf: 90 }, ctxBase(l2, [vinculo('A', 1), vinculo('B', 2)]))
  assert.deepEqual(r2.bloqueios.filter((b) => b.tipo === 'DEPARTAMENTO_VALOR_INVALIDO').map((b) => b.referencia), ['2'])
  // caso normal não bloqueia
  const r3 = analisarNucleo({ ...ENTRADA, valor_nf: 100 }, ctxBase([{ unidade: 'A', total: 100 }], [vinculo('A', 1)]))
  assert.ok(!tipos(r3.bloqueios).includes('DEPARTAMENTO_VALOR_INVALIDO'))
})

test('EXECUCAO_DE_OUTRO_USUARIO: só o autor lança; sem autor também bloqueia', () => {
  const l = [{ unidade: 'A', total: 100 }]
  const m = [vinculo('A', 1)]
  const base = { ...ENTRADA, valor_nf: 100 }
  const exec = (criado_por: string | null) => ({ linhas: l, total_geral: 100, criado_por })
  assert.deepEqual(tipos(analisarNucleo(base, ctxBase(l, m)).bloqueios), [])
  assert.ok(tipos(analisarNucleo(base, ctxBase(l, m, { usuarioId: 'u2' })).bloqueios).includes('EXECUCAO_DE_OUTRO_USUARIO'))
  assert.ok(tipos(analisarNucleo(base, ctxBase(l, m, { execucao: exec(null) })).bloqueios).includes('EXECUCAO_DE_OUTRO_USUARIO'))
  assert.ok(tipos(analisarNucleo(base, ctxBase(l, m, { usuarioId: null })).bloqueios).includes('EXECUCAO_DE_OUTRO_USUARIO'))
})

test('NF_JA_LANCADA (mesma NF normalizada, outra chave) e EXECUCAO_JA_LANCADA', () => {
  assert.equal(nfNormalizada('00012-3 a'), '123A')
  assert.equal(nfNormalizada('000'), '0')
  const l = [{ unidade: 'A', total: 100 }]
  const m = [vinculo('A', 1)]
  const base = { ...ENTRADA, execucao_id: 'ex-1', valor_nf: 100 }
  const outraCompetencia = { chave_integracao: 'RATEIO-MA-202608-0012345', nf: '0012345', execucao_id: 'ex-0', status: 'lancado' }
  const r1 = analisarNucleo(base, ctxBase(l, m, { lancamentosAtivos: [outraCompetencia] }))
  assert.deepEqual(tipos(r1.bloqueios), ['NF_JA_LANCADA'])
  // mesma chave não conta (é o próprio lançamento, tratado pela tabela de status)
  const propria = { ...outraCompetencia, chave_integracao: 'RATEIO-MA-202609-12345' }
  assert.deepEqual(analisarNucleo(base, ctxBase(l, m, { lancamentosAtivos: [propria] })).bloqueios, [])
  // lançamento em erro/excluído não conta
  assert.deepEqual(analisarNucleo(base, ctxBase(l, m, { lancamentosAtivos: [{ ...outraCompetencia, status: 'erro' }] })).bloqueios, [])
  // outra NF, mesma execução
  const mesmaExec = { chave_integracao: 'RATEIO-MA-202608-777', nf: '777', execucao_id: 'ex-1', status: 'incerto' }
  assert.deepEqual(tipos(analisarNucleo(base, ctxBase(l, m, { lancamentosAtivos: [mesmaExec] })).bloqueios), ['EXECUCAO_JA_LANCADA'])
  // outra NF e outra execução: livre
  assert.deepEqual(analisarNucleo(base, ctxBase(l, m, { lancamentosAtivos: [{ ...mesmaExec, execucao_id: 'ex-9' }] })).bloqueios, [])
})

test('enviando com mais de 10 min vale como incerto', () => {
  const agora = Date.parse('2026-10-07T12:00:00Z')
  assert.equal(statusEfetivo({ status: 'enviando', atualizado_em: '2026-10-07T11:49:00Z' }, agora), 'incerto')
  assert.equal(statusEfetivo({ status: 'enviando', atualizado_em: '2026-10-07T11:55:00Z' }, agora), 'enviando')
  assert.equal(statusEfetivo({ status: 'enviando', atualizado_em: null, criado_em: '2026-10-07T11:00:00Z' }, agora), 'incerto')
  assert.equal(statusEfetivo({ status: 'lancado', atualizado_em: '2026-10-07T01:00:00Z' }, agora), 'lancado')
  const l = [{ unidade: 'A', total: 100 }]
  const m = [vinculo('A', 1)]
  const base = { ...ENTRADA, valor_nf: 100 }
  const velho = analisarNucleo(base, ctxBase(l, m, { agora, jaLancado: { status: 'enviando', atualizado_em: '2026-10-07T11:40:00Z' } }))
  assert.deepEqual(velho.bloqueios, [])
  assert.deepEqual(tipos(velho.avisos), ['LANCAMENTO_INCERTO'])
  assert.equal(velho.ja_lancado?.status, 'incerto')
  const novo = analisarNucleo(base, ctxBase(l, m, { agora, jaLancado: { status: 'enviando', atualizado_em: '2026-10-07T11:58:00Z' } }))
  assert.deepEqual(tipos(novo.bloqueios), ['LANCAMENTO_EM_ANDAMENTO'])
})

test('hash cobre fornecedor, categoria e tipo de documento do config', async () => {
  const l = [{ unidade: 'A', total: 100 }]
  const a = analisarNucleo({ ...ENTRADA, valor_nf: 100 }, ctxBase(l, [vinculo('A', 1)]))
  const h = await hashAnalise(a, sha, CONFIG)
  assert.equal(await hashAnalise(a, sha, { ...CONFIG }), h)
  assert.notEqual(await hashAnalise(a, sha, { ...CONFIG, cod_fornecedor: 2222 }), h)
  assert.notEqual(await hashAnalise(a, sha, { ...CONFIG, cod_categoria: '9.99.99' }), h)
  assert.notEqual(await hashAnalise(a, sha, { ...CONFIG, tipo_documento: 'NF' }), h)
  assert.notEqual(await hashAnalise(a, sha), h)
})
