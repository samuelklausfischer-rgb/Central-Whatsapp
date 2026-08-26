import supabase from '@/lib/supabase/client'

/**
 * O que a equipe registra SOBRE um e-mail: quem cuida, o que é, e por quê.
 *
 * Existe para a leitura humana melhorar agora e para a automação da fase
 * seguinte ter o que ler. Por isso a classificação vem de uma lista controlada
 * (`email_classificacoes`) em vez de texto livre: regra que depende de alguém
 * ter digitado "Importante" com I maiúsculo não é regra.
 */

export interface Classificacao {
  chave: string
  rotulo: string
  cor: string
  ordem: number
}

export interface Responsavel {
  id: string
  email_id: string
  user_id: string
  /** `responsavel` tem que resolver; `acompanhando` só precisa saber. */
  papel: 'responsavel' | 'acompanhando'
  created_at: string
}

export interface Etiqueta {
  id: string
  nome: string
  cor: string
}

/** Tudo o que foi registrado sobre um e-mail, numa ida só ao banco. */
export interface OrganizacaoDoEmail {
  classificacao: string | null
  descricao: string | null
  responsaveis: Responsavel[]
  etiquetas: Etiqueta[]
}

export async function getClassificacoes(): Promise<Classificacao[]> {
  const { data, error } = await supabase
    .from('email_classificacoes')
    .select('chave,rotulo,cor,ordem')
    .eq('ativo', true)
    .order('ordem', { ascending: true })
  if (error) throw error
  return (data ?? []) as Classificacao[]
}

export async function getEtiquetas(): Promise<Etiqueta[]> {
  const { data, error } = await supabase
    .from('email_etiquetas')
    .select('id,nome,cor')
    .order('nome', { ascending: true })
  if (error) throw error
  return (data ?? []) as Etiqueta[]
}

export async function criarEtiqueta(nome: string, cor: string): Promise<Etiqueta> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('email_etiquetas')
    .insert({ nome: nome.trim(), cor, created_by: user?.id })
    .select('id,nome,cor')
    .single()
  if (error) throw error
  return data as Etiqueta
}

/** O que já foi registrado sobre este e-mail. */
export async function getOrganizacao(emailId: string): Promise<OrganizacaoDoEmail> {
  const [estado, resp, etiq] = await Promise.all([
    supabase.from('email_states')
      .select('classificacao,internal_note')
      .eq('email_id', emailId)
      .maybeSingle(),
    supabase.from('email_responsaveis')
      .select('*')
      .eq('email_id', emailId),
    supabase.from('email_etiqueta_itens')
      .select('etiqueta_id, email_etiquetas(id,nome,cor)')
      .eq('email_id', emailId),
  ])

  if (estado.error) throw estado.error
  if (resp.error) throw resp.error
  if (etiq.error) throw etiq.error

  return {
    classificacao: estado.data?.classificacao ?? null,
    descricao: estado.data?.internal_note ?? null,
    responsaveis: (resp.data ?? []) as Responsavel[],
    // O join devolve a etiqueta aninhada; achatar aqui evita cada tela ter de
    // saber o formato do PostgREST.
    etiquetas: (etiq.data ?? [])
      .map((l: any) => l.email_etiquetas)
      .filter(Boolean) as Etiqueta[],
  }
}

/**
 * Grava classificação e descrição.
 *
 * `upsert` por `email_id` porque a linha de estado pode não existir ainda — o
 * e-mail entra no banco pela sincronização, e o estado só nasce quando alguém
 * organiza. Exigir que a linha exista antes obrigaria toda tela a criar
 * primeiro, e alguém esqueceria.
 */
export async function salvarTriagem(
  emailId: string,
  dados: { classificacao?: string | null; descricao?: string | null },
): Promise<void> {
  const linha: Record<string, unknown> = { email_id: emailId, updated_at: new Date().toISOString() }
  if ('classificacao' in dados) linha.classificacao = dados.classificacao
  if ('descricao' in dados) linha.internal_note = dados.descricao

  const { error } = await supabase
    .from('email_states')
    .upsert(linha, { onConflict: 'email_id' })
  if (error) throw error
}

/**
 * Deixa o e-mail exatamente com estas pessoas.
 *
 * Calcula a diferença em vez de apagar tudo e reinserir: apagar primeiro
 * deixaria o e-mail sem responsável por um instante — e é justamente nesse
 * instante que um alerta automático de "ninguém cuidando" dispararia sozinho.
 */
export async function definirResponsaveis(
  emailId: string,
  pessoas: { user_id: string; papel: 'responsavel' | 'acompanhando' }[],
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()

  const { data: atuais, error: erroLer } = await supabase
    .from('email_responsaveis')
    .select('id,user_id,papel')
    .eq('email_id', emailId)
  if (erroLer) throw erroLer

  const agora = new Map(pessoas.map((p) => [p.user_id, p.papel]))
  const antes = new Map((atuais ?? []).map((a: any) => [a.user_id as string, a.papel as string]))

  const saindo = [...antes.keys()].filter((id) => !agora.has(id))
  if (saindo.length > 0) {
    const { error } = await supabase
      .from('email_responsaveis')
      .delete()
      .eq('email_id', emailId)
      .in('user_id', saindo)
    if (error) throw error
  }

  // Entrando ou mudando de papel — o mesmo upsert resolve os dois.
  const gravar = pessoas.filter((p) => antes.get(p.user_id) !== p.papel)
  if (gravar.length > 0) {
    const { error } = await supabase
      .from('email_responsaveis')
      .upsert(
        gravar.map((p) => ({ email_id: emailId, ...p, definido_por: user?.id })),
        { onConflict: 'email_id,user_id' },
      )
    if (error) throw error
  }
}

export async function definirEtiquetas(emailId: string, etiquetaIds: string[]): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()

  const { data: atuais, error: erroLer } = await supabase
    .from('email_etiqueta_itens')
    .select('etiqueta_id')
    .eq('email_id', emailId)
  if (erroLer) throw erroLer

  const antes = new Set((atuais ?? []).map((a: any) => a.etiqueta_id as string))
  const agora = new Set(etiquetaIds)

  const saindo = [...antes].filter((id) => !agora.has(id))
  if (saindo.length > 0) {
    const { error } = await supabase
      .from('email_etiqueta_itens')
      .delete()
      .eq('email_id', emailId)
      .in('etiqueta_id', saindo)
    if (error) throw error
  }

  const entrando = [...agora].filter((id) => !antes.has(id))
  if (entrando.length > 0) {
    const { error } = await supabase
      .from('email_etiqueta_itens')
      .insert(entrando.map((etiqueta_id) => ({ email_id: emailId, etiqueta_id, created_by: user?.id })))
    if (error) throw error
  }
}

/**
 * A organização de VÁRIOS e-mails de uma vez, para a lista.
 *
 * A lista precisa mostrar a classificação e quem é responsável em cada linha.
 * Buscar um a um seriam 100 idas ao banco ao abrir uma pasta — aqui são duas.
 */
export async function getOrganizacaoEmLote(emailIds: string[]): Promise<
  Record<string, { classificacao: string | null; responsaveis: string[] }>
> {
  if (emailIds.length === 0) return {}

  const [estados, resp] = await Promise.all([
    supabase.from('email_states').select('email_id,classificacao').in('email_id', emailIds),
    supabase.from('email_responsaveis').select('email_id,user_id').in('email_id', emailIds),
  ])
  if (estados.error) throw estados.error
  if (resp.error) throw resp.error

  const mapa: Record<string, { classificacao: string | null; responsaveis: string[] }> = {}
  for (const id of emailIds) mapa[id] = { classificacao: null, responsaveis: [] }
  for (const e of estados.data ?? []) {
    if (mapa[e.email_id]) mapa[e.email_id].classificacao = e.classificacao ?? null
  }
  for (const r of resp.data ?? []) {
    if (mapa[r.email_id]) mapa[r.email_id].responsaveis.push(r.user_id)
  }
  return mapa
}
