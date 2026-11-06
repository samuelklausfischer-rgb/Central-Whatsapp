// Carrega o cadastro inteiro (ou de uma unidade) para o diagnóstico. Só leitura.
import { db } from './supabase'
import { paginar } from './pool'
import { hojeISO } from './format'
import type { ItemVigente, PrecoVigente } from './tipos'
import type { AliasCad, Cadastro, EventoCad, EventoValorCad, IgnoradoCad, InstrucaoCad, ItemCad, PendenciaAberta, UnidadeCad } from './diagnostico'

export type { Cadastro } from './diagnostico'

const COLUNAS_UNIDADE = 'id, empresa, pasta, modelo_cobranca, situacao, vigencia_inicio, vigencia_fim, janela, franquia_mensal, estudos_conta_2, regras_quantidade, acao_intensificada'
const COLUNAS_ITEM = 'id, unidade_id, papel, exame, modalidade, subunidade, codigo, valor_original, ordem'
const COLUNAS_EVENTO = 'id, unidade_id, tipo, numero, data_assinatura, data_efeito, data_referencia, percentual'

function fatias<T>(lista: T[], n: number): T[][] {
  const r: T[][] = []
  for (let i = 0; i < lista.length; i += n) r.push(lista.slice(i, i + n))
  return r
}

/** Nomes que apareceram sem unidade na última simulação concluída (D33), somando os exames. */
async function lerDesconhecidos(): Promise<{ nome_bruto: string; qtd: number }[]> {
  const { data: sim, error } = await db.from('simulacao').select('id').eq('status', 'concluida').order('criada_em', { ascending: false }).limit(1)
  if (error) throw new Error(`simulacao: ${error.message}`)
  const id = (sim ?? [])[0]?.id as string | undefined
  if (!id) return []
  const linhas = await paginar<{ nome_bruto: string | null; qtd_exames: number | null }>((de, ate) =>
    db.from('simulacao_pendencia').select('nome_bruto, qtd_exames').eq('simulacao_id', id).eq('tipo', 'unidade_desconhecida').order('id').range(de, ate))
  const soma = new Map<string, number>()
  for (const l of linhas) if (l.nome_bruto) soma.set(l.nome_bruto, (soma.get(l.nome_bruto) ?? 0) + Number(l.qtd_exames ?? 0))
  return [...soma].map(([nome_bruto, qtd]) => ({ nome_bruto, qtd })).sort((a, b) => b.qtd - a.qtd || a.nome_bruto.localeCompare(b.nome_bruto, 'pt-BR'))
}

/**
 * Lê tudo o que o diagnóstico precisa. Com `unidadeId`, filtra a unidade (a config e os ignorados vêm inteiros, são pequenos).
 * `comDesconhecidos` soma a consulta da última simulação (D33).
 */
export async function carregarCadastro(o: { unidadeId?: string; comDesconhecidos?: boolean } = {}): Promise<Cadastro> {
  const uid = o.unidadeId
  const hoje = hojeISO()

  const [unidades, itens, eventos, aliases, instrucoes, pendencias, cfg, ignorados] = await Promise.all([
    paginar<UnidadeCad>((de, ate) => {
      const q = db.from('unidade').select(COLUNAS_UNIDADE)
      return (uid ? q.eq('id', uid) : q).order('id').range(de, ate)
    }),
    paginar<ItemCad>((de, ate) => {
      const q = db.from('item_preco').select(COLUNAS_ITEM)
      return (uid ? q.eq('unidade_id', uid) : q).order('id').range(de, ate)
    }),
    paginar<EventoCad>((de, ate) => {
      const q = db.from('evento').select(COLUNAS_EVENTO)
      return (uid ? q.eq('unidade_id', uid) : q).order('id').range(de, ate)
    }),
    paginar<AliasCad>((de, ate) => {
      const q = db.from('alias').select('id, nome_bruto, unidade_id, subunidade, principal, incerto, grupo')
      return (uid ? q.eq('unidade_id', uid) : q).order('id').range(de, ate)
    }),
    paginar<InstrucaoCad>((de, ate) => {
      const q = db.from('instrucao_nf').select('id, unidade_id, nome_planilha')
      return (uid ? q.eq('unidade_id', uid) : q).order('id').range(de, ate)
    }),
    paginar<PendenciaAberta>((de, ate) => {
      const q = db.from('pendencia_cadastro').select('id, unidade_id, tipo, detalhe').eq('resolvida', false)
      return (uid ? q.eq('unidade_id', uid) : q).order('id').range(de, ate)
    }),
    paginar<{ chave: string; valor: string }>((de, ate) => db.from('config').select('chave, valor').order('chave').range(de, ate)),
    paginar<IgnoradoCad>((de, ate) => db.from('nome_ignorado').select('nome_bruto, motivo').order('nome_bruto').range(de, ate)),
  ])

  // valores dos termos: por termo (uma unidade) ou todos (paginado)
  let eventoValores: EventoValorCad[] = []
  if (uid) {
    for (const f of fatias(eventos.map(e => e.id), 100)) {
      eventoValores.push(...await paginar<EventoValorCad>((de, ate) =>
        db.from('evento_valor').select('evento_id, item_preco_id, valor').in('evento_id', f).order('evento_id').order('item_preco_id').range(de, ate)))
    }
  } else {
    eventoValores = await paginar<EventoValorCad>((de, ate) =>
      db.from('evento_valor').select('evento_id, item_preco_id, valor').order('evento_id').order('item_preco_id').range(de, ate))
  }

  // preço vigente hoje
  const porItem = new Map(itens.map(i => [i.id, i]))
  const vigentesHoje = new Map<string, ItemVigente[]>()
  const guardar = (unidade: string, v: ItemVigente) => {
    const l = vigentesHoje.get(unidade)
    if (l) l.push(v); else vigentesHoje.set(unidade, [v])
  }
  if (uid) {
    const { data, error } = await db.rpc('preco_vigente', { p_unidade: uid, p_data: hoje })
    if (error) throw new Error(`preco_vigente: ${error.message}`)
    for (const v of (data ?? []) as ItemVigente[]) guardar(uid, { ...v, valor: v.valor == null ? null : Number(v.valor) })
  } else {
    const linhas = await paginar<PrecoVigente>((de, ate) =>
      db.rpc('precos_vigentes', { p_data: hoje }).order('unidade_id').order('item_preco_id').range(de, ate))
    for (const p of linhas) {
      const it = porItem.get(p.item_preco_id)
      guardar(p.unidade_id, {
        item_preco_id: p.item_preco_id, subunidade: it?.subunidade ?? null, exame: p.exame, modalidade: p.modalidade,
        codigo: it?.codigo ?? null, valor_original: p.valor_original, valor: p.valor == null ? null : Number(p.valor),
        vigente_desde: p.vigente_desde, definido_por: null,
      })
    }
  }

  const config = Object.fromEntries(cfg.map(r => [r.chave, r.valor]))
  return {
    unidades, itens, vigentesHoje, eventos, eventoValores, aliases, instrucoes, config, ignorados, pendencias,
    desconhecidos: o.comDesconhecidos ? await lerDesconhecidos() : undefined,
    parcial: !!uid,
  }
}
