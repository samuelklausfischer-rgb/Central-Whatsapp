import supabase from '@/lib/supabase/client'

/**
 * Setores e quem participa de cada um (`public.user_sectors`).
 *
 * É esta tabela — e não `profiles.department` — que decide quem enxerga uma
 * caixa de e-mail de setor. A diferença importa: `profiles.department` é a
 * lotação principal, UMA por pessoa; `user_sectors` aceita várias, e existe
 * justamente porque há quem cubra dois setores.
 *
 * Não há tabela de setores: um setor EXISTE enquanto alguém estiver nele. Sem
 * cadastro separado não há como um setor virar órfão de gente e ninguém notar —
 * ele simplesmente some da lista quando esvazia.
 *
 * Escrita é só de admin, garantido pela policy `user_sectors_admin`. Leitura é
 * de qualquer pessoa logada, porque a tela precisa saber quem cobre o quê.
 */

export interface Pessoa {
  id: string
  name: string | null
  email: string | null
}

export interface Setor {
  nome: string
  membros: string[]
}

/** Todos os setores existentes, com quem participa de cada um. */
export async function listarSetores(): Promise<Setor[]> {
  const { data, error } = await supabase
    .from('user_sectors')
    .select('setor,user_id')
    .order('setor', { ascending: true })
  if (error) throw error

  const porSetor = new Map<string, string[]>()
  for (const l of data ?? []) {
    const nome = l.setor as string
    porSetor.set(nome, [...(porSetor.get(nome) ?? []), l.user_id as string])
  }
  return [...porSetor.entries()].map(([nome, membros]) => ({ nome, membros }))
}

/**
 * As pessoas que podem entrar num setor.
 *
 * A policy de `profiles` só devolve a lista inteira para admin (`id = uid() OR
 * _is_admin()`), então quem não é admin recebe apenas a si mesmo — e é por isso
 * que a tela só oferece este controle para administrador.
 */
export async function listarPessoas(): Promise<Pessoa[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,name,email')
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Pessoa[]
}

/**
 * Deixa o setor exatamente com estas pessoas.
 *
 * Calcula a diferença em vez de apagar tudo e reinserir: apagar primeiro
 * deixaria o setor vazio por um instante, e nesse intervalo a RLS esconderia as
 * caixas dele de todo mundo que estivesse com a tela aberta.
 */
export async function definirMembrosDoSetor(setor: string, userIds: string[]): Promise<void> {
  const atuais = (await listarSetores()).find((s) => s.nome === setor)?.membros ?? []

  const entrando = userIds.filter((id) => !atuais.includes(id))
  const saindo = atuais.filter((id) => !userIds.includes(id))

  if (entrando.length > 0) {
    const { error } = await supabase
      .from('user_sectors')
      .insert(entrando.map((user_id) => ({ user_id, setor })))
    if (error) throw error
  }

  if (saindo.length > 0) {
    const { error } = await supabase
      .from('user_sectors')
      .delete()
      .eq('setor', setor)
      .in('user_id', saindo)
    if (error) throw error
  }
}
