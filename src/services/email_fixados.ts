import { supabase } from '@/lib/supabase/client'

/**
 * Fixar um e-mail com etiqueta de urgência e lembrete de leitura.
 *
 * A tabela `email_fixados` já existe em produção (fila 25/09/2026, item 2) —
 * este serviço só fala com ela, nunca a cria nem a altera.
 *
 * ⚠️ Fixar é PESSOAL, de propósito. `email_states` tem `email_id` ÚNICO — uma
 * linha por e-mail, do time inteiro — e não serve para isto: duas pessoas
 * precisam poder fixar o MESMO e-mail com etiquetas e horários diferentes
 * (uma marca "urgente, ler agora", outra "ler depois, sem pressa"). Por isso
 * `email_fixados` é única por (usuário, e-mail), e compartilhar só MOSTRA o
 * pin ao colega — a RLS recusa qualquer escrita de quem não é o dono.
 */

export type EtiquetaFixado = 'urgente' | 'importante' | 'ler_depois'

export interface Fixado {
  id: string
  user_id: string
  email_id: string
  etiqueta: EtiquetaFixado
  ler_em: string | null
  compartilhado: boolean
  criado_em: string
  atualizado_em: string
}

/**
 * Colunas que o app lê. De propósito SEM `avisado_antes_em` / `avisado_na_hora_em`
 * / `avisado_atraso_em`: essas três são do agendador (`private.processar_lembretes_de_email`,
 * roda a cada minuto) — o app nunca decide "já avisei", só o cron decide, e
 * trazer essas colunas para cá só convidaria alguém a gravar nelas por engano
 * num `upsert` futuro.
 */
const COLUNAS = 'id,user_id,email_id,etiqueta,ler_em,compartilhado,criado_em,atualizado_em'

/**
 * Pins visíveis para os e-mails que estão NA TELA agora — uma ida só ao
 * banco (`.in('email_id', ids)`), nunca um `select` por e-mail. A lista pode
 * trazer até 100 linhas, e perguntar uma a uma custaria 100 idas ao banco
 * toda vez que alguém abre uma pasta.
 *
 * A RLS já filtra o que pode voltar: o pin do próprio usuário sempre, e o de
 * um colega só quando `compartilhado = true`. Isso pode trazer DUAS linhas
 * para o MESMO e-mail (a minha e a de um colega que compartilhou) — o mapa
 * devolve só UMA por e-mail, e a MINHA tem prioridade sobre a do colega:
 * é ela que decide se eu posso editar ou desfixar, e é ela que deve mandar
 * no destaque que EU vejo. O pin do colega só aparece aqui quando eu não
 * tenho pin próprio naquele e-mail.
 */
export async function getFixados(emailIds: string[]): Promise<Record<string, Fixado>> {
  if (emailIds.length === 0) return {}

  const [{ data: userData }, resultado] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('email_fixados').select(COLUNAS).in('email_id', emailIds),
  ])
  if (resultado.error) throw resultado.error

  const meuId = userData.user?.id
  const mapa: Record<string, Fixado> = {}
  for (const linha of (resultado.data ?? []) as Fixado[]) {
    const atual = mapa[linha.email_id]
    if (!atual || linha.user_id === meuId) mapa[linha.email_id] = linha
  }
  return mapa
}

/**
 * Fixa (ou atualiza) o pin do usuário atual sobre um e-mail.
 *
 * `upsert` com `onConflict: 'user_id,email_id'` — o unique que arbitra o
 * conflito é COMPLETO, não parcial, de propósito (ver o comentário da
 * migration): índice parcial não serve de árbitro para `on conflict`, e essa
 * troca já custou caro neste projeto em outra tabela.
 *
 * `ler_em: null` é um caso válido, não um erro — fixar sem marcar horário é
 * "deixa no topo que eu vejo depois", sem lembrete nenhum.
 */
export async function fixarEmail(input: {
  email_id: string
  etiqueta: EtiquetaFixado
  ler_em: string | null
  compartilhado: boolean
}): Promise<Fixado> {
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) throw new Error('Sessão expirada. Entre no app de novo.')

  const { data, error } = await supabase
    .from('email_fixados')
    .upsert(
      {
        user_id: userData.user.id,
        email_id: input.email_id,
        etiqueta: input.etiqueta,
        ler_em: input.ler_em,
        compartilhado: input.compartilhado,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'user_id,email_id' },
    )
    .select(COLUNAS)
    .single()
  if (error) throw error
  return data as Fixado
}

/**
 * Remove o pin do usuário atual sobre um e-mail.
 *
 * Filtra por `user_id` além de `email_id` por clareza — a RLS (`using
 * (user_id = auth.uid())`) já impediria apagar o pin de outra pessoa, mas
 * deixar explícito aqui evita depender só da policy para quem ler o código.
 */
export async function desfixarEmail(email_id: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return
  const { error } = await supabase
    .from('email_fixados')
    .delete()
    .eq('email_id', email_id)
    .eq('user_id', userData.user.id)
  if (error) throw error
}
