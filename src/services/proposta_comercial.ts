import supabase from '@/lib/supabase/client'
import type { Case, DadosProposta, Exame } from '@/lib/proposta/dados'

/**
 * Histórico de propostas comerciais (`public.pdf_proposta_comercial`).
 *
 * A tabela já existia: foi criada para o app Python, que gravava nela pelo
 * PostgREST com a service key. Aqui a gravação é com a sessão de quem está
 * logado — a policy `pdf_proposta_authenticated_all` libera leitura e escrita
 * para `authenticated`, então quem enxerga o menu enxerga o histórico inteiro.
 * Isso é de propósito: a proposta é da empresa, não de quem digitou.
 *
 * O `slug` é a chave de negócio (UNIQUE): regerar a proposta do mesmo cliente
 * atualiza a linha em vez de criar outra.
 */

interface LinhaProposta {
  slug: string
  cliente_nome: string
  cliente_cidade_uf: string
  cliente_artigo: string
  proposta: DadosProposta['proposta']
  exames: Exame[]
  cases: Case[]
  updated_at: string
}

export interface ItemHistorico {
  slug: string
  clienteNome: string
  clienteCidadeUf: string
  atualizadoEm: string
}

/** Grava (ou atualiza) a proposta. Chamado a cada geração de PDF. */
export const salvarProposta = async (d: DadosProposta): Promise<void> => {
  const { error } = await supabase.from('pdf_proposta_comercial').upsert(
    {
      slug: d.slug,
      cliente_nome: d.cliente.nome,
      cliente_cidade_uf: d.cliente.cidade_uf,
      cliente_artigo: d.cliente.artigo,
      proposta: d.proposta,
      exames: d.exames,
      cases: d.cases,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'slug' },
  )
  if (error) throw error
}

/** As propostas já geradas, da mais recente para a mais antiga. */
export const listarPropostas = async (): Promise<ItemHistorico[]> => {
  const { data, error } = await supabase
    .from('pdf_proposta_comercial')
    .select('slug, cliente_nome, cliente_cidade_uf, updated_at')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return ((data as LinhaProposta[]) || []).map((r) => ({
    slug: r.slug,
    clienteNome: r.cliente_nome,
    clienteCidadeUf: r.cliente_cidade_uf,
    atualizadoEm: r.updated_at,
  }))
}

/** Uma proposta inteira, no formato que o formulário e o motor esperam. */
export const carregarProposta = async (slug: string): Promise<DadosProposta | null> => {
  const { data, error } = await supabase
    .from('pdf_proposta_comercial')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const r = data as LinhaProposta
  return {
    slug: r.slug,
    cliente: {
      nome: r.cliente_nome,
      cidade_uf: r.cliente_cidade_uf,
      artigo: r.cliente_artigo || 'o',
    },
    // Colunas jsonb: o banco devolve o que foi gravado, mas uma linha antiga
    // pode não ter todos os campos — os padrões evitam `undefined` no template.
    // Espalhamos `r.proposta` inteiro para que os textos editáveis (objeto,
    // entendimento, pagamento, base_legal, manifestacao) voltem ao reabrir.
    proposta: {
      ...(r.proposta || {}),
      cidade_emissao: r.proposta?.cidade_emissao || 'Joinville',
      data: r.proposta?.data || '',
      validade: r.proposta?.validade || '90 dias',
    },
    exames: r.exames || [],
    cases: r.cases || [],
  }
}

export const excluirProposta = async (slug: string): Promise<void> => {
  const { error } = await supabase.from('pdf_proposta_comercial').delete().eq('slug', slug)
  if (error) throw error
}
