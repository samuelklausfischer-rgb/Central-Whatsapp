import supabase from '@/lib/supabase/client'
import { appEnv } from '@/lib/env'

/**
 * Conversa com a edge function `email-microsoft`.
 *
 * Nenhuma chamada à Microsoft sai daqui: o `refresh_token` da caixa não pode
 * existir no navegador, e o banco impede isso — os tokens moram em
 * `email_account_tokens`, tabela com RLS ligada e sem policy nenhuma. Este
 * arquivo só fala com a nossa função.
 *
 * Espelha `agenda_microsoft.ts`, que faz o mesmo para a agenda.
 */

const BASE = `${appEnv.VITE_SUPABASE_URL}/functions/v1/email-microsoft`

export interface StatusDoEmail {
  /** As chaves do aplicativo já foram cadastradas? */
  configurado: boolean
  /** Quem está olhando é administrador? Vem do servidor, não do perfil local. */
  admin: boolean
}

export interface PedidoDeConexao {
  tipo: 'pessoal' | 'setor'
  label?: string
  /** Só para caixa de setor. */
  department?: string
  /** Endereço esperado — o servidor recusa o retorno se entrar outra caixa. */
  expected_email?: string
}

async function chamar(rota: string, corpo?: unknown) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sessão não encontrada. Saia e entre novamente.')

  const resp = await fetch(`${BASE}/${rota}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })

  const dados = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(dados?.error || `Falha ao falar com a Microsoft (${resp.status})`)
  return dados
}

export async function getStatus(): Promise<StatusDoEmail> {
  try {
    return (await chamar('status')) as StatusDoEmail
  } catch {
    // Função ainda não publicada ou servidor fora do ar não pode derrubar a
    // tela: ela precisa conseguir dizer "não configurado" em vez de estourar.
    return { configurado: false, admin: false }
  }
}

/**
 * Grava as três chaves do aplicativo do Entra ID.
 *
 * O segredo vai daqui direto para a edge function, por HTTPS, e é gravado com
 * papel de serviço. Não fica em lugar nenhum do navegador e não volta: para
 * saber se está configurado, a tela pergunta ao `status`.
 */
export async function configurar(chaves: {
  client_id: string
  tenant_id: string
  client_secret: string
}): Promise<void> {
  await chamar('configurar', chaves)
}

/**
 * Abre o consentimento da Microsoft numa aba nova.
 *
 * Aba nova, e não navegação na mesma janela, porque o retorno cai na edge
 * function e não no app. Assim funciona igual na web, no Electron (que roda em
 * `file://` e não teria para onde voltar) e no Android.
 */
export async function conectar(pedido: PedidoDeConexao): Promise<void> {
  const { url } = (await chamar('authorize', pedido)) as { url: string }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export async function desconectar(accountId: string): Promise<void> {
  await chamar('desconectar', { account_id: accountId })
}

/*
  A lista de setores mora em `services/setores.ts`, junto de quem participa de
  cada um. Setor não é assunto de e-mail: quem decide o acesso é `user_sectors`,
  e a mesma tabela serve a outras partes do sistema.
*/
