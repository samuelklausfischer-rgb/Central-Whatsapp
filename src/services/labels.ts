import supabase from '@/lib/supabase/client'
import type { Label } from '@/lib/supabase/types'

/**
 * Etiquetas da EQUIPE. Desde 26/08/2026 a RLS de SELECT é aberta a qualquer
 * pessoa logada (migration `20260826124244_etiquetas_compartilhadas`), então
 * esta função devolve as etiquetas de todo mundo — é o que faz a etiqueta do
 * colega aparecer no contato.
 *
 * Escrever continua sendo do dono ou de um admin. Quem chama precisa esconder
 * editar/apagar do que não é do usuário — ver `podeEditarEtiqueta`.
 *
 * NÃO lança, ao contrário das três funções de escrita abaixo. O `EmailHub` a
 * consome dentro de um `Promise.all([...]).then(...)` SEM `.catch`: uma exceção
 * aqui viraria rejeição não tratada e levaria junto contas e prompts, deixando a
 * caixa de entrada vazia por causa de uma etiqueta. Falhar a leitura de etiqueta
 * só pode custar a etiqueta.
 */
export const getLabels = async () => {
  const { data, error } = await supabase
    .from('labels')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) {
    console.error('Erro ao buscar etiquetas:', error)
    return []
  }
  return (data as Label[]) || []
}

/**
 * Quem pode renomear ou apagar uma etiqueta. Espelha exatamente as policies de
 * UPDATE e DELETE (`user_id = auth.uid() OR _is_admin()`) — a regra do banco é
 * a que vale; esta é só para não oferecer um botão que vai tomar 403.
 */
export const podeEditarEtiqueta = (
  label: Pick<Label, 'user_id'>,
  user: { id: string; is_admin?: boolean | null } | null | undefined,
) => !!user && (label.user_id === user.id || !!user.is_admin)

/*
 * As três funções abaixo IGNORAVAM `error` por completo (`const { data } =
 * await ...`). Enquanto cada um só enxergava as próprias etiquetas isso nunca
 * aparecia: não havia como esbarrar na RLS. Com a lista compartilhada passou a
 * haver — e um `delete` negado devolvia sucesso, com direito ao toast "Etiqueta
 * removida!" enquanto a etiqueta continuava lá.
 *
 * Os dois diálogos que chamam daqui (LabelsSettings e o GerenciarEtiquetasDialog
 * do ChatWindow) já têm `try/catch` esperando uma exceção que nunca chegava.
 */

export const createLabel = async (data: { name: string; color: string; user_id: string }) => {
  const { data: label, error } = await supabase.from('labels').insert(data).select().single()
  if (error) throw error
  return label as Label
}

export const updateLabel = async (id: string, data: Partial<{ name: string; color: string }>) => {
  const { data: label, error } = await supabase
    .from('labels')
    .update(data)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return label as Label
}

/**
 * Checar `error` NÃO basta aqui, ao contrário das outras três.
 *
 * Um DELETE barrado pela RLS não é um erro: o Postgres simplesmente não
 * encontra linha visível para apagar e devolve sucesso com zero linhas. Sem o
 * `.select()`, apagar a etiqueta de outra pessoa continuaria dizendo "Etiqueta
 * removida!" — que é exatamente o que esta mudança veio evitar.
 *
 * (`createLabel` e `updateLabel` não precisam do mesmo cuidado: o INSERT negado
 * levanta 42501, e o `.single()` do UPDATE transforma "zero linhas" em erro.)
 */
export const deleteLabel = async (id: string) => {
  const { data, error } = await supabase.from('labels').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Esta etiqueta é de outra pessoa — só quem criou (ou um admin) pode apagar.')
  }
}
