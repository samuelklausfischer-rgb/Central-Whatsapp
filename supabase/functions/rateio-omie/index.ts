import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Edge Function `rateio-omie` (projeto Supabase FINANCEIRO, verify_jwt = true).
// Contrato: docs/rateio-omie/CONTRATO.md. Ações: analisar | lancar | vincular | departamentos.
// Sem ExcluirContaPagar: desfazer é manual, com aprovação humana.

import {
  analisarNucleo,
  chave,
  chaveIntegracao,
  competenciaParaData,
  contaOmieDaEmpresa,
  empresaValida,
  ENVIANDO_ORFAO_MS,
  ErroEntrada,
  escolherLancamentoRelevante,
  hashAnalise,
  montarPayloadIncluir,
} from '../_shared/rateio-omie/nucleo.ts'
import type { Analise, ConfigEmpresa, Empresa, EntradaAnalise } from '../_shared/rateio-omie/nucleo.ts'
import { conferirCredenciais, criarClienteOmie, ErroOmie, redigir } from '../_shared/rateio-omie/omie.ts'
import type { ClienteOmie, Tentativa } from '../_shared/rateio-omie/omie.ts'
import { executarLancamento } from '../_shared/rateio-omie/lancar.ts'
import type { RepoLancamentos } from '../_shared/rateio-omie/lancar.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Limite de 300 ms por método, compartilhado entre requisições do mesmo isolate.
const ultimaChamadaOmie = new Map<string, number>()

async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// Banco (PostgREST com service role; sem dependências externas, como nas outras funções)
// ---------------------------------------------------------------------------

type RespDb = { status: number; body: any }

async function db(
  metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  caminho: string,
  corpo?: unknown,
  prefer?: string,
): Promise<RespDb> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SERVICE_KEY}`,
    apikey: SERVICE_KEY,
  }
  if (prefer) headers.Prefer = prefer
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  const txt = await r.text()
  let body: any = null
  try {
    body = txt ? JSON.parse(txt) : null
  } catch {
    body = txt
  }
  return { status: r.status, body }
}

function exigir(r: RespDb, onde: string): any {
  if (r.status >= 200 && r.status < 300) return r.body
  const msg = typeof r.body === 'object' && r.body ? (r.body.message ?? JSON.stringify(r.body)) : String(r.body)
  throw new Error(`${onde}: ${String(msg).slice(0, 300)}`)
}

const enc = encodeURIComponent

/** Remove de um texto qualquer credencial Omie conhecida (as duas contas). */
function redigirSegredos(texto: string): string {
  const segredos = ['PRN', 'MEDIMAGEM'].flatMap((c) => [Deno.env.get(`APP_KEY_OMIE_${c}`) || '', Deno.env.get(`APP_SECRET_OMIE_${c}`) || ''])
  return String(redigir(texto, segredos))
}

// ---------------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------------

type Chamador = { id: string; email: string | null }

async function verificarChamador(authHeader: string): Promise<Chamador | Response> {
  if (!authHeader) return json({ ok: false, erro: 'Authorization header required' }, 401)
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SERVICE_KEY },
  })
  if (!r.ok) return json({ ok: false, erro: 'Invalid session' }, 401)
  const u = await r.json().catch(() => null)
  if (!u?.id) return json({ ok: false, erro: 'Invalid session' }, 401)
  const aut = await db('GET', `rateio_omie_autorizados?user_id=eq.${enc(u.id)}&select=user_id&limit=1`)
  const lista = exigir(aut, 'autorizados')
  if (!Array.isArray(lista) || lista.length === 0) {
    return json({ ok: false, erro: 'Usuário sem autorização para o rateio Omie' }, 403)
  }
  return { id: u.id, email: u.email ?? null }
}

// ---------------------------------------------------------------------------
// Omie por empresa
// ---------------------------------------------------------------------------

function clienteOmie(empresa: Empresa, onTentativa?: (t: Tentativa) => unknown | Promise<unknown>): ClienteOmie {
  const conta = contaOmieDaEmpresa(empresa) // PRN_APICE -> PRN; MEDIMAGEM_APICE -> MEDIMAGEM
  const key = Deno.env.get(`APP_KEY_OMIE_${conta}`) || ''
  const secret = Deno.env.get(`APP_SECRET_OMIE_${conta}`) || ''
  if (!key || !secret) {
    throw new ErroEntrada(`Credenciais da conta Omie ${conta} ausentes (APP_KEY_OMIE_${conta} / APP_SECRET_OMIE_${conta}).`)
  }
  const troca = conferirCredenciais(conta, key, secret)
  if (troca) throw new ErroEntrada(troca)
  return criarClienteOmie({
    appKey: key,
    appSecret: secret,
    escrita: Deno.env.get('OMIE_ESCRITA'),
    fetch: (url, init) => fetch(url, init),
    ultimaChamada: ultimaChamadaOmie,
    onTentativa,
  })
}

// ---------------------------------------------------------------------------
// Análise (compartilhada por analisar e lancar)
// ---------------------------------------------------------------------------

type EntradaHttp = EntradaAnalise & { execucao_id: string; hash?: string }

function lerEntrada(b: any): EntradaHttp {
  if (!RE_UUID.test(String(b?.execucao_id ?? ''))) throw new ErroEntrada('execucao_id inválido')
  const valor = Number(b?.valor_nf)
  if (!Number.isFinite(valor)) throw new ErroEntrada('valor_nf inválido')
  return {
    execucao_id: String(b.execucao_id),
    empresa: '', // vem da execução
    nf: String(b?.nf ?? ''),
    valor_nf: valor,
    competencia: String(b?.competencia ?? ''),
    emissao: String(b?.emissao ?? ''),
    vencimento: b?.vencimento ? String(b.vencimento) : null,
    conta_corrente: b?.conta_corrente ?? null,
    hash: b?.hash ? String(b.hash) : undefined,
  }
}

type Contexto = { analise: Analise; config: ConfigEmpresa | null; execucao_id: string }

async function analisar(entrada: EntradaHttp, quem: Chamador): Promise<Contexto> {
  const ex = exigir(await db('GET', `dash_rateio_execucoes?id=eq.${enc(entrada.execucao_id)}&select=*&limit=1`), 'execucao')
  const execucao = Array.isArray(ex) ? ex[0] : null
  if (!execucao) throw new ErroEntrada('Execução não encontrada')
  const empresa = execucao.empresa
  if (!empresaValida(empresa)) throw new ErroEntrada(`Empresa da execução inválida: ${empresa}`)
  const competenciaData = competenciaParaData(entrada.competencia)

  const cfgR = exigir(await db('GET', `rateio_omie_config?empresa=eq.${enc(empresa)}&select=*&limit=1`), 'config')
  const config: ConfigEmpresa | null = Array.isArray(cfgR) && cfgR[0] ? cfgR[0] : null
  if (config && config.conta_omie !== contaOmieDaEmpresa(empresa)) {
    throw new ErroEntrada(`rateio_omie_config.conta_omie (${config.conta_omie}) não confere com a empresa ${empresa}`)
  }
  const mapa = exigir(await db('GET', `rateio_omie_mapa?empresa=eq.${enc(empresa)}&select=*`), 'mapa')
  // Todos os lançamentos da empresa na competência (poucos): o da mesma chave vale em qualquer
  // status; senão, um ativo de outra NF (o índice único parcial impediria um segundo).
  const lancR = exigir(
    await db(
      'GET',
      `rateio_omie_lancamentos?empresa=eq.${enc(empresa)}&competencia=eq.${competenciaData}` +
        `&select=chave_integracao,status,omie_codigo_lancamento,criado_em,atualizado_em`,
    ),
    'lancamentos',
  )
  const chaveAtual = entrada.nf.replace(/[^0-9A-Za-z]/g, '')
    ? chaveIntegracao(empresa, entrada.competencia, entrada.nf)
    : ''
  const jaLancado = escolherLancamentoRelevante(Array.isArray(lancR) ? lancR : [], chaveAtual)

  // Lançamentos ativos da empresa (qualquer competência) e da execução: NF_JA_LANCADA / EXECUCAO_JA_LANCADA.
  const ativosEmpresa = exigir(
    await db(
      'GET',
      `rateio_omie_lancamentos?empresa=eq.${enc(empresa)}&status=in.(enviando,lancado,incerto)` +
        `&select=chave_integracao,nf,execucao_id,status,criado_em,atualizado_em`,
    ),
    'lancamentos ativos',
  )
  const ativosExecucao = exigir(
    await db(
      'GET',
      `rateio_omie_lancamentos?execucao_id=eq.${enc(entrada.execucao_id)}&status=in.(enviando,lancado,incerto)` +
        `&select=chave_integracao,nf,execucao_id,status,criado_em,atualizado_em`,
    ),
    'lancamentos da execucao',
  )
  const lancamentosAtivos = new Map<string, any>()
  for (const l of [...(Array.isArray(ativosEmpresa) ? ativosEmpresa : []), ...(Array.isArray(ativosExecucao) ? ativosExecucao : [])]) {
    lancamentosAtivos.set(l.chave_integracao, l)
  }

  let departamentosAtivos: number[] | null = null
  let cnpjsOmie: string[] | null = null
  if (config) {
    const omie = clienteOmie(empresa)
    departamentosAtivos = (await omie.listarDepartamentos()).map((d) => d.cod)
    cnpjsOmie = (await omie.listarEmpresas()).map((e) => e.cnpj)
  }

  const tetoNum = Number(Deno.env.get('RATEIO_OMIE_TETO'))
  const base = analisarNucleo(
    { ...entrada, empresa },
    {
      execucao: {
        criado_por: execucao.criado_por,
        linhas: execucao.linhas,
        total_geral: execucao.total_geral,
        pendencias: execucao.pendencias,
      },
      mapa: Array.isArray(mapa) ? mapa : [],
      config,
      departamentosAtivos,
      cnpjsOmie,
      jaLancado,
      lancamentosAtivos: [...lancamentosAtivos.values()],
      usuarioId: quem.id,
      agora: Date.now(),
      teto: Number.isFinite(tetoNum) && tetoNum > 0 ? tetoNum : null,
    },
  )
  const hash = await hashAnalise(base, sha256Hex, config)
  return { analise: { ...base, hash }, config, execucao_id: entrada.execucao_id }
}

// ---------------------------------------------------------------------------
// lancar (a sequência está em _shared/rateio-omie/lancar.ts; aqui só o banco real)
// ---------------------------------------------------------------------------

const ok2xx = (r: RespDb) => r.status >= 200 && r.status < 300

function repoPostgrest(userId: string): RepoLancamentos {
  const agora = () => new Date().toISOString()
  return {
    async buscarPorChave(chaveInt) {
      const r = exigir(
        await db('GET', `rateio_omie_lancamentos?chave_integracao=eq.${enc(chaveInt)}&select=id,status,criado_em,atualizado_em&limit=1`),
        'lancamento anterior',
      )
      return Array.isArray(r) && r[0]
        ? { id: r[0].id, status: r[0].status, criado_em: r[0].criado_em, atualizado_em: r[0].atualizado_em }
        : null
    },
    async inserir(registro) {
      const r = await db('POST', 'rateio_omie_lancamentos', registro, 'return=representation')
      if (ok2xx(r) && Array.isArray(r.body) && r.body[0]?.id) return { ok: true, id: r.body[0].id }
      if (r.status === 409 || r.body?.code === '23505') return { ok: false, conflito: true }
      exigir(r, 'insert lancamento')
      throw new Error('insert lancamento: resposta inesperada')
    },
    async reaproveitar(id, registro, opcoes) {
      // Troca condicional: se outro clique já levou a linha para 'enviando'/'lancado', afeta 0 linhas.
      // `enviando` só entra se órfão (mais de 10 min sem atualização). Não zera omie_codigo_lancamento.
      const corte = new Date(Date.now() - ENVIANDO_ORFAO_MS).toISOString()
      const filtro = opcoes?.aceitaEnviandoOrfao
        ? `or=(status.in.(incerto,erro,excluido),and(status.eq.enviando,or(atualizado_em.lt.${corte},and(atualizado_em.is.null,criado_em.lt.${corte}))))`
        : 'status=in.(incerto,erro,excluido)'
      const r = await db(
        'PATCH',
        `rateio_omie_lancamentos?id=eq.${enc(id)}&${filtro}`,
        { ...registro, atualizado_em: agora() },
        'return=representation',
      )
      if (r.status === 409 || r.body?.code === '23505') return null // outra NF ativa na competência
      exigir(r, 'reaproveitar lancamento')
      return Array.isArray(r.body) && r.body[0]?.id ? r.body[0].id : null
    },
    async marcar(id, status, extra = {}) {
      exigir(
        await db('PATCH', `rateio_omie_lancamentos?id=eq.${enc(id)}`, { status, atualizado_em: agora(), ...extra }, 'return=minimal'),
        `marcar ${status}`,
      )
    },
    async apagarEnviando(id) {
      // tentativas.lancamento_id é "on delete set null": o histórico de chamadas fica.
      await db('DELETE', `rateio_omie_lancamentos?id=eq.${enc(id)}&status=eq.enviando`, undefined, 'return=minimal')
    },
    async tentativaAntes(lancamentoId, call, payload) {
      const r = exigir(
        await db('POST', 'rateio_omie_tentativas', { lancamento_id: lancamentoId, call, payload, criado_por: userId }, 'return=representation'),
        'tentativa antes',
      )
      return Array.isArray(r) ? r[0]?.id : null
    },
    async tentativaDepois(tentativaId, d) {
      await db('PATCH', `rateio_omie_tentativas?id=eq.${enc(String(tentativaId))}`, d, 'return=minimal')
    },
  }
}

async function lancar(entrada: EntradaHttp, quem: Chamador): Promise<Record<string, unknown>> {
  if (!entrada.hash) throw new ErroEntrada('hash obrigatório')
  const { analise, config } = await analisar(entrada, quem)
  if (analise.bloqueios.length > 0) return { ok: false, motivo: 'BLOQUEADO', analise }
  if (entrada.hash !== analise.hash) return { ok: false, motivo: 'HASH_MUDOU', analise }
  if (!config) return { ok: false, motivo: 'BLOQUEADO', analise } // inalcançável: CONFIG_AUSENTE já bloqueia

  const payload = montarPayloadIncluir(analise, config)
  return await executarLancamento({
    chaveIntegracao: analise.chave,
    registro: {
      execucao_id: entrada.execucao_id,
      empresa: analise.empresa,
      competencia: competenciaParaData(analise.cabecalho.competencia),
      nf: analise.cabecalho.nf,
      valor_nf: analise.valor_nf,
      emissao: analise.cabecalho.emissao,
      vencimento: analise.cabecalho.vencimento,
      conta_corrente: analise.cabecalho.conta_corrente,
      chave_integracao: analise.chave,
      distribuicao: payload.distribuicao,
      ajuste: analise.ajuste,
      hash_analise: analise.hash,
      status: 'enviando',
      criado_por: quem.id,
      atualizado_em: new Date().toISOString(),
    },
    payload: payload as unknown as Record<string, unknown>,
    repo: repoPostgrest(quem.id),
    criarOmie: (onTentativa) => clienteOmie(analise.empresa, onTentativa),
    redigirTexto: redigirSegredos,
  })
}

// ---------------------------------------------------------------------------
// vincular / departamentos
// ---------------------------------------------------------------------------

async function departamentos(b: any): Promise<Record<string, unknown>> {
  if (!empresaValida(b?.empresa)) throw new ErroEntrada('empresa inválida')
  const lista = await clienteOmie(b.empresa).listarDepartamentos()
  return { ok: true, departamentos: lista }
}

async function vincular(b: any, quem: Chamador): Promise<Record<string, unknown>> {
  if (!empresaValida(b?.empresa)) throw new ErroEntrada('empresa inválida')
  const unidade = String(b?.unidade ?? '').trim()
  if (!unidade) throw new ErroEntrada('unidade obrigatória')
  const cod = Number(b?.cod_departamento)
  if (!Number.isFinite(cod) || cod <= 0) throw new ErroEntrada('cod_departamento inválido')

  const lista = await clienteOmie(b.empresa).listarDepartamentos()
  const dep = lista.find((d) => d.cod === cod)
  if (!dep) return { ok: false, erro: `Departamento ${cod} não está ativo no Omie desta empresa.` }

  exigir(
    await db(
      'POST',
      'rateio_omie_mapa?on_conflict=empresa,unidade_chave',
      {
        empresa: b.empresa,
        unidade,
        unidade_chave: chave(unidade),
        cod_departamento: cod,
        departamento_nome: dep.nome,
        confianca: 'ALTA',
        origem: 'tela',
        atualizado_por: quem.id,
        atualizado_em: new Date().toISOString(),
      },
      'resolution=merge-duplicates,return=minimal',
    ),
    'vincular',
  )
  return { ok: true, departamento_nome: dep.nome }
}

// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, erro: 'method not allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, erro: 'Supabase environment not configured' }, 500)

  try {
    const quem = await verificarChamador(req.headers.get('Authorization') || '')
    if (quem instanceof Response) return quem

    const b = await req.json().catch(() => null)
    if (!b || typeof b !== 'object') return json({ ok: false, erro: 'JSON inválido' })

    switch (b.acao) {
      case 'analisar': {
        const { analise } = await analisar(lerEntrada(b), quem)
        return json({ ok: true, ...analise })
      }
      case 'lancar':
        return json(await lancar(lerEntrada(b), quem))
      case 'vincular':
        return json(await vincular(b, quem))
      case 'departamentos':
        return json(await departamentos(b))
      default:
        return json({ ok: false, erro: `acao inválida: ${String(b.acao)}` })
    }
  } catch (e) {
    const bruta = e instanceof Error ? e.message : 'Unexpected error'
    if (e instanceof ErroOmie && e.tipo === 'FORMATO_OMIE_INESPERADO') {
      console.error(JSON.stringify({ scope: 'rateio_omie', stage: 'formato_omie_inesperado', detalhe: redigirSegredos(bruta).slice(0, 300) }))
      return json({ ok: false, erro: 'FORMATO_OMIE_INESPERADO' })
    }
    const msg = redigirSegredos(bruta)
    if (!(e instanceof ErroEntrada) && !(e instanceof ErroOmie)) {
      console.error(JSON.stringify({ scope: 'rateio_omie', stage: 'erro_inesperado', message: msg.slice(0, 300) }))
    }
    return json({ ok: false, erro: msg })
  }
})
