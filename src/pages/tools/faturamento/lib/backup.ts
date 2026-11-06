import { db } from './supabase'
import { paginar } from './pool'

/** Tabelas do cadastro que entram no backup antes de apagar. */
export type TabelaCadastro =
  | 'unidade' | 'item_preco' | 'evento' | 'evento_valor' | 'alias'
  | 'pendencia_cadastro' | 'instrucao_nf' | 'config' | 'nome_ignorado'

export interface Backup {
  versao: 1
  criadoEm: string
  descricao: string
  tabelas: { tabela: TabelaCadastro; linhas: Record<string, unknown>[] }[]
  /** Pares de simulação a religar à unidade depois de restaurar (unidade_id foi para null na cascata). */
  religar?: { simulacao_id: string; nome_bruto: string; unidade_id: string }[]
}

/** Pais antes de filhos: é a ordem do upsert ao desfazer. */
export const ORDEM_RESTAURACAO: TabelaCadastro[] = [
  'unidade', 'item_preco', 'evento', 'evento_valor', 'alias',
  'pendencia_cadastro', 'instrucao_nf', 'config', 'nome_ignorado',
]

/** Chave primária de cada tabela (usada no onConflict do upsert). */
export const CHAVE_PRIMARIA: Record<TabelaCadastro, string> = {
  unidade: 'id', item_preco: 'id', evento: 'id', evento_valor: 'evento_id,item_preco_id', alias: 'id',
  pendencia_cadastro: 'id', instrucao_nf: 'id', config: 'chave', nome_ignorado: 'nome_bruto',
}

const FATIA = 100 // valores por IN (evita URL grande demais)
const LOTE_UPSERT = 500

/** Lê todas as linhas da tabela cuja `coluna` está em `valores` (fatia a lista e pagina). */
export async function capturar(tabela: TabelaCadastro, coluna: string, valores: string[]): Promise<Record<string, unknown>[]> {
  const unicos = [...new Set(valores)]
  const saida: Record<string, unknown>[] = []
  for (let i = 0; i < unicos.length; i += FATIA) {
    const fatia = unicos.slice(i, i + FATIA)
    const linhas = await paginar<Record<string, unknown>>((de, ate) =>
      db.from(tabela).select('*').in(coluna, fatia).range(de, ate))
    saida.push(...linhas)
  }
  return saida
}

function dois(n: number): string { return String(n).padStart(2, '0') }

function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'cadastro'
}

/** Baixa o backup como `backup-faturamento-<descricao>-<aaaammdd-hhmm>.json`. */
export function baixarBackup(b: Backup): void {
  const d = new Date(b.criadoEm)
  const quando = `${d.getFullYear()}${dois(d.getMonth() + 1)}${dois(d.getDate())}-${dois(d.getHours())}${dois(d.getMinutes())}`
  const nome = `backup-faturamento-${slug(b.descricao)}-${quando}.json`
  const url = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Devolve o backup ao banco: upsert por PK na ordem certa e depois religa as simulações. Não para no primeiro erro. */
export async function restaurar(b: Backup): Promise<{ ok: boolean; erros: string[] }> {
  const erros: string[] = []
  for (const tabela of ORDEM_RESTAURACAO) {
    const linhas = b.tabelas.filter((t) => t.tabela === tabela).flatMap((t) => t.linhas)
    for (let i = 0; i < linhas.length; i += LOTE_UPSERT) {
      const { error } = await db.from(tabela).upsert(linhas.slice(i, i + LOTE_UPSERT), { onConflict: CHAVE_PRIMARIA[tabela] })
      if (error) erros.push(`${tabela}: ${error.message}`)
    }
  }
  for (const r of b.religar ?? []) {
    for (const tabela of ['simulacao_resumo', 'simulacao_pendencia']) {
      const { error } = await db.from(tabela).update({ unidade_id: r.unidade_id })
        .is('unidade_id', null).eq('simulacao_id', r.simulacao_id).eq('nome_bruto', r.nome_bruto)
      if (error) erros.push(`${tabela} (religar ${r.nome_bruto}): ${error.message}`)
    }
  }
  return { ok: erros.length === 0, erros }
}

const CHAVE_ULTIMO = 'fat:backup:ultimo'
let emMemoria: Backup | null = null

/** Guarda o último backup na memória e, se couber, no sessionStorage. Devolve false se só coube na memória. */
export function guardarUltimo(b: Backup): boolean {
  emMemoria = b
  try {
    sessionStorage.setItem(CHAVE_ULTIMO, JSON.stringify(b))
    return true
  } catch {
    try { sessionStorage.removeItem(CHAVE_ULTIMO) } catch { /* ignora */ }
    return false
  }
}

export function lerUltimo(): Backup | null {
  if (emMemoria) return emMemoria
  try {
    const t = sessionStorage.getItem(CHAVE_ULTIMO)
    return t ? (JSON.parse(t) as Backup) : null
  } catch {
    return null
  }
}
