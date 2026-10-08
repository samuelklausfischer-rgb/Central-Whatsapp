// Cliente Omie do rateio: lista fechada de métodos, trava de escrita, backoff e log sem segredo.
// Sem Deno e sem rede própria: o `fetch` é injetado (testes usam um Omie simulado).
// Disciplina portada de prn-otimus-omie-worker/lib/{omie,escrita}.mjs.
// Só sintaxe apagável (Node roda este arquivo por type stripping).

export const OMIE_BASE = 'https://app.omie.com.br/api/v1'

/** Lista FECHADA. Qualquer outro método lança erro antes de tocar a rede. */
export const METODOS_PERMITIDOS: Readonly<Record<string, string>> = Object.freeze({
  ConsultarContaPagar: 'financas/contapagar/',
  IncluirContaPagar: 'financas/contapagar/',
  ListarDepartamentos: 'geral/departamentos/',
  ListarEmpresas: 'geral/empresas/',
})

/** Métodos que escrevem no Omie (exigem OMIE_ESCRITA=liberada). */
const METODOS_ESCRITA: readonly string[] = ['IncluirContaPagar']

export const VARIAVEL_ESCRITA = 'OMIE_ESCRITA'
export const VALOR_LIBERADO = 'liberada'

export const INTERVALO_MIN_MS = 300
/** Só para LEITURAS: soma 20 s, para caber no limite da Edge Function. Escrita nunca repete. */
export const BACKOFF_MS: readonly number[] = [0, 1000, 3000, 6000, 10000]
export const TIMEOUT_MS = 30000

/** "Não existem registros" em listagens = resposta vazia legítima (como no worker). */
export const PADRAO_LISTAGEM_VAZIA = /n[ãa]o (existem|foram encontrados)/i

/**
 * A CONFIRMAR com resposta real do Omie.
 *
 * Mensagem (faultstring) que o ConsultarContaPagar devolve quando NÃO existe conta com o
 * codigo_lancamento_integracao informado. É um palpite ainda não visto numa resposta real.
 * Só ESTE padrão conta como "não existe"; qualquer outra falha é erro (falha fechada: no
 * pior caso o lançamento termina em `erro` e ninguém inclui por engano).
 * Antes da primeira inclusão de verdade: consultar uma chave inexistente e copiar o texto exato.
 */
export const PADRAO_CONTA_NAO_EXISTE = /lan[cç]amento n[ãa]o cadastrado/i

export type TipoErroOmie =
  | 'METODO_NEGADO'
  | 'ESCRITA_DESLIGADA'
  | 'BLOQUEIO_425'
  | 'NEGOCIO'
  | 'REDE_INCERTA'
  | 'ESGOTADO'
  | 'RESPOSTA_INESPERADA'
  | 'FORMATO_OMIE_INESPERADO'

export class ErroOmie extends Error {
  tipo: TipoErroOmie
  faultstring: string | null
  constructor(tipo: TipoErroOmie, mensagem: string, faultstring: string | null = null) {
    super(mensagem)
    this.name = 'ErroOmie'
    this.tipo = tipo
    this.faultstring = faultstring
  }
}

export type Tentativa = {
  fase: 'antes' | 'depois'
  call: string
  /** param[0] enviado, SEM app_key/app_secret. */
  payload: unknown
  /** Só em 'depois'. */
  http_status?: number | null
  resposta?: unknown
  erro?: string | null
  tentativas?: number
  /** Valor devolvido pelo callback na fase 'antes' (ex.: id da linha de log). */
  ctx?: unknown
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; text: () => Promise<string> }>

export type OpcoesCliente = {
  appKey: string
  appSecret: string
  /** Valor de OMIE_ESCRITA; só 'liberada' habilita IncluirContaPagar. */
  escrita?: string | null
  fetch: FetchLike
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Compartilhável entre clientes do mesmo isolate para respeitar 300 ms por método. */
  ultimaChamada?: Map<string, number>
  intervaloMs?: number
  backoffMs?: readonly number[]
  timeoutMs?: number
  /** Chamado antes e depois de CADA chamada ao Omie. O retorno de 'antes' volta em 'depois' (ctx). */
  onTentativa?: (t: Tentativa) => unknown | Promise<unknown>
}

const dormirReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Cópia profunda sem app_key/app_secret e sem os valores das credenciais em qualquer string. */
export function redigir(valor: unknown, segredos: string[] = []): unknown {
  const sec = segredos.filter((s) => s && s.length >= 4)
  const limpa = (v: unknown): unknown => {
    if (typeof v === 'string') {
      let s = v
      for (const x of sec) s = s.split(x).join('[REDIGIDO]')
      return s
    }
    if (v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map(limpa)
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (/^app_(key|secret)$/i.test(k)) continue
      out[k] = limpa(val)
    }
    return out
  }
  return limpa(valor)
}

/**
 * Confere se key/secret não estão TROCADOS um pelo outro (aconteceu com a MedImagem em 03/09/2026).
 * Na Omie a app_key é um número e o app_secret é hexadecimal com letras. Só a inversão é erro;
 * forma estranha isolada passa (recusar credencial válida é pior). Devolve a mensagem ou null.
 */
export function conferirCredenciais(conta: string, key: string, secret: string): string | null {
  const pareceKey = (v: string) => /^[0-9]{6,}$/.test(v)
  const pareceSecret = (v: string) => /^[0-9a-f]{24,}$/i.test(v) && !/^[0-9]+$/.test(v)
  if (pareceSecret(key) && pareceKey(secret)) {
    return `APP_KEY_OMIE_${conta} e APP_SECRET_OMIE_${conta} parecem trocados um pelo outro; inverta os dois.`
  }
  return null
}

export function criarClienteOmie(op: OpcoesCliente) {
  const sleep = op.sleep ?? dormirReal
  const now = op.now ?? (() => Date.now())
  const ultima = op.ultimaChamada ?? new Map<string, number>()
  const intervalo = op.intervaloMs ?? INTERVALO_MIN_MS
  const backoff = op.backoffMs ?? BACKOFF_MS
  const timeout = op.timeoutMs ?? TIMEOUT_MS
  const segredos = [op.appKey, op.appSecret]

  const escritaLiberada = () => op.escrita === VALOR_LIBERADO

  async function chamar(
    call: string,
    param: Record<string, unknown>,
    opts: { vazioPadrao?: RegExp } = {},
  ): Promise<{ vazio: true; faultstring: string } | Record<string, unknown>> {
    // hasOwn: 'constructor', 'toString' etc. herdados do Object não podem passar como método.
    const endpoint = Object.prototype.hasOwnProperty.call(METODOS_PERMITIDOS, call) ? METODOS_PERMITIDOS[call] : undefined
    if (!endpoint) {
      throw new ErroOmie(
        'METODO_NEGADO',
        `método recusado: "${call}" não está na lista permitida (${Object.keys(METODOS_PERMITIDOS).join(', ')})`,
      )
    }
    const escrita = METODOS_ESCRITA.includes(call)
    if (escrita && !escritaLiberada()) {
      throw new ErroOmie('ESCRITA_DESLIGADA', `escrita recusada: defina ${VARIAVEL_ESCRITA}=${VALOR_LIBERADO} para permitir "${call}"`)
    }
    if (!param || typeof param !== 'object') throw new ErroOmie('METODO_NEGADO', `"${call}" sem parâmetro`)

    const payloadLog = redigir(param, segredos)
    const ctx = op.onTentativa ? await op.onTentativa({ fase: 'antes', call, payload: payloadLog }) : undefined

    let tentativas = 0
    let httpStatus: number | null = null
    const concluir = async (resposta: unknown, erro: string | null) => {
      if (op.onTentativa) {
        try {
          await op.onTentativa({
            fase: 'depois',
            call,
            payload: payloadLog,
            http_status: httpStatus,
            resposta: redigir(resposta, segredos),
            erro: erro ? String(redigir(erro, segredos)) : null,
            tentativas,
            ctx,
          })
        } catch {
          // O log de "depois" nunca pode mascarar o resultado real da chamada.
        }
      }
    }
    const falhar = async (e: ErroOmie, resposta: unknown = null): Promise<never> => {
      await concluir(resposta, e.message)
      throw e
    }
    // Toda mensagem de erro passa por redigir: nunca leva app_key/app_secret ao banco nem ao browser.
    const erro = (tipo: TipoErroOmie, msg: string, fault: string | null = null) =>
      new ErroOmie(tipo, String(redigir(msg, segredos)), fault === null ? null : String(redigir(fault, segredos)))

    // Escrita: UMA tentativa só, sem retry de nada (REDUNDANT, 425, timeout, rede). Leitura: backoff curto.
    const maxTentativas = escrita ? 1 : backoff.length
    for (let i = 0; i < maxTentativas; i++) {
      if (backoff[i] > 0) await sleep(backoff[i])

      const anterior = ultima.get(call) ?? 0
      const desde = now() - anterior
      if (anterior > 0 && desde < intervalo) await sleep(intervalo - desde)
      ultima.set(call, now())
      tentativas++

      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), timeout)
      let resp: { status: number; text: () => Promise<string> }
      let texto = ''
      try {
        resp = await op.fetch(`${OMIE_BASE}/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ call, app_key: op.appKey, app_secret: op.appSecret, param: [param] }),
          signal: ac.signal,
        })
        httpStatus = resp.status
        if (resp.status !== 425) texto = await resp.text()
        clearTimeout(timer)
      } catch (_e) {
        clearTimeout(timer)
        // Escrita nunca é reenviada depois de falha de rede/timeout: o Omie pode ter criado a conta.
        if (escrita) {
          return await falhar(
            erro('REDE_INCERTA', `Falha de rede/timeout em ${call}; resultado incerto, consulte o Omie antes de reenviar.`),
          )
        }
        continue
      }
      if (resp.status === 425) {
        return await falhar(
          erro('BLOQUEIO_425', 'HTTP 425: o Omie bloqueou o IP por excesso de erros. Parar e aguardar 30 minutos.'),
        )
      }

      let json: Record<string, unknown>
      try {
        json = JSON.parse(texto)
      } catch {
        if (escrita) {
          return await falhar(
            erro('REDE_INCERTA', `Resposta ilegível em ${call}; resultado incerto, consulte o Omie antes de reenviar.`),
          )
        }
        continue
      }

      if (json && typeof json === 'object' && json.faultstring) {
        const msg = String(json.faultstring)
        const vazio = opts.vazioPadrao
        if (vazio && vazio.test(msg)) {
          await concluir(json, null)
          return { vazio: true, faultstring: msg }
        }
        if (/REDUNDANT/i.test(msg)) {
          // Escrita: o Omie já viu esta requisição, então pode ter criado a conta. Não reenvia.
          if (escrita) {
            return await falhar(erro('REDE_INCERTA', `Omie [${call}]: resposta REDUNDANT; resultado incerto, consulte o Omie antes de reenviar.`), json)
          }
          // Leitura: REDUNDANT = cache de 60 s do Omie; vale esperar e repetir.
          continue
        }
        // Erro de negócio: repetir não adianta.
        return await falhar(erro('NEGOCIO', `Omie [${call}]: ${msg}`, msg), json)
      }

      await concluir(json, null)
      return json
    }

    return await falhar(erro('ESGOTADO', `Omie [${call}]: falhou após ${maxTentativas} tentativas.`))
  }

  /** Todas as páginas de uma listagem. `extrai` devolve o array da página. */
  async function paginar(
    call: string,
    extra: Record<string, unknown>,
    extrai: (j: Record<string, unknown>) => unknown[] | undefined,
  ): Promise<unknown[]> {
    const todos: unknown[] = []
    let pagina = 1
    let total = 1
    do {
      const j = await chamar(call, { pagina, registros_por_pagina: 100, ...extra }, { vazioPadrao: PADRAO_LISTAGEM_VAZIA })
      if ((j as { vazio?: boolean }).vazio) break
      todos.push(...(extrai(j as Record<string, unknown>) ?? []))
      total = Number((j as Record<string, unknown>).total_de_paginas ?? 1) || 1
      pagina++
    } while (pagina <= total && pagina <= 200)
    return todos
  }

  /** Departamentos ATIVOS. Forma da resposta (`departamentos[]`, `inativo`) A CONFIRMAR. */
  async function listarDepartamentos(): Promise<Array<{ cod: number; nome: string }>> {
    const regs = (await paginar('ListarDepartamentos', {}, (j) => j.departamentos as unknown[])) as Array<Record<string, unknown>>
    // Sem o campo de inatividade reconhecido não dá para saber quem está ativo: falha fechada.
    const reconhecido = (d: Record<string, unknown>) => typeof d?.inativo === 'string' && ['S', 'N'].includes(d.inativo.toUpperCase())
    if (regs.some((d) => !reconhecido(d))) {
      throw new ErroOmie('FORMATO_OMIE_INESPERADO', 'ListarDepartamentos veio sem o campo "inativo" (S/N) em algum registro.')
    }
    return regs
      .filter((d) => d.inativo !== 'S' && d.inativo !== 's')
      .map((d) => ({ cod: Number(d.codigo), nome: String(d.descricao ?? '') }))
  }

  /** CNPJs das empresas da conta. Forma da resposta (`empresas_cadastro[].cnpj`) A CONFIRMAR. */
  async function listarEmpresas(): Promise<Array<{ cnpj: string; razao: string }>> {
    const regs = await paginar('ListarEmpresas', { apenas_importado_api: 'N' }, (j) => j.empresas_cadastro as unknown[])
    return (regs as Array<Record<string, unknown>>).map((e) => ({
      cnpj: String(e.cnpj ?? ''),
      razao: String(e.razao_social ?? e.nome_fantasia ?? ''),
    }))
  }

  /** Existe conta com esta chave? "Não existe" só pelo PADRAO_CONTA_NAO_EXISTE; o resto é erro. */
  async function consultarContaPagar(
    chaveIntegracao: string,
  ): Promise<{ existe: false } | { existe: true; codigo_lancamento_omie: number; resposta: unknown }> {
    const r = await chamar('ConsultarContaPagar', { codigo_lancamento_integracao: chaveIntegracao }, { vazioPadrao: PADRAO_CONTA_NAO_EXISTE })
    if ((r as { vazio?: boolean }).vazio) return { existe: false }
    const cod = Number((r as Record<string, unknown>).codigo_lancamento_omie)
    if (!Number.isFinite(cod) || cod <= 0) {
      throw new ErroOmie('RESPOSTA_INESPERADA', 'ConsultarContaPagar respondeu sem codigo_lancamento_omie.')
    }
    return { existe: true, codigo_lancamento_omie: cod, resposta: r }
  }

  /** Inclui a conta a pagar. Resposta esperada: codigo_lancamento_omie (A CONFIRMAR). */
  async function incluirContaPagar(payload: Record<string, unknown>): Promise<{ codigo_lancamento_omie: number; resposta: unknown }> {
    const r = await chamar('IncluirContaPagar', payload)
    const cod = Number((r as Record<string, unknown>).codigo_lancamento_omie)
    if (!Number.isFinite(cod) || cod <= 0) {
      throw new ErroOmie('RESPOSTA_INESPERADA', 'IncluirContaPagar respondeu sem codigo_lancamento_omie.')
    }
    return { codigo_lancamento_omie: cod, resposta: r }
  }

  return { chamar, listarDepartamentos, listarEmpresas, consultarContaPagar, incluirContaPagar, escritaLiberada }
}

export type ClienteOmie = ReturnType<typeof criarClienteOmie>
