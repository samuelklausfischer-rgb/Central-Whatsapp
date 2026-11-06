// Lógica da "Nova unidade": duplicar (achatando o preço vigente), validar e gravar unidade → itens → aliases.
import { db } from './supabase'
import { normNome } from '../nucleo/motor'
import type { ItemVigente, PapelItem } from './tipos'

export const EMPRESAS = ['PRN', 'MEDIMAGEM'] as const
export type Empresa = typeof EMPRESAS[number]
export const MODALIDADES = ['RX', 'TC', 'RM', 'MG', 'US', 'DO', 'ECG', 'FIXO', 'OUTRO'] as const
export const GRUPOS_NOME = ['PRN', 'PRN Apice Tele', 'Medimagem', 'Medimagem Apice Tele'] as const
export const SITUACOES = ['vigente', 'vencido', 'encerrado', 'minuta', 'nao_iniciado', 'sem_data'] as const
export const PAPEIS: PapelItem[] = ['normal', 'urgencia', 'fixo', 'excedente']

/** Item de preço como vem da tabela `item_preco`. */
export interface ItemCompleto {
  id: string; exame: string; papel?: string | null; modalidade?: string | null; subunidade?: string | null; codigo?: string | null
  valor_original?: number | null; ordem?: number | null; unidade_medida?: string | null; quantidade_estimada?: number | null
}

export interface OrigemDuplicacao { unidade: Record<string, unknown>; itens: ItemCompleto[]; vigentes: ItemVigente[] }

/** Campos da `unidade` que a duplicação leva. Fora: id, pasta, situação, motivo, sharepoint, confiança, observações, atualizado_em. */
const CAMPOS_COPIADOS = [
  'grupo', 'orgao', 'numero_contrato', 'objeto', 'vigencia_inicio', 'vigencia_fim', 'valor_total', 'modelo_cobranca',
  'janela', 'criterio_data', 'franquia_mensal', 'todos_status', 'estudos_conta_2', 'regras_quantidade', 'acao_intensificada',
] as const

/** Pura: monta a nova unidade e os itens a partir da origem. Preço = vigente de hoje; sem id, termos, nomes nem pendências. */
export function montarDuplicacao(
  origem: OrigemDuplicacao,
  novo: { empresa: Empresa; pasta: string },
): { unidade: Record<string, unknown>; itens: Record<string, unknown>[] } {
  const unidade: Record<string, unknown> = {}
  for (const c of CAMPOS_COPIADOS) if (origem.unidade[c] !== undefined) unidade[c] = origem.unidade[c]
  unidade.empresa = novo.empresa
  unidade.pasta = novo.pasta.trim()
  unidade.situacao = 'nao_iniciado'
  unidade.situacao_manual = false

  const vigente = new Map(origem.vigentes.map(v => [v.item_preco_id, v]))
  const ordenados = [...origem.itens].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
  const itens = ordenados.map((it, i) => {
    const v = vigente.get(it.id)
    const valor = v && v.valor != null ? Number(v.valor) : (it.valor_original ?? null)
    return {
      exame: it.exame, papel: it.papel ?? 'normal', modalidade: it.modalidade ?? null, subunidade: it.subunidade ?? null,
      codigo: it.codigo ?? null, unidade_medida: it.unidade_medida ?? null, quantidade_estimada: it.quantidade_estimada ?? null,
      valor_original: valor, ordem: i,
    }
  })
  return { unidade, itens }
}

/** Lê a origem no banco (unidade, itens e preço vigente de hoje pela RPC `preco_vigente`). */
export async function carregarOrigem(id: string, hoje: string): Promise<OrigemDuplicacao> {
  const [u, it, vg] = await Promise.all([
    db.from('unidade').select('*').eq('id', id).single(),
    db.from('item_preco').select('*').eq('unidade_id', id).order('ordem'),
    db.rpc('preco_vigente', { p_unidade: id, p_data: hoje }),
  ])
  const e = u.error || it.error || vg.error
  if (e) throw new Error(e.message)
  return { unidade: u.data as Record<string, unknown>, itens: (it.data ?? []) as ItemCompleto[], vigentes: (vg.data ?? []) as unknown as ItemVigente[] }
}

// ---------------------------------------------------------------- formulário
export interface ItemForm {
  exame: string; papel: PapelItem; modalidade: string; subunidade: string; codigo: string; valor: string
  unidade_medida?: string | null; quantidade_estimada?: number | null
}
export interface AliasForm { nome_bruto: string; grupo: string; principal: boolean; subunidade: string }
export interface FormNova {
  empresa: Empresa; pasta: string; orgao: string; numero_contrato: string; vigencia_inicio: string; vigencia_fim: string
  modelo_cobranca: string; janela: string; criterio_data: '' | 'laudo' | 'exame'; todos_status: boolean; franquia_mensal: string
  situacao: string
  /** Regras copiadas da origem (quantidade, fim de semana, estudos) e outros campos sem tela neste assistente. */
  extras: Record<string, unknown>
}

export function formVazio(): FormNova {
  return {
    empresa: 'PRN', pasta: '', orgao: '', numero_contrato: '', vigencia_inicio: '', vigencia_fim: '',
    modelo_cobranca: 'por_modalidade', janela: 'mes', criterio_data: '', todos_status: false, franquia_mensal: '', situacao: 'sem_data', extras: {},
  }
}

const str = (v: unknown) => (v == null ? '' : String(v))

/** Resultado de `montarDuplicacao` → formulário do assistente (pasta sai vazia: quem cria digita a nova). */
export function formDeDuplicacao(d: { unidade: Record<string, unknown>; itens: Record<string, unknown>[] }): { form: FormNova; itens: ItemForm[] } {
  const u = d.unidade
  const form: FormNova = {
    empresa: u.empresa === 'MEDIMAGEM' ? 'MEDIMAGEM' : 'PRN', pasta: '', orgao: str(u.orgao), numero_contrato: str(u.numero_contrato),
    vigencia_inicio: str(u.vigencia_inicio), vigencia_fim: str(u.vigencia_fim), modelo_cobranca: str(u.modelo_cobranca) || 'por_modalidade',
    janela: str(u.janela) || 'mes', criterio_data: u.criterio_data === 'laudo' || u.criterio_data === 'exame' ? u.criterio_data : '',
    todos_status: u.todos_status === true, franquia_mensal: str(u.franquia_mensal), situacao: str(u.situacao) || 'nao_iniciado',
    extras: {
      grupo: u.grupo ?? null, objeto: u.objeto ?? null, valor_total: u.valor_total ?? null, estudos_conta_2: u.estudos_conta_2 ?? null,
      regras_quantidade: u.regras_quantidade ?? null, acao_intensificada: u.acao_intensificada ?? null,
    },
  }
  const itens: ItemForm[] = d.itens.map(i => ({
    exame: str(i.exame), papel: (i.papel as PapelItem) ?? 'normal', modalidade: str(i.modalidade), subunidade: str(i.subunidade),
    codigo: str(i.codigo), valor: i.valor_original == null ? '' : String(i.valor_original),
    unidade_medida: (i.unidade_medida as string | null) ?? null, quantidade_estimada: (i.quantidade_estimada as number | null) ?? null,
  }))
  return { form, itens }
}

/** Situação sugerida pela vigência (sem vigência = sem_data). */
export function situacaoPorVigencia(ini: string, fim: string, hoje: string): string {
  if (!ini && !fim) return 'sem_data'
  if (fim && fim < hoje) return 'vencido'
  if (ini && ini > hoje) return 'nao_iniciado'
  return 'vigente'
}

// ---------------------------------------------------------------- validação
export interface UnidadeExistente { empresa: string; pasta: string }
export interface Avisos { erros: Record<string, string>; avisos: string[] }

/** Passo 1: pasta única por empresa (exata = erro; só parecida pela normalização = aviso), datas coerentes. */
export function validarIdentificacao(f: FormNova, existentes: UnidadeExistente[]): Avisos {
  const erros: Record<string, string> = {}
  const avisos: string[] = []
  const pasta = f.pasta.trim()
  if (!pasta) erros.pasta = 'Escreva o nome da pasta.'
  else {
    const mesma = existentes.filter(u => u.empresa === f.empresa)
    if (mesma.some(u => u.pasta === pasta)) erros.pasta = `Já existe a pasta "${pasta}" em ${f.empresa}.`
    else {
      const parecida = existentes.find(u => normNome(u.pasta) === normNome(pasta))
      if (parecida) avisos.push(`Já existe uma pasta parecida: "${parecida.pasta}" (${parecida.empresa}). Confirme que não é a mesma unidade.`)
    }
  }
  if (f.vigencia_inicio && f.vigencia_fim && f.vigencia_fim < f.vigencia_inicio) erros.vigencia_fim = 'O fim da vigência não pode ser antes do início.'
  return { erros, avisos }
}

/** Passo 2: franquia (se informada) maior que zero e dia de corte já vem validado pela lista de janelas. */
export function validarComoFatura(f: FormNova): Record<string, string> {
  const erros: Record<string, string> = {}
  if (f.franquia_mensal.trim()) {
    const n = Number(f.franquia_mensal.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) erros.franquia_mensal = 'A franquia precisa ser maior que zero.'
  }
  return erros
}

export function lerValor(txt: string): number | null | 'invalido' {
  const t = txt.trim()
  if (!t) return null
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  if (!Number.isFinite(n) || n < 0) return 'invalido'
  if (Math.round(n * 10000) / 10000 !== n) return 'invalido'
  return n
}

/** Passo 3: um erro por linha com problema (índice → texto). */
export function validarItens(itens: ItemForm[]): Record<number, string> {
  const erros: Record<number, string> = {}
  itens.forEach((it, i) => {
    if (!it.exame.trim()) erros[i] = 'Escreva o nome do exame.'
    else if (lerValor(it.valor) === 'invalido') erros[i] = 'Valor inválido: use número maior ou igual a zero, com até 4 casas.'
  })
  return erros
}

export interface NomeExistente { nome_bruto: string; pasta: string | null }

/** Passo 4: nome em maiúsculas, sem repetir no formulário nem em outra unidade (pelo texto exato ou pela normalização). */
export function validarNomes(nomes: AliasForm[], existentes: NomeExistente[], ignorados: string[]): Record<number, string> {
  const erros: Record<number, string> = {}
  const vistos = new Set<string>()
  const ign = new Set(ignorados.map(normNome))
  nomes.forEach((n, i) => {
    const nome = n.nome_bruto.trim()
    if (!nome) { erros[i] = 'Escreva o nome como aparece na Mobilemed.'; return }
    const chave = normNome(nome)
    if (vistos.has(chave)) { erros[i] = 'Este nome está repetido na lista.'; return }
    vistos.add(chave)
    const outro = existentes.find(e => e.nome_bruto === nome || normNome(e.nome_bruto) === chave)
    if (outro) erros[i] = `Este nome já pertence a ${outro.pasta ? `"${outro.pasta}"` : 'outra unidade'}.`
    else if (ign.has(chave)) erros[i] = 'Este nome está na lista de nomes ignorados (não fatura). Tire de lá antes, ou use outro.'
  })
  return erros
}

/** Erros que impedem criar (resumo para o passo de revisão). */
export function podeCriar(f: FormNova, itens: ItemForm[], nomes: AliasForm[], existentes: UnidadeExistente[], nomesEx: NomeExistente[], ignorados: string[]): string[] {
  const out: string[] = []
  const id = validarIdentificacao(f, existentes)
  out.push(...Object.values(id.erros), ...Object.values(validarComoFatura(f)))
  if (!itens.length) out.push('Cadastre pelo menos um item de preço.')
  out.push(...Object.values(validarItens(itens)))
  if (!nomes.length) out.push('Cadastre pelo menos um nome da Mobilemed.')
  out.push(...Object.values(validarNomes(nomes, nomesEx, ignorados)))
  return out
}

// ---------------------------------------------------------------- gravação
export interface PayloadNova { unidade: Record<string, unknown>; itens: Record<string, unknown>[]; aliases: Record<string, unknown>[] }

const nulo = (s: string) => (s.trim() === '' ? null : s.trim())

/** Formulário → linhas prontas para gravar (ids gerados no cliente). */
export function montarPayload(f: FormNova, itens: ItemForm[], nomes: AliasForm[]): PayloadNova {
  const id = crypto.randomUUID()
  const franquia = f.franquia_mensal.trim() ? Number(f.franquia_mensal.replace(',', '.')) : null
  const unidade: Record<string, unknown> = {
    ...f.extras, id, empresa: f.empresa, pasta: f.pasta.trim(), orgao: nulo(f.orgao), numero_contrato: nulo(f.numero_contrato),
    vigencia_inicio: nulo(f.vigencia_inicio), vigencia_fim: nulo(f.vigencia_fim), modelo_cobranca: f.modelo_cobranca,
    janela: f.janela, criterio_data: f.criterio_data || null, todos_status: f.todos_status, franquia_mensal: franquia,
    situacao: f.situacao, situacao_manual: false,
  }
  const linhas = itens.map((it, i) => {
    const v = lerValor(it.valor)
    return {
      id: crypto.randomUUID(), unidade_id: id, ordem: i, exame: it.exame.trim(), papel: it.papel, modalidade: nulo(it.modalidade),
      subunidade: nulo(it.subunidade), codigo: nulo(it.codigo), valor_original: v === 'invalido' ? null : v,
      unidade_medida: it.unidade_medida ?? null, quantidade_estimada: it.quantidade_estimada ?? null,
    }
  })
  const aliases = nomes.map(n => ({
    id: crypto.randomUUID(), nome_bruto: n.nome_bruto.trim(), unidade_id: id, subunidade: nulo(n.subunidade),
    grupo: nulo(n.grupo), principal: n.principal, incerto: false,
  }))
  return { unidade, itens: linhas, aliases }
}

/** Grava unidade → itens → aliases. Se algo falhar no meio, apaga a unidade (a cascata limpa o resto) e lança o erro. Devolve o id. */
export async function criarUnidade(p: PayloadNova): Promise<string> {
  const id = p.unidade.id as string
  const { error: e1 } = await db.from('unidade').insert(p.unidade)
  if (e1) throw new Error(`Não foi possível criar a unidade: ${e1.message}`)
  const passos: [string, Record<string, unknown>[]][] = [['item_preco', p.itens], ['alias', p.aliases]]
  for (const [tabela, linhas] of passos) {
    if (!linhas.length) continue
    const { error } = await db.from(tabela).insert(linhas)
    if (error) {
      const { error: ed } = await db.from('unidade').delete().eq('id', id)
      throw new Error(`Falhou ao gravar ${tabela === 'alias' ? 'os nomes' : 'os preços'}: ${error.message}. ${ed ? `Atenção: a unidade pela metade não pôde ser desfeita (${ed.message}).` : 'Nada ficou gravado.'}`)
    }
  }
  return id
}
