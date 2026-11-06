// Encerrar, reativar e apagar uma unidade (com backup completo antes do DELETE).
import { db } from './supabase'
import { paginar } from './pool'
import { baixarBackup, capturar, guardarUltimo, type Backup } from './backup'
import { situacaoPorVigencia } from './unidadeNova'

export interface Efeitos { itens: number; termos: number; nomes: number; pendencias: number; instrucoes: number; relatorios: number }

async function contar(tabela: string, id: string): Promise<number> {
  const { count, error } = await db.from(tabela).select('id', { count: 'exact', head: true }).eq('unidade_id', id)
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** Ids distintos de simulação que citam a unidade (relatórios que perdem o vínculo ao apagar). */
async function relatoriosDa(id: string): Promise<{ simulacao_id: string; nome_bruto: string }[]> {
  const [a, b] = await Promise.all(['simulacao_resumo', 'simulacao_pendencia'].map(t =>
    paginar<{ simulacao_id: string; nome_bruto: string | null }>((de, ate) =>
      db.from(t).select('simulacao_id, nome_bruto').eq('unidade_id', id).range(de, ate))))
  const vistos = new Set<string>()
  const saida: { simulacao_id: string; nome_bruto: string }[] = []
  for (const r of [...a, ...b]) {
    if (!r.nome_bruto) continue
    const k = `${r.simulacao_id}|${r.nome_bruto}`
    if (vistos.has(k)) continue
    vistos.add(k)
    saida.push({ simulacao_id: r.simulacao_id, nome_bruto: r.nome_bruto })
  }
  return saida
}

/** Contagens reais do que a cascata leva e dos relatórios que perdem o vínculo. */
export async function contarEfeitos(id: string): Promise<Efeitos> {
  const [itens, termos, nomes, pendencias, instrucoes, rel] = await Promise.all([
    contar('item_preco', id), contar('evento', id), contar('alias', id), contar('pendencia_cadastro', id), contar('instrucao_nf', id),
    paginar<{ simulacao_id: string }>((de, ate) => db.from('simulacao_resumo').select('simulacao_id').eq('unidade_id', id).range(de, ate)),
  ])
  return { itens, termos, nomes, pendencias, instrucoes, relatorios: new Set(rel.map(r => r.simulacao_id)).size }
}

/** Backup de tudo que a cascata apaga: unidade + filhos + valores de termo + pares de simulação a religar. */
export async function capturarUnidade(id: string): Promise<Backup> {
  const [unidade, itens, eventos, aliases, pendencias, instrucoes] = await Promise.all([
    capturar('unidade', 'id', [id]), capturar('item_preco', 'unidade_id', [id]), capturar('evento', 'unidade_id', [id]),
    capturar('alias', 'unidade_id', [id]), capturar('pendencia_cadastro', 'unidade_id', [id]), capturar('instrucao_nf', 'unidade_id', [id]),
  ])
  const idsEvento = eventos.map(e => String(e.id))
  const idsItem = itens.map(i => String(i.id))
  const [porEvento, porItem] = await Promise.all([capturar('evento_valor', 'evento_id', idsEvento), capturar('evento_valor', 'item_preco_id', idsItem)])
  const valores = new Map<string, Record<string, unknown>>()
  for (const v of [...porEvento, ...porItem]) valores.set(`${v.evento_id}|${v.item_preco_id}`, v)
  const pasta = String(unidade[0]?.pasta ?? id)
  return {
    versao: 1,
    criadoEm: new Date().toISOString(),
    descricao: `unidade-${pasta}`,
    tabelas: [
      { tabela: 'unidade', linhas: unidade }, { tabela: 'item_preco', linhas: itens }, { tabela: 'evento', linhas: eventos },
      { tabela: 'evento_valor', linhas: [...valores.values()] }, { tabela: 'alias', linhas: aliases },
      { tabela: 'pendencia_cadastro', linhas: pendencias }, { tabela: 'instrucao_nf', linhas: instrucoes },
    ],
    religar: (await relatoriosDa(id)).map(r => ({ ...r, unidade_id: id })),
  }
}

/** Backup → baixa o arquivo → guarda para desfazer → DELETE (a cascata leva o resto). Bloqueado se houver instrução de NF. */
export async function apagarUnidade(id: string): Promise<Backup> {
  const backup = await capturarUnidade(id)
  if (!backup.tabelas.find(t => t.tabela === 'unidade')?.linhas.length) throw new Error('Unidade não encontrada.')
  if (backup.tabelas.find(t => t.tabela === 'instrucao_nf')?.linhas.length) {
    throw new Error('Esta unidade tem instrução de NF e o app de testes não consegue recriá-la. Use "Encerrar e parar de faturar" ou apague pelo Central Whats.')
  }
  baixarBackup(backup)
  guardarUltimo(backup)
  const { error } = await db.from('unidade').delete().eq('id', id)
  if (error) throw new Error(error.message)
  return backup
}

// ---------------------------------------------------------------- encerrar
const dm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
export const prefixoMotivo = (pasta: string) => `Unidade ${pasta} encerrada em `

/** Nomes (da Mobilemed) da unidade. */
export async function nomesDaUnidade(id: string): Promise<string[]> {
  const l = await capturar('alias', 'unidade_id', [id])
  return l.map(a => String(a.nome_bruto)).sort()
}

/** Dos nomes da unidade, os que já estão em `nome_ignorado` por um encerramento desta unidade. */
export async function nomesEncerrados(id: string, pasta: string): Promise<string[]> {
  const nomes = await nomesDaUnidade(id)
  if (!nomes.length) return []
  const ign = await capturar('nome_ignorado', 'nome_bruto', nomes)
  return ign.filter(r => String(r.motivo ?? '').startsWith(prefixoMotivo(pasta))).map(r => String(r.nome_bruto))
}

/** Marca a unidade como encerrada (motivo obrigatório). Com `pararDeFaturar`, põe os nomes dela em `nome_ignorado`. */
export async function encerrarUnidade(id: string, motivo: string, pararDeFaturar: boolean, agora: Date = new Date()): Promise<void> {
  const m = motivo.trim()
  if (!m) throw new Error('Informe o motivo do encerramento.')
  const { data, error } = await db.from('unidade').select('pasta').eq('id', id).single()
  if (error) throw new Error(error.message)
  const pasta = String((data as { pasta: string }).pasta)
  if (pararDeFaturar) {
    const nomes = await nomesDaUnidade(id)
    if (nomes.length) {
      const motivoIgn = `${prefixoMotivo(pasta)}${dm(agora)}`
      const { error: ei } = await db.from('nome_ignorado').upsert(nomes.map(n => ({ nome_bruto: n, motivo: motivoIgn })), { onConflict: 'nome_bruto', ignoreDuplicates: true })
      if (ei) throw new Error(ei.message)
    }
  }
  const { error: eu } = await db.from('unidade').update({ situacao: 'encerrado', situacao_manual: true, motivo_situacao: m, atualizado_em: agora.toISOString() }).eq('id', id)
  if (eu) throw new Error(eu.message)
}

/** Desfaz o "parar de faturar": tira os nomes de `nome_ignorado` e devolve a situação pela vigência (automática). */
export async function reativarUnidade(id: string, pasta: string, hoje: string): Promise<void> {
  const nomes = await nomesEncerrados(id, pasta)
  if (nomes.length) {
    const { error } = await db.from('nome_ignorado').delete().in('nome_bruto', nomes)
    if (error) throw new Error(error.message)
  }
  const { data, error: e1 } = await db.from('unidade').select('vigencia_inicio, vigencia_fim').eq('id', id).single()
  if (e1) throw new Error(e1.message)
  const v = data as { vigencia_inicio: string | null; vigencia_fim: string | null }
  const { error } = await db.from('unidade').update({
    situacao: situacaoPorVigencia(v.vigencia_inicio ?? '', v.vigencia_fim ?? '', hoje), situacao_manual: false, motivo_situacao: null, atualizado_em: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw new Error(error.message)
}
