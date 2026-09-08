import { supabase } from '@/lib/supabase/client'
import type { ImagemEmbutida } from '@/lib/email/assinatura-embutida'

/**
 * Ajustes pessoais do Email Hub, guardados em `profiles.email_prefs`.
 *
 * Fica no PERFIL e não em `email_accounts` porque a caixa de setor
 * (`financeiro@`, `suportelaudos@`) é uma linha só, compartilhada por todo mundo
 * do setor — e a policy de escrita de lá exige admin nesse caso. A assinatura
 * seria uma só para o setor inteiro, editável por quase ninguém. Aqui cada
 * pessoa tem a sua, e ela vale em qualquer caixa que ela use.
 *
 * Nenhuma policy nova foi precisa: `users_update_own_profile` já deixa cada um
 * atualizar qualquer coluna do próprio perfil menos `is_admin`.
 */
export interface EmailPrefs {
  /**
   * O corpo da assinatura. As imagens dela NÃO estão aqui: viraram `cid:` e
   * moram em `assinatura_imagens`. Vazio ou ausente = sem assinatura.
   */
  assinatura_html?: string
  /**
   * As imagens da assinatura, para irem como anexo EMBUTIDO no envio.
   *
   * Existem porque Gmail remove imagem `data:` e Outlook de mesa a bloqueia —
   * então o que funciona é o mesmo caminho que o Outlook usa: anexo com
   * `contentId` e `<img src="cid:…">` no corpo. Ver `lib/email/assinatura-embutida.ts`.
   */
  assinatura_imagens?: ImagemEmbutida[]
  /** De onde veio, só para a tela saber o que dizer. */
  assinatura_origem?: 'gerador' | 'colada'
}

export async function getEmailPrefs(userId: string): Promise<EmailPrefs> {
  const { data, error } = await supabase
    .from('profiles')
    .select('email_prefs')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return (data?.email_prefs as EmailPrefs | null) ?? {}
}

/**
 * Grava mesclando com o que já existe.
 *
 * A mescla é feita AQUI, e não com o operador `||` do jsonb no banco, porque um
 * `update` do PostgREST substitui a coluna inteira: gravar só a assinatura
 * apagaria qualquer outro ajuste que venha a morar neste mesmo objeto (a caixa
 * padrão ao abrir, por exemplo, que já está prevista).
 */
export async function salvarEmailPrefs(userId: string, mudanca: EmailPrefs): Promise<EmailPrefs> {
  const atuais = await getEmailPrefs(userId)
  const novas = { ...atuais, ...mudanca }
  const { error } = await supabase
    .from('profiles')
    .update({ email_prefs: novas })
    .eq('id', userId)
  if (error) throw error
  return novas
}
