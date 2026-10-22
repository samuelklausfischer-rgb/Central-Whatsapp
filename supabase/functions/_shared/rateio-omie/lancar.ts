// Sequência do `lancar` (CONTRATO): reaproveita/insere a linha como 'enviando' -> Consultar -> Incluir
// -> 'lancado' | 'erro' | 'incerto'. Sem Deno e sem rede: o banco entra por `RepoLancamentos` e o Omie
// por um cliente injetado, então os testes rodam com ambos simulados.
// Só sintaxe apagável (Node roda por type stripping).

import { ErroOmie } from './omie.ts'
import type { ClienteOmie, Tentativa } from './omie.ts'
import { statusEfetivo } from './nucleo.ts'

export type RegistroLancamento = Record<string, unknown>

export type LinhaExistente = {
  id: string
  status: string
  atualizado_em?: string | null
  criado_em?: string | null
}

export interface RepoLancamentos {
  buscarPorChave(chaveIntegracao: string): Promise<LinhaExistente | null>
  /** Insere como 'enviando'. `conflito` = o índice único barrou (outro clique ou outra NF ativa). */
  inserir(registro: RegistroLancamento): Promise<{ ok: true; id: string } | { ok: false; conflito: true }>
  /**
   * `update ... where id = X and status in ('incerto','erro','excluido')` para 'enviando', trocando os
   * campos do registro. Com `aceitaEnviandoOrfao`, também aceita `enviando` há mais de 10 min.
   * NÃO zera omie_codigo_lancamento (um 'excluido' com escrita desligada não pode perdê-lo; o sucesso
   * sobrescreve). null = nenhuma linha afetada (corrida perdida) ou índice único barrou.
   */
  reaproveitar(id: string, registro: RegistroLancamento, opcoes?: { aceitaEnviandoOrfao?: boolean }): Promise<string | null>
  marcar(id: string, status: 'lancado' | 'erro' | 'incerto' | 'excluido', extra?: RegistroLancamento): Promise<void>
  /** Só apaga se ainda estiver 'enviando'. */
  apagarEnviando(id: string): Promise<void>
  tentativaAntes(lancamentoId: string, call: string, payload: unknown): Promise<unknown>
  tentativaDepois(
    tentativaId: unknown,
    dados: { http_status: number | null; resposta: unknown; erro: string | null },
  ): Promise<void>
}

const REAPROVEITAVEIS = ['incerto', 'erro', 'excluido']

export type ResultadoLancar = Record<string, unknown> & { ok: boolean }

export async function executarLancamento(args: {
  chaveIntegracao: string
  registro: RegistroLancamento
  payload: Record<string, unknown>
  repo: RepoLancamentos
  criarOmie: (onTentativa: (t: Tentativa) => Promise<unknown>) => ClienteOmie
  /** Relógio injetado (ms) para o `enviando` órfão. */
  agora?: () => number
  /** Aplicado a toda mensagem devolvida ao browser (defesa extra contra segredo em texto de erro). */
  redigirTexto?: (s: string) => string
}): Promise<ResultadoLancar> {
  const { chaveIntegracao, registro, payload, repo, criarOmie } = args
  const agora = args.agora ?? (() => Date.now())
  const limpar = args.redigirTexto ?? ((s: string) => s)
  const recusa = (motivo: string, mensagem: string): ResultadoLancar => ({ ok: false, motivo, mensagem })

  // 1) 'enviando': reaproveita a linha da mesma chave (a chave é única) ou insere.
  let lancamentoId: string
  const anterior = await repo.buscarPorChave(chaveIntegracao)
  if (anterior) {
    // `enviando` com mais de 10 min é órfão: vale como `incerto` (e consulta antes de incluir).
    const statusAnterior = statusEfetivo(anterior, agora())
    const orfao = anterior.status === 'enviando' && statusAnterior === 'incerto'
    if (statusAnterior === 'lancado') return recusa('JA_LANCADO', 'Esta NF já foi lançada no Omie.')
    if (statusAnterior === 'enviando') return recusa('LANCAMENTO_EM_ANDAMENTO', 'Há um lançamento em andamento para esta NF.')
    if (!REAPROVEITAVEIS.includes(statusAnterior)) return recusa('JA_LANCADO', `Estado inesperado do lançamento anterior: ${anterior.status}.`)
    const id = await repo.reaproveitar(anterior.id, registro, { aceitaEnviandoOrfao: orfao })
    if (!id) return recusa('LANCAMENTO_EM_ANDAMENTO', 'Outro envio assumiu este lançamento primeiro.')
    lancamentoId = id
  } else {
    const ins = await repo.inserir(registro)
    if (!ins.ok) {
      // Clique duplo ou concorrente: o índice único barrou.
      return recusa('LANCAMENTO_EM_ANDAMENTO', 'Já existe um lançamento ativo ou em andamento para esta empresa e competência.')
    }
    lancamentoId = ins.id
  }

  // Log: 1 linha por chamada ao Omie, criada ANTES e completada DEPOIS. O payload já vem sem credenciais.
  const onTentativa = async (t: Tentativa): Promise<unknown> => {
    if (t.fase === 'antes') return await repo.tentativaAntes(lancamentoId, t.call, t.payload)
    if (t.ctx != null) {
      await repo.tentativaDepois(t.ctx, { http_status: t.http_status ?? null, resposta: t.resposta ?? null, erro: t.erro ?? null })
    }
    return null
  }

  let incluindo = false
  try {
    const omie = criarOmie(onTentativa)

    // 2) SEMPRE consulta antes de incluir (também depois de 'incerto'): se a conta existe, só registra.
    const existente = await omie.consultarContaPagar(chaveIntegracao)
    if (existente.existe) {
      await repo.marcar(lancamentoId, 'lancado', { omie_codigo_lancamento: existente.codigo_lancamento_omie })
      return {
        ok: true,
        status: 'lancado',
        lancamento_id: lancamentoId,
        omie_codigo_lancamento: existente.codigo_lancamento_omie,
        mensagem: 'A conta já existia no Omie (consulta pela chave); nada foi incluído.',
      }
    }

    // 3) inclui (só com OMIE_ESCRITA=liberada)
    incluindo = true
    const r = await omie.incluirContaPagar(payload)
    await repo.marcar(lancamentoId, 'lancado', { omie_codigo_lancamento: r.codigo_lancamento_omie })
    return { ok: true, status: 'lancado', lancamento_id: lancamentoId, omie_codigo_lancamento: r.codigo_lancamento_omie }
  } catch (e) {
    const msg = limpar(e instanceof Error ? e.message : String(e))
    if (e instanceof ErroOmie && e.tipo === 'ESCRITA_DESLIGADA') {
      // Nada foi enviado. Linha nova: apaga (histórico de tentativas fica). Linha reaproveitada: volta ao
      // status que tinha (não pode ser apagada: a chave é única e o 'incerto' precisa continuar valendo).
      if (anterior) {
        await repo.marcar(lancamentoId, statusEfetivo(anterior, agora()) as 'erro' | 'incerto' | 'excluido')
      } else {
        await repo.apagarEnviando(lancamentoId)
      }
      return { ok: false, motivo: 'ESCRITA_DESLIGADA', mensagem: 'A escrita no Omie está desligada (OMIE_ESCRITA); nada foi enviado.' }
    }
    // 'erro' só quando se sabe que nada foi criado: falha na consulta, erro de negócio ou 425.
    // Qualquer dúvida depois de iniciar a inclusão (rede, timeout, resposta estranha) é 'incerto'.
    // Na escrita, 425/REDUNDANT/timeout/rede NUNCA são definitivos: tudo isso é incerto.
    const definitivo = !incluindo || (e instanceof ErroOmie && e.tipo === 'NEGOCIO')
    const status = definitivo ? 'erro' : 'incerto'
    try {
      await repo.marcar(lancamentoId, status)
    } catch (_e2) {
      // Não mascara o erro original; o handler registra no log da função.
    }
    return {
      ok: false,
      status,
      lancamento_id: lancamentoId,
      mensagem:
        status === 'incerto'
          ? `${msg} O resultado é incerto: o próximo envio consulta o Omie pela chave ${chaveIntegracao} antes de incluir.`
          : msg,
    }
  }
}
