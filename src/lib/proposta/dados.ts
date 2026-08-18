/**
 * O formato dos dados de uma proposta comercial.
 *
 * O schema é o mesmo do app Python (`PROPOSTA PRN PDF/work/dados/*.json`) e o
 * mesmo da tabela `public.pdf_proposta_comercial` — os três precisam continuar
 * casando, senão um JSON exportado de lá para de abrir aqui.
 */

export interface Exame {
  /** Sigla no selo do mini-card do slide 4 (US, RX, TC…). */
  sigla: string
  /** Nome por extenso, usado na tabela de valores do slide 12. */
  nome: string
  volume: string
  /** `exames` ou `laudos` — entra como "220 exames/mês". */
  unidade: string
  /** Sem "R$": o template já põe o símbolo. */
  valor: string
}

export interface Case {
  cidade_uf: string
  numero: string
  unidade: string
  descricao: string
}

export interface DadosProposta {
  slug: string
  cliente: {
    nome: string
    cidade_uf: string
    /** `o` (Hospital) ou `a` (Clínica) — concorda com o nome no slide 4. */
    artigo: string
  }
  proposta: {
    cidade_emissao: string
    data: string
    validade: string
  }
  exames: Exame[]
  cases: Case[]
}

/**
 * O slide 4 monta os mini-cards de volumetria numa única linha
 * (`repeat(n, 1fr)`), e foi desenhado para no máximo 5. Acima disso o layout
 * não quebra sozinho: ele aperta, e só se percebe olhando o PDF.
 */
export const MAX_EXAMES_SEM_APERTO = 5

export const PROPOSTA_VAZIA: DadosProposta = {
  slug: '',
  cliente: { nome: '', cidade_uf: '', artigo: 'o' },
  proposta: { cidade_emissao: 'Joinville', data: '', validade: '90 dias' },
  exames: [],
  cases: [],
}

/**
 * Troca o token `{cliente}` pelo nome do cliente em qualquer string, recursivo.
 *
 * Existe para os textos de `cases`, escritos como "equipamentos equivalentes
 * aos da {cliente}" — assim o mesmo case serve para qualquer proposta.
 * Equivalente ao `resolve_token` de `gerar_proposta.py`.
 */
export function resolverToken<T>(valor: T, clienteNome: string): T {
  if (typeof valor === 'string') return valor.replaceAll('{cliente}', clienteNome) as T
  if (Array.isArray(valor)) return valor.map((v) => resolverToken(v, clienteNome)) as T
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor).map(([k, v]) => [k, resolverToken(v, clienteNome)]),
    ) as T
  }
  return valor
}

/**
 * `Hospital São Donato` -> `HOSPITAL SAO DONATO`.
 *
 * Porte do `nome_arquivo()` do Python: NFKD separa o acento da letra, o filtro
 * ASCII descarta o acento e o resto vira maiúscula sem pontuação. É o que
 * deixa o nome seguro para arquivo em qualquer sistema.
 */
export function nomeArquivo(nome: string): string {
  return nome
    .normalize('NFKD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** `Hospital São Donato` -> `hospital-sao-donato`. Chave da linha no banco. */
export function slugDe(nome: string): string {
  return nomeArquivo(nome).toLowerCase().replaceAll(' ', '-') || 'proposta'
}

/** O nome do PDF entregue ao cliente. */
export const nomeDoPdf = (clienteNome: string): string =>
  `PROPOSTA COMERCIAL PRN - ${nomeArquivo(clienteNome)}.pdf`
