// Lógica pura do cartão "Nomes da Mobilemed": agrupamento por subunidade e cor do selo de grupo.
import type { Alias } from '../../lib/tipos'
import { normNome } from '../../nucleo/motor'
import { nomeQueRecebeFixo } from '../../lib/config'
import type { Cor } from '../../components/ui'

export const ROTULO_SEM_SUBUNIDADE = 'Unidade'

export interface SubGrupo<T> { rotulo: string; nomes: T[] }

/** Agrupa por subunidade/hospital ("Unidade" quando não tem), "Unidade" primeiro e o resto em ordem alfabética; nomes em ordem alfabética. */
export function agruparPorSubunidade<T extends Pick<Alias, 'nome_bruto' | 'subunidade'>>(nomes: T[]): SubGrupo<T>[] {
  const mapa = new Map<string, T[]>()
  for (const a of nomes) {
    const k = a.subunidade?.trim() || ROTULO_SEM_SUBUNIDADE
    mapa.set(k, [...(mapa.get(k) ?? []), a])
  }
  return [...mapa.entries()]
    .sort(([x], [y]) => Number(y === ROTULO_SEM_SUBUNIDADE) - Number(x === ROTULO_SEM_SUBUNIDADE) || x.localeCompare(y, 'pt-BR'))
    .map(([rotulo, ns]) => ({ rotulo, nomes: [...ns].sort((a, b) => a.nome_bruto.localeCompare(b.nome_bruto, 'pt-BR')) }))
}

export const COR_GRUPO: Record<string, Cor> = {
  PRN: 'sky', 'PRN Apice Tele': 'violet', Medimagem: 'emerald', 'Medimagem Apice Tele': 'amber',
}

/** O nome já está cadastrado nesta unidade? (compara sem acento/maiúscula/espaço extra) */
export const nomeJaCadastrado = (nomes: Pick<Alias, 'nome_bruto'>[], nome: string) =>
  nomes.some(a => normNome(a.nome_bruto) === normNome(nome))

/** Quem passa a receber o valor fixo se este nome sair da unidade (null = ninguém sobra). */
export function efeitosRemoverNome(a: Pick<Alias, 'nome_bruto' | 'principal'>, outros: { nome_bruto: string; principal: boolean; grupo?: string | null; subunidade?: string | null }[], temFixo: boolean): string[] {
  const e = [`Os exames de “${a.nome_bruto}” passam a sair como unidade desconhecida na próxima geração.`]
  if (temFixo && a.principal) {
    const novo = nomeQueRecebeFixo(outros)
    e.push(novo ? `Este nome recebia o valor fixo; o fixo passa para “${novo.todos.join(', ')}”.` : 'Este nome recebia o valor fixo e a unidade fica sem ninguém para recebê-lo.')
  }
  e.push('Uma cópia de segurança (arquivo) é baixada antes de apagar, e dá para desfazer logo depois.')
  return e
}

/** Frases de efeito de mover o nome para outra unidade. */
export function efeitosMoverNome(a: Pick<Alias, 'nome_bruto' | 'principal'>, destino: string, outros: { nome_bruto: string; principal: boolean; grupo?: string | null; subunidade?: string | null }[], temFixo: boolean): string[] {
  const e = [`Os exames de “${a.nome_bruto}” passam a ser faturados por “${destino}” a partir da próxima geração.`,
    'Relatórios já gerados continuam com a unidade antiga.']
  if (a.principal && temFixo) {
    const novo = nomeQueRecebeFixo(outros)
    e.push(novo ? `Este nome era ★ principal; o valor fixo desta unidade passa para “${novo.todos.join(', ')}”.` : 'Este nome era ★ principal; esta unidade fica sem nome para receber o valor fixo.')
  }
  e.push('No destino o nome entra sem ★ principal; ajuste a subunidade se precisar.')
  return e
}

/** Filtra unidades pela busca (sem acento/maiúscula), tirando a atual. */
export function filtrarUnidades<T extends { id: string; pasta: string }>(lista: T[], busca: string, excluirId: string, max = 50): T[] {
  const q = normNome(busca)
  return lista.filter(u => u.id !== excluirId && (!q || normNome(u.pasta).includes(q))).slice(0, max)
}
