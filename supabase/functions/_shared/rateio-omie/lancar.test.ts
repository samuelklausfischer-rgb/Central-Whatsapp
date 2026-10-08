import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executarLancamento } from './lancar.ts'
import type { LinhaExistente, RegistroLancamento, RepoLancamentos } from './lancar.ts'
import { criarClienteOmie } from './omie.ts'
import type { FetchLike, Tentativa } from './omie.ts'
import { analisarNucleo, chave, escolherLancamentoRelevante, paraCentavos } from './nucleo.ts'
import type { ConfigEmpresa, ContextoAnalise, EntradaAnalise, VinculoMapa } from './nucleo.ts'

const KEY = '1234567890123'
const SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const CHAVE = 'RATEIO-MA-202609-12345'

// ---------------------------------------------------------------------------
// Banco em memória que reproduz as travas do SQL: chave única e índice parcial
// único (empresa, competencia) para status enviando/lancado/incerto.
// ---------------------------------------------------------------------------

type Linha = RegistroLancamento & { id: string; status: string; chave_integracao: string; empresa: string; competencia: string }

function bancoEmMemoria(inicial: Array<Partial<Linha>> = []) {
  const linhas = new Map<string, Linha>()
  const tentativas: Array<Record<string, unknown>> = []
  let seq = 0
  for (const l of inicial) {
    const id = `id-${++seq}`
    linhas.set(id, { id, empresa: 'MEDIMAGEM_APICE', competencia: '2026-09-01', chave_integracao: CHAVE, status: 'erro', ...l } as Linha)
  }
  const ativo = (s: string) => ['enviando', 'lancado', 'incerto'].includes(s)
  const viola = (reg: { chave_integracao: string; empresa: string; competencia: string; status: string }, ignorarId?: string) =>
    [...linhas.values()].some(
      (l) =>
        l.id !== ignorarId &&
        (l.chave_integracao === reg.chave_integracao ||
          (ativo(l.status) && ativo(reg.status) && l.empresa === reg.empresa && l.competencia === reg.competencia)),
    )

  const repo: RepoLancamentos = {
    async buscarPorChave(c) {
      await Promise.resolve()
      const l = [...linhas.values()].find((x) => x.chave_integracao === c)
      return l ? ({ id: l.id, status: l.status, criado_em: l.criado_em, atualizado_em: l.atualizado_em } as LinhaExistente) : null
    },
    async inserir(reg) {
      await Promise.resolve()
      const r = reg as Linha
      if (viola(r)) return { ok: false, conflito: true }
      const id = `id-${++seq}`
      linhas.set(id, { ...r, id })
      return { ok: true, id }
    },
    async reaproveitar(id, reg, opcoes) {
      await Promise.resolve()
      const atual = linhas.get(id)
      const aceita = ['incerto', 'erro', 'excluido'].concat(opcoes?.aceitaEnviandoOrfao ? ['enviando'] : [])
      if (!atual || !aceita.includes(atual.status)) return null
      const novo = { ...atual, ...reg, id } as Linha
      if (viola(novo, id)) return null
      linhas.set(id, novo)
      return id
    },
    async marcar(id, status, extra = {}) {
      await Promise.resolve()
      linhas.set(id, { ...linhas.get(id)!, status, ...extra } as Linha)
    },
    async apagarEnviando(id) {
      await Promise.resolve()
      if (linhas.get(id)?.status === 'enviando') linhas.delete(id)
    },
    async tentativaAntes(lancamentoId, call, payload) {
      await Promise.resolve()
      tentativas.push({ lancamento_id: lancamentoId, call, payload })
      return tentativas.length - 1
    },
    async tentativaDepois(i, d) {
      await Promise.resolve()
      Object.assign(tentativas[i as number], d)
    },
  }
  return { repo, linhas, tentativas }
}

// ---------------------------------------------------------------------------
// Omie simulado: guarda contas por chave de integração.
// ---------------------------------------------------------------------------

function omieSimulado(opcoes: { contas?: Record<string, number>; incluir?: 'ok' | 'rede' | 'negocio' | 'redundant' | '425' | 'vaza'; escrita?: string | null } = {}) {
  const contas = new Map(Object.entries(opcoes.contas ?? {}))
  const chamadas: string[] = []
  let proximo = 5000
  const f: FetchLike = async (_url, init) => {
    const corpo = JSON.parse(init.body)
    chamadas.push(corpo.call)
    const p = corpo.param[0]
    if (corpo.call === 'ConsultarContaPagar') {
      const cod = contas.get(p.codigo_lancamento_integracao)
      const j = cod
        ? { codigo_lancamento_omie: cod }
        : { faultstring: 'ERROR: Lançamento não cadastrado para o Código de Integração [x]!' }
      return { status: 200, text: async () => JSON.stringify(j) }
    }
    if (corpo.call === 'IncluirContaPagar') {
      if (opcoes.incluir === 'rede') throw new Error('timeout')
      if (opcoes.incluir === 'redundant') return { status: 200, text: async () => JSON.stringify({ faultstring: 'REDUNDANT' }) }
      if (opcoes.incluir === '425') return { status: 425, text: async () => '' }
      if (opcoes.incluir === 'vaza') return { status: 200, text: async () => JSON.stringify({ faultstring: `credencial ${SECRET} recusada` }) }
      if (opcoes.incluir === 'negocio') return { status: 200, text: async () => JSON.stringify({ faultstring: 'Fornecedor inexistente' }) }
      const cod = ++proximo
      contas.set(p.codigo_lancamento_integracao, cod)
      return { status: 200, text: async () => JSON.stringify({ codigo_lancamento_omie: cod }) }
    }
    throw new Error(`chamada inesperada: ${corpo.call}`)
  }
  const criar = (onTentativa: (t: Tentativa) => Promise<unknown>) =>
    criarClienteOmie({
      appKey: KEY,
      appSecret: SECRET,
      escrita: opcoes.escrita === undefined ? 'liberada' : opcoes.escrita,
      fetch: f,
      sleep: async () => {},
      onTentativa,
    })
  return { criar, contas, chamadas }
}

const REGISTRO = {
  execucao_id: 'e1',
  empresa: 'MEDIMAGEM_APICE',
  competencia: '2026-09-01',
  nf: '12345',
  valor_nf: 100,
  chave_integracao: CHAVE,
  status: 'enviando',
}
const PAYLOAD = { codigo_lancamento_integracao: CHAVE, valor_documento: 100 }

const AGORA = Date.parse('2026-10-07T12:00:00Z')
const rodar = (b: ReturnType<typeof bancoEmMemoria>, o: ReturnType<typeof omieSimulado>) =>
  executarLancamento({
    chaveIntegracao: CHAVE,
    registro: REGISTRO,
    payload: PAYLOAD,
    repo: b.repo,
    criarOmie: o.criar,
    agora: () => AGORA,
    redigirTexto: (s) => s.split(SECRET).join('[REDIGIDO]').split(KEY).join('[REDIGIDO]'),
  })

// ---------------------------------------------------------------------------

test('lançamento novo: insere, consulta (não existe), inclui e termina lancado', async () => {
  const b = bancoEmMemoria()
  const o = omieSimulado()
  const r = await rodar(b, o)
  assert.equal(r.ok, true)
  assert.equal(r.status, 'lancado')
  assert.equal(r.omie_codigo_lancamento, 5001)
  assert.deepEqual(o.chamadas, ['ConsultarContaPagar', 'IncluirContaPagar'])
  assert.equal(b.linhas.size, 1)
  const l = [...b.linhas.values()][0]
  assert.equal(l.status, 'lancado')
  assert.equal(l.omie_codigo_lancamento, 5001)
  // 1 linha de tentativa por chamada, com resposta preenchida e sem segredo
  assert.equal(b.tentativas.length, 2)
  assert.equal(b.tentativas[1].http_status, 200)
  assert.ok(!JSON.stringify(b.tentativas).includes(KEY) && !JSON.stringify(b.tentativas).includes(SECRET))
})

test('retentativa após erro: reaproveita a MESMA linha (chave única) e conclui', async () => {
  const b = bancoEmMemoria([{ status: 'erro' }])
  const idAntigo = [...b.linhas.keys()][0]
  const o = omieSimulado()
  const r = await rodar(b, o)
  assert.equal(r.ok, true)
  assert.equal(r.lancamento_id, idAntigo)
  assert.equal(b.linhas.size, 1, 'não pode criar uma 2ª linha para a mesma chave')
  assert.equal(b.linhas.get(idAntigo)!.status, 'lancado')
  assert.deepEqual(o.chamadas, ['ConsultarContaPagar', 'IncluirContaPagar'])
})

test('retentativa após incerto com a conta JÁ existente no Omie: só registra, não inclui', async () => {
  const b = bancoEmMemoria([{ status: 'incerto' }])
  const id = [...b.linhas.keys()][0]
  const o = omieSimulado({ contas: { [CHAVE]: 777 } })
  const r = await rodar(b, o)
  assert.equal(r.ok, true)
  assert.equal(r.status, 'lancado')
  assert.equal(r.omie_codigo_lancamento, 777)
  assert.deepEqual(o.chamadas, ['ConsultarContaPagar'], 'não pode incluir de novo')
  assert.equal(b.linhas.get(id)!.status, 'lancado')
  assert.equal(b.linhas.get(id)!.omie_codigo_lancamento, 777)
})

test('retentativa após incerto com a conta AUSENTE no Omie: consulta primeiro e então inclui', async () => {
  const b = bancoEmMemoria([{ status: 'incerto' }])
  const o = omieSimulado()
  const r = await rodar(b, o)
  assert.equal(r.status, 'lancado')
  assert.deepEqual(o.chamadas, ['ConsultarContaPagar', 'IncluirContaPagar'])
})

test('retentativa após excluido reaproveita a linha', async () => {
  const b = bancoEmMemoria([{ status: 'excluido' }])
  const r = await rodar(b, omieSimulado())
  assert.equal(r.status, 'lancado')
  assert.equal(b.linhas.size, 1)
})

test('clique duplo (dois envios em paralelo, linha nova): só um segue, o outro é recusado', async () => {
  const b = bancoEmMemoria()
  const o = omieSimulado()
  const [r1, r2] = await Promise.all([rodar(b, o), rodar(b, o)])
  const oks = [r1, r2].filter((r) => r.ok)
  const recusados = [r1, r2].filter((r) => !r.ok)
  assert.equal(oks.length, 1)
  assert.equal(recusados.length, 1)
  assert.equal(recusados[0].motivo, 'LANCAMENTO_EM_ANDAMENTO')
  assert.equal(o.chamadas.filter((c) => c === 'IncluirContaPagar').length, 1, 'Incluir só pode ocorrer uma vez')
  assert.equal(b.linhas.size, 1)
})

test('clique duplo sobre linha em erro/incerto: a troca condicional deixa só um ganhar', async () => {
  for (const status of ['erro', 'incerto']) {
    const b = bancoEmMemoria([{ status }])
    const o = omieSimulado()
    const [r1, r2] = await Promise.all([rodar(b, o), rodar(b, o)])
    assert.equal([r1, r2].filter((r) => r.ok).length, 1, status)
    assert.equal([r1, r2].find((r) => !r.ok)!.motivo, 'LANCAMENTO_EM_ANDAMENTO')
    assert.equal(o.chamadas.filter((c) => c === 'IncluirContaPagar').length, 1)
    assert.equal(b.linhas.size, 1)
  }
})

test('já lancado ou enviando: recusa sem tocar o Omie', async () => {
  for (const [status, motivo] of [['lancado', 'JA_LANCADO'], ['enviando', 'LANCAMENTO_EM_ANDAMENTO']]) {
    const b = bancoEmMemoria([{ status }])
    const o = omieSimulado()
    const r = await rodar(b, o)
    assert.equal(r.ok, false)
    assert.equal(r.motivo, motivo)
    assert.deepEqual(o.chamadas, [])
  }
})

test('outra NF ativa na mesma empresa e competência barra pelo índice único', async () => {
  const b = bancoEmMemoria([{ status: 'lancado', chave_integracao: 'RATEIO-MA-202609-99999' }])
  const o = omieSimulado()
  const r = await rodar(b, o)
  assert.equal(r.ok, false)
  assert.deepEqual(o.chamadas, [])
})

test('ESCRITA_DESLIGADA: apaga a linha nova; linha reaproveitada volta ao status anterior', async () => {
  const nova = bancoEmMemoria()
  const r1 = await rodar(nova, omieSimulado({ escrita: null }))
  assert.equal(r1.ok, false)
  assert.equal(r1.motivo, 'ESCRITA_DESLIGADA')
  assert.equal(nova.linhas.size, 0)
  assert.equal(nova.tentativas.length, 1, 'o histórico da consulta fica (Incluir recusado não gera linha)')

  const velha = bancoEmMemoria([{ status: 'incerto' }])
  const o = omieSimulado({ escrita: 'nao' })
  const r2 = await rodar(velha, o)
  assert.equal(r2.motivo, 'ESCRITA_DESLIGADA')
  assert.equal([...velha.linhas.values()][0].status, 'incerto')
})

test('falha de rede na inclusão vira incerto (nunca erro); erro de negócio vira erro', async () => {
  const b1 = bancoEmMemoria()
  const r1 = await rodar(b1, omieSimulado({ incluir: 'rede' }))
  assert.equal(r1.ok, false)
  assert.equal(r1.status, 'incerto')
  assert.equal([...b1.linhas.values()][0].status, 'incerto')

  const b2 = bancoEmMemoria()
  const r2 = await rodar(b2, omieSimulado({ incluir: 'negocio' }))
  assert.equal(r2.status, 'erro')
  assert.match(String(r2.mensagem), /Fornecedor inexistente/)
  assert.equal([...b2.linhas.values()][0].status, 'erro')
})

// ---------------------------------------------------------------------------
// Análise: tabela "Lançamento anterior da mesma chave"
// ---------------------------------------------------------------------------

const CONFIG: ConfigEmpresa = {
  empresa: 'MEDIMAGEM_APICE',
  conta_omie: 'MEDIMAGEM',
  cnpj_esperado: '12345678000199',
  cod_fornecedor: 1,
  cod_categoria: '2.01.01',
  tipo_documento: 'BOL',
  conta_corrente_padrao: 7,
}
const ENTRADA: EntradaAnalise = { empresa: 'MEDIMAGEM_APICE', nf: '12345', valor_nf: 100, competencia: '2026-09', emissao: '2026-10-07' }
const MAPA: VinculoMapa[] = [{ unidade_chave: chave('A'), cod_departamento: 1, departamento_nome: 'D', confianca: 'ALTA' }]
const ctx = (jaLancado: ContextoAnalise['jaLancado']): ContextoAnalise => ({
  execucao: { linhas: [{ unidade: 'A', total: 100 }], total_geral: paraCentavos(100) / 100, criado_por: 'u1' },
  usuarioId: 'u1',
  mapa: MAPA,
  config: CONFIG,
  departamentosAtivos: null,
  cnpjsOmie: null,
  jaLancado,
  teto: 1e6,
})
const tipos = (xs: Array<{ tipo: string }>) => xs.map((x) => x.tipo)

test('análise por status anterior: bloqueios e avisos da tabela do contrato', () => {
  const a = (status: string, mesma_chave = true) =>
    analisarNucleo(ENTRADA, ctx({ status, omie_codigo_lancamento: '123', criado_em: '2026-10-07T10:00:00Z', mesma_chave }))

  const lancado = a('lancado')
  assert.deepEqual(tipos(lancado.bloqueios), ['JA_LANCADO'])
  assert.equal(lancado.ja_lancado?.omie_codigo_lancamento, 123, 'número, não texto')

  const enviando = a('enviando')
  assert.deepEqual(tipos(enviando.bloqueios), ['LANCAMENTO_EM_ANDAMENTO'])

  const incerto = a('incerto')
  assert.deepEqual(incerto.bloqueios, [])
  assert.deepEqual(tipos(incerto.avisos), ['LANCAMENTO_INCERTO'])
  assert.equal(incerto.ja_lancado?.status, 'incerto')

  const erro = a('erro')
  assert.deepEqual(erro.bloqueios, [])
  assert.deepEqual(tipos(erro.avisos), ['TENTATIVA_ANTERIOR_COM_ERRO'])

  const excluido = a('excluido')
  assert.deepEqual(excluido.bloqueios, [])
  assert.deepEqual(excluido.avisos, [])

  assert.deepEqual(tipos(a('incerto', false).bloqueios), ['JA_LANCADO'], 'incerto de OUTRA NF barra pelo índice')
  assert.equal(analisarNucleo(ENTRADA, ctx({ status: 'lancado' })).ja_lancado?.omie_codigo_lancamento, null)
  assert.equal(analisarNucleo(ENTRADA, ctx(null)).ja_lancado, null)
})

test('escolherLancamentoRelevante: mesma chave vence; senão um ativo de outra NF; senão nada', () => {
  const linhas = [
    { chave_integracao: 'RATEIO-MA-202609-1', status: 'lancado' },
    { chave_integracao: CHAVE, status: 'erro' },
  ]
  assert.deepEqual(escolherLancamentoRelevante(linhas, CHAVE), { chave_integracao: CHAVE, status: 'erro', mesma_chave: true })
  assert.equal(escolherLancamentoRelevante(linhas, 'RATEIO-MA-202609-77')?.mesma_chave, false)
  assert.equal(escolherLancamentoRelevante([{ chave_integracao: 'X', status: 'erro' }], CHAVE), null)
  assert.equal(escolherLancamentoRelevante([], CHAVE), null)
})

test('REDUNDANT, 425 e rede na inclusão: 1 envio só e status incerto (nunca erro)', async () => {
  for (const incluir of ['redundant', '425', 'rede'] as const) {
    const b = bancoEmMemoria()
    const o = omieSimulado({ incluir })
    const r = await rodar(b, o)
    assert.equal(r.ok, false, incluir)
    assert.equal(r.status, 'incerto', incluir)
    assert.equal(o.chamadas.filter((c) => c === 'IncluirContaPagar').length, 1, `${incluir}: Incluir só uma vez`)
    assert.equal([...b.linhas.values()][0].status, 'incerto')
  }
})

test('enviando órfão (mais de 10 min) é reaproveitado como incerto: consulta antes de incluir', async () => {
  const b = bancoEmMemoria([{ status: 'enviando', atualizado_em: '2026-10-07T11:40:00Z' }])
  const o = omieSimulado({ contas: { [CHAVE]: 31 } })
  const r = await rodar(b, o)
  assert.equal(r.ok, true)
  assert.equal(r.omie_codigo_lancamento, 31)
  assert.deepEqual(o.chamadas, ['ConsultarContaPagar'])
})

test('enviando recente (menos de 10 min) continua recusado', async () => {
  const b = bancoEmMemoria([{ status: 'enviando', atualizado_em: '2026-10-07T11:55:00Z' }])
  const o = omieSimulado()
  const r = await rodar(b, o)
  assert.equal(r.motivo, 'LANCAMENTO_EM_ANDAMENTO')
  assert.deepEqual(o.chamadas, [])
})

test('excluido com escrita desligada: volta a excluido e não perde o omie_codigo_lancamento antigo', async () => {
  const b = bancoEmMemoria([{ status: 'excluido', omie_codigo_lancamento: 4242 }])
  const r = await rodar(b, omieSimulado({ escrita: null }))
  assert.equal(r.motivo, 'ESCRITA_DESLIGADA')
  const l = [...b.linhas.values()][0]
  assert.equal(l.status, 'excluido')
  assert.equal(l.omie_codigo_lancamento, 4242)
})

test('mensagem devolvida ao browser passa por redigirTexto (sem segredo)', async () => {
  const b = bancoEmMemoria()
  const r = await rodar(b, omieSimulado({ incluir: 'vaza' }))
  assert.equal(r.status, 'erro')
  assert.ok(!String(r.mensagem).includes(SECRET))
  assert.ok(!JSON.stringify(b.tentativas).includes(SECRET))
})
