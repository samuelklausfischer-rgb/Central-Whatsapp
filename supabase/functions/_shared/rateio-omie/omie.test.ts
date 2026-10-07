import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BACKOFF_MS,
  conferirCredenciais,
  criarClienteOmie,
  ErroOmie,
  METODOS_PERMITIDOS,
  PADRAO_CONTA_NAO_EXISTE,
} from './omie.ts'
import type { FetchLike, Tentativa } from './omie.ts'

const KEY = '1234567890123'
const SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

type Resposta = { status?: number; corpo?: unknown; texto?: string; erroRede?: boolean }

/** Omie simulado: devolve as respostas da fila, na ordem, e guarda as requisições. */
function omieSimulado(fila: Resposta[]) {
  const reqs: Array<{ url: string; corpo: any }> = []
  const f: FetchLike = async (url, init) => {
    reqs.push({ url, corpo: JSON.parse(init.body) })
    const r = fila.shift()
    if (!r) throw new Error('fila do Omie simulado vazia')
    if (r.erroRede) throw new Error('rede caiu')
    return { status: r.status ?? 200, text: async () => r.texto ?? JSON.stringify(r.corpo ?? {}) }
  }
  return { fetch: f, reqs, fila }
}

function cliente(fila: Resposta[], extra: Record<string, unknown> = {}) {
  const sim = omieSimulado(fila)
  const esperas: number[] = []
  let relogio = 1_000_000
  const c = criarClienteOmie({
    appKey: KEY,
    appSecret: SECRET,
    escrita: 'liberada',
    fetch: sim.fetch,
    sleep: async (ms) => {
      esperas.push(ms)
      relogio += ms
    },
    now: () => relogio,
    ...extra,
  })
  return { c, sim, esperas }
}

test('método fora da lista fechada lança erro e não toca a rede', async () => {
  const { c, sim } = cliente([])
  for (const m of ['ExcluirContaPagar', 'AlterarContaPagar', 'LancarPagamento', 'IncluirCliente', 'ListarClientes', 'constructor', '']) {
    await assert.rejects(
      () => c.chamar(m, {}),
      (e: any) => e instanceof ErroOmie && e.tipo === 'METODO_NEGADO',
      m,
    )
  }
  assert.equal(sim.reqs.length, 0)
  assert.deepEqual(Object.keys(METODOS_PERMITIDOS).sort(), ['ConsultarContaPagar', 'IncluirContaPagar', 'ListarDepartamentos', 'ListarEmpresas'])
})

test('IncluirContaPagar sem OMIE_ESCRITA=liberada lança erro e não toca a rede', async () => {
  for (const escrita of [undefined, null, '', 'LIBERADA', 'true', 'sim']) {
    const { c, sim } = cliente([{ corpo: { codigo_lancamento_omie: 1 } }], { escrita })
    await assert.rejects(
      () => c.incluirContaPagar({ codigo_lancamento_integracao: 'X' }),
      (e: any) => e instanceof ErroOmie && e.tipo === 'ESCRITA_DESLIGADA',
      String(escrita),
    )
    assert.equal(sim.reqs.length, 0)
  }
  // leituras continuam funcionando sem a trava
  const { c, sim } = cliente([{ corpo: { departamentos: [], total_de_paginas: 1 } }], { escrita: undefined })
  assert.deepEqual(await c.listarDepartamentos(), [])
  assert.equal(sim.reqs.length, 1)
})

test('IncluirContaPagar liberado envia o envelope certo', async () => {
  const { c, sim } = cliente([{ corpo: { codigo_lancamento_omie: 987654, codigo_status: '0' } }])
  const r = await c.incluirContaPagar({ codigo_lancamento_integracao: 'RATEIO-P-202609-1' })
  assert.equal(r.codigo_lancamento_omie, 987654)
  assert.equal(sim.reqs[0].url, 'https://app.omie.com.br/api/v1/financas/contapagar/')
  assert.equal(sim.reqs[0].corpo.call, 'IncluirContaPagar')
  assert.equal(sim.reqs[0].corpo.app_key, KEY)
  assert.deepEqual(sim.reqs[0].corpo.param, [{ codigo_lancamento_integracao: 'RATEIO-P-202609-1' }])
})

test('REDUNDANT: espera com backoff e repete até dar certo', async () => {
  const redundant = { corpo: { faultstring: 'ERROR: REDUNDANT - consumo redundante detectado' } }
  const { c, sim, esperas } = cliente([redundant, redundant, { corpo: { codigo_lancamento_omie: 5 } }])
  const r = await c.consultarContaPagar('RATEIO-P-202609-1')
  assert.deepEqual(r, { existe: true, codigo_lancamento_omie: 5, resposta: { codigo_lancamento_omie: 5 } })
  assert.equal(sim.reqs.length, 3)
  // esperas de backoff da 2ª e 3ª tentativas presentes, na ordem
  const backoffs = esperas.filter((e) => e >= 1000)
  assert.deepEqual(backoffs, [BACKOFF_MS[1], BACKOFF_MS[2]])
})

test('REDUNDANT sem parar: esgota as tentativas e falha com ESGOTADO', async () => {
  const redundant = { corpo: { faultstring: 'REDUNDANT' } }
  const { c, sim, esperas } = cliente(Array.from({ length: 5 }, () => redundant))
  await assert.rejects(
    () => c.consultarContaPagar('X'),
    (e: any) => e instanceof ErroOmie && e.tipo === 'ESGOTADO',
  )
  assert.equal(sim.reqs.length, BACKOFF_MS.length)
  assert.deepEqual(esperas.filter((e) => e >= 1000), [1000, 3000, 6000, 10000])
  assert.ok(BACKOFF_MS.reduce((a, b) => a + b, 0) <= 20000, 'backoff de leitura soma até 20 s')
})

test('HTTP 425 aborta na hora, sem retry', async () => {
  const { c, sim, esperas } = cliente([{ status: 425, texto: '' }, { corpo: { codigo_lancamento_omie: 1 } }])
  await assert.rejects(
    () => c.consultarContaPagar('X'),
    (e: any) => e instanceof ErroOmie && e.tipo === 'BLOQUEIO_425',
  )
  assert.equal(sim.reqs.length, 1)
  assert.equal(esperas.filter((e) => e >= 1000).length, 0)
})

test('intervalo mínimo de 300 ms entre chamadas do mesmo método', async () => {
  const { c, esperas } = cliente([
    { corpo: { departamentos: [], total_de_paginas: 1 } },
    { corpo: { departamentos: [], total_de_paginas: 1 } },
  ])
  await c.listarDepartamentos()
  await c.listarDepartamentos()
  assert.ok(esperas.some((e) => e > 0 && e <= 300), `esperas: ${esperas}`)
})

test('"Não existe" no ConsultarContaPagar só pelo padrão explícito; outras falhas são erro', async () => {
  // Mensagem que bate no padrão A CONFIRMAR: existe=false
  const msg = 'ERROR: Lançamento não cadastrado para o Código de Integração [X]!'
  assert.ok(PADRAO_CONTA_NAO_EXISTE.test(msg))
  const a = cliente([{ corpo: { faultstring: msg } }])
  assert.deepEqual(await a.c.consultarContaPagar('X'), { existe: false })

  // "Não existem registros" genérico NÃO vale como "conta não existe"
  const b = cliente([{ corpo: { faultstring: 'Não existem registros para a página [1]!' } }])
  await assert.rejects(
    () => b.c.consultarContaPagar('X'),
    (e: any) => e instanceof ErroOmie && e.tipo === 'NEGOCIO',
  )
  // erro qualquer também
  const c = cliente([{ corpo: { faultstring: 'Credenciais inválidas' } }])
  await assert.rejects(() => c.c.consultarContaPagar('X'), (e: any) => e instanceof ErroOmie && e.tipo === 'NEGOCIO')
  // 200 sem código: inesperado, não "existe"
  const d = cliente([{ corpo: {} }])
  await assert.rejects(() => d.c.consultarContaPagar('X'), (e: any) => e.tipo === 'RESPOSTA_INESPERADA')
})

test('erro de negócio não repete', async () => {
  const { c, sim } = cliente([{ corpo: { faultstring: 'Parâmetro inválido' } }, { corpo: { codigo_lancamento_omie: 1 } }])
  await assert.rejects(() => c.incluirContaPagar({ a: 1 }), (e: any) => e.tipo === 'NEGOCIO')
  assert.equal(sim.reqs.length, 1)
})

test('falha de rede: leitura repete; escrita NÃO repete e vira REDE_INCERTA', async () => {
  const leitura = cliente([{ erroRede: true }, { corpo: { codigo_lancamento_omie: 3 } }])
  const r = await leitura.c.consultarContaPagar('X')
  assert.equal((r as any).codigo_lancamento_omie, 3)
  assert.equal(leitura.sim.reqs.length, 2)

  const escrita = cliente([{ erroRede: true }, { corpo: { codigo_lancamento_omie: 3 } }])
  await assert.rejects(() => escrita.c.incluirContaPagar({ a: 1 }), (e: any) => e.tipo === 'REDE_INCERTA')
  assert.equal(escrita.sim.reqs.length, 1)

  const ilegivel = cliente([{ texto: '<html>502</html>' }, { corpo: { codigo_lancamento_omie: 3 } }])
  await assert.rejects(() => ilegivel.c.incluirContaPagar({ a: 1 }), (e: any) => e.tipo === 'REDE_INCERTA')
  assert.equal(ilegivel.sim.reqs.length, 1)
})

test('listagens: "não existem registros" é vazio legítimo, páginas são percorridas e inativos saem', async () => {
  const vazio = cliente([{ corpo: { faultstring: 'Não existem registros para a página [1]!' } }])
  assert.deepEqual(await vazio.c.listarDepartamentos(), [])

  const pag = cliente([
    { corpo: { total_de_paginas: 2, departamentos: [{ codigo: 1, descricao: 'A', inativo: 'N' }, { codigo: 2, descricao: 'B', inativo: 'S' }] } },
    { corpo: { total_de_paginas: 2, departamentos: [{ codigo: 3, descricao: 'C', inativo: 'N' }] } },
  ])
  assert.deepEqual(await pag.c.listarDepartamentos(), [{ cod: 1, nome: 'A' }, { cod: 3, nome: 'C' }])
  assert.equal(pag.sim.reqs[1].corpo.param[0].pagina, 2)

  const emp = cliente([{ corpo: { total_de_paginas: 1, empresas_cadastro: [{ cnpj: '12.345.678/0001-99', razao_social: 'X' }] } }])
  assert.deepEqual(await emp.c.listarEmpresas(), [{ cnpj: '12.345.678/0001-99', razao: 'X' }])
})

test('log de tentativa (antes/depois) nunca leva app_key nem app_secret', async () => {
  const log: Tentativa[] = []
  // Pior caso: o payload e a resposta do Omie até repetem as credenciais.
  const { c } = cliente(
    [{ corpo: { codigo_lancamento_omie: 11, eco: `chave ${KEY} segredo ${SECRET}` } }],
    {
      onTentativa: (t: Tentativa) => {
        log.push(JSON.parse(JSON.stringify(t)))
        return t.fase === 'antes' ? 'id-1' : null
      },
    },
  )
  await c.incluirContaPagar({ codigo_lancamento_integracao: 'X', observacao: `teste ${SECRET}`, app_key: KEY, app_secret: SECRET })
  assert.equal(log.length, 2)
  assert.equal(log[0].fase, 'antes')
  assert.equal(log[0].call, 'IncluirContaPagar')
  assert.equal(log[1].fase, 'depois')
  assert.equal(log[1].ctx, 'id-1')
  assert.equal(log[1].http_status, 200)
  const texto = JSON.stringify(log)
  assert.ok(!texto.includes(KEY), 'app_key vazou no log')
  assert.ok(!texto.includes(SECRET), 'app_secret vazou no log')
  assert.ok(!/app_key|app_secret/.test(texto), 'campos de credencial no log')
})

test('log de erro também sai sem segredo, e a falha do log "depois" não mascara o resultado', async () => {
  const log: Tentativa[] = []
  const { c } = cliente([{ corpo: { faultstring: `Credencial ${SECRET} inválida` } }], {
    onTentativa: (t: Tentativa) => {
      log.push(JSON.parse(JSON.stringify(t)))
      if (t.fase === 'depois') throw new Error('banco fora do ar')
      return 1
    },
  })
  await assert.rejects(() => c.consultarContaPagar('X'), (e: any) => e.tipo === 'NEGOCIO')
  assert.ok(!JSON.stringify(log).includes(SECRET))
  assert.match(String(log[1].erro), /REDIGIDO/)
})

test('falha no log "antes" aborta a chamada sem enviar nada', async () => {
  const { c, sim } = cliente([{ corpo: { codigo_lancamento_omie: 1 } }], {
    onTentativa: () => {
      throw new Error('log indisponível')
    },
  })
  await assert.rejects(() => c.incluirContaPagar({ a: 1 }), /log indisponível/)
  assert.equal(sim.reqs.length, 0)
})

test('conferirCredenciais detecta key e secret trocados', () => {
  assert.equal(conferirCredenciais('PRN', KEY, SECRET), null)
  assert.match(String(conferirCredenciais('MEDIMAGEM', SECRET, KEY)), /trocados/)
  assert.equal(conferirCredenciais('PRN', 'abc', 'def'), null) // forma estranha isolada passa
})

test('REDUNDANT na escrita = 1 envio só, resultado incerto, sem espera de retry', async () => {
  const { c, sim, esperas } = cliente([
    { corpo: { faultstring: 'ERROR: REDUNDANT - consumo redundante detectado' } },
    { corpo: { codigo_lancamento_omie: 9 } },
    { corpo: { codigo_lancamento_omie: 9 } },
  ])
  await assert.rejects(
    () => c.incluirContaPagar({ codigo_lancamento_integracao: 'X' }),
    (e: any) => e instanceof ErroOmie && e.tipo === 'REDE_INCERTA' && /REDUNDANT/.test(e.message),
  )
  assert.equal(sim.reqs.length, 1, 'IncluirContaPagar não pode ser reenviado')
  assert.equal(esperas.filter((e) => e >= 1000).length, 0)
})

test('425 na escrita: 1 envio só, sem retry', async () => {
  const { c, sim } = cliente([{ status: 425, texto: '' }, { corpo: { codigo_lancamento_omie: 1 } }])
  await assert.rejects(() => c.incluirContaPagar({ a: 1 }), (e: any) => e.tipo === 'BLOQUEIO_425')
  assert.equal(sim.reqs.length, 1)
})

test('ListarDepartamentos sem o campo de inatividade reconhecido falha fechada (FORMATO_OMIE_INESPERADO)', async () => {
  const sem = cliente([{ corpo: { total_de_paginas: 1, departamentos: [{ codigo: 1, descricao: 'A' }] } }])
  await assert.rejects(() => sem.c.listarDepartamentos(), (e: any) => e instanceof ErroOmie && e.tipo === 'FORMATO_OMIE_INESPERADO')
  const estranho = cliente([{ corpo: { total_de_paginas: 1, departamentos: [{ codigo: 1, descricao: 'A', inativo: 'talvez' }] } }])
  await assert.rejects(() => estranho.c.listarDepartamentos(), (e: any) => e.tipo === 'FORMATO_OMIE_INESPERADO')
})

test('ErroOmie.message e faultstring saem sem segredo', async () => {
  const { c } = cliente([{ corpo: { faultstring: `chave ${KEY} e segredo ${SECRET} rejeitados` } }])
  await assert.rejects(
    () => c.incluirContaPagar({ a: 1 }),
    (e: any) => !e.message.includes(SECRET) && !e.message.includes(KEY) && !String(e.faultstring).includes(SECRET) && /REDIGIDO/.test(e.message),
  )
})
