import { supabase } from '@/lib/supabase/client'
import type { EmailState } from '@/lib/supabase/email-types'

/**
 * Atribuição de e-mail a uma pessoa da equipe — item 3 da fila de 25/09/2026.
 *
 * O pedido do Samuel: "poder atribuir um email que chegou para uma pessoa da
 * equipe do setor, assim como funciona o Whats do PRN Hub", e "grudar" um
 * remetente numa pessoa para o e-mail futuro cair direto nela.
 *
 * A atribuição em si é só uma coluna que JÁ EXISTE: `email_states.assigned_to`
 * (a mesma tabela do status aberto/respondido/aguardando/fechado). A tabela
 * está com 0 linhas hoje — a triagem nunca foi usada — então quase toda
 * chamada daqui cria a linha na hora, e por isso os `upsert` abaixo, nunca
 * `update` puro (que não faz nada quando a linha não existe).
 *
 * A regra do remetente grudado (`email_remetentes_fixos` e as RPCs
 * `email_grudar_remetente`/`email_desgrudar_remetente`) já existe em produção
 * — este arquivo só fala com ela, nunca cria nem altera tabela.
 *
 * ⚠️ POR QUE A REGRA MORA NO BANCO, e não aqui: os e-mails entram por upsert
 * da edge function `email-microsoft`, não pela tela. Um gatilho no banco
 * (`emails_aplica_remetente_fixo`) é quem aplica a regra ao e-mail que chega —
 * esta tela só cria/apaga a regra e conta quanto ela vai afetar do que já
 * está na caixa. Nenhuma linha aqui participa do roteamento de e-mail novo.
 */

/** Uma pessoa da equipe, como a RPC `colegas()` a devolve. */
export interface Colega {
  id: string
  nome: string
  setor: string | null
}

/**
 * A equipe inteira, para escolher a quem atribuir.
 *
 * ⚠️ NÃO use `listarPessoas()` de `services/setores.ts` aqui, por mais que o
 * nome pareça o certo: ela faz `select` direto em `profiles`, e a policy
 * `users_read_own_profile` é `(id = auth.uid()) OR _is_admin()`. Ou seja,
 * quem não é admin recebe **só a si mesmo** — e o seletor de "atribuir para
 * alguém da equipe" chegaria vazio para 13 das 19 pessoas.
 *
 * `public.colegas()` existe exatamente para isso: é `SECURITY DEFINER`, então
 * atravessa a policy, e ainda assim só responde para quem está autenticado
 * (`where auth.uid() is not null`).
 */
export async function listarColegas(): Promise<Colega[]> {
  const { data, error } = await supabase.rpc('colegas')
  if (error) throw error
  return ((data ?? []) as { id: string; nome: string | null; setor: string | null }[]).map((c) => ({
    id: c.id,
    nome: c.nome || 'sem nome',
    setor: c.setor,
  }))
}

export interface AtribuicaoDoEmail {
  assigned_to: string | null
  status: EmailState['status']
}

const COLUNAS_ATRIBUICAO = 'email_id,assigned_to,status'

/**
 * Busca em LOTE quem é o dono de cada e-mail da lista — nunca um `select` por
 * e-mail (mesmo molde de `getFixados`/`getOrganizacaoEmLote`: cem e-mails na
 * tela não podem virar cem idas ao banco).
 *
 * E-mail sem linha em `email_states` (a maioria, hoje) simplesmente não entra
 * no mapa — quem chama trata "ausente" como "sem dono", que é a leitura certa.
 */
export async function getAtribuicoes(emailIds: string[]): Promise<Record<string, AtribuicaoDoEmail>> {
  if (emailIds.length === 0) return {}
  const { data, error } = await supabase
    .from('email_states')
    .select(COLUNAS_ATRIBUICAO)
    .in('email_id', emailIds)
  if (error) throw error

  const mapa: Record<string, AtribuicaoDoEmail> = {}
  for (const linha of (data ?? []) as { email_id: string; assigned_to: string | null; status: EmailState['status'] }[]) {
    mapa[linha.email_id] = { assigned_to: linha.assigned_to, status: linha.status }
  }
  return mapa
}

/**
 * Atribui (ou tira, com `userId = null`) o dono de UM e-mail.
 *
 * `upsert` com `onConflict: 'email_id'` — a linha pode não existir ainda.
 *
 * O status atual é PRESERVADO de propósito: sem ler antes, um `upsert` que só
 * manda `assigned_to` reabriria (`status: 'open'`) todo e-mail já fechado ou
 * aguardando só porque alguém trocou o dono. Isso espelha o que o gatilho do
 * banco já faz em `email_aplicar_remetente_fixo`/`email_grudar_remetente`:
 * eles fazem `on conflict ... do update set assigned_to = ...` SEM tocar em
 * `status`. Aqui, sem um `on conflict do update` parcial disponível pelo
 * cliente, o mesmo efeito sai lendo o status antes e reenviando-o.
 */
export async function atribuirEmail(emailId: string, userId: string | null): Promise<void> {
  const { data: atual } = await supabase
    .from('email_states')
    .select('status')
    .eq('email_id', emailId)
    .maybeSingle()

  const { error } = await supabase
    .from('email_states')
    .upsert(
      {
        email_id: emailId,
        assigned_to: userId,
        status: atual?.status ?? 'open',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'email_id' },
    )
  if (error) throw error
}

/** Uma regra de "remetente grudado" — quem grava é sempre a RPC, nunca um `insert` direto. */
export interface RemetenteFixo {
  id: string
  account_id: string
  remetente: string
  user_id: string
  criado_por: string | null
  criado_em: string
}

/** As regras de remetente grudado desta caixa. */
export async function getRemetentesFixos(accountId: string): Promise<RemetenteFixo[]> {
  const { data, error } = await supabase
    .from('email_remetentes_fixos')
    .select('id,account_id,remetente,user_id,criado_por,criado_em')
    .eq('account_id', accountId)
    .order('criado_em', { ascending: false })
  if (error) throw error
  return (data ?? []) as RemetenteFixo[]
}

/**
 * Gruda um remetente numa pessoa: e-mail futuro cai direto nela (gatilho do
 * banco), e a RPC já atribui na hora o que já chegou dessa pessoa e ainda não
 * tinha dono. Devolve QUANTOS e-mails foram atribuídos agora — é esse número
 * que a tela mostra depois de confirmar, para não deixar "grudei" parecendo
 * que não fez nada quando na real distribuiu passado inteiro.
 */
export async function grudarRemetente(accountId: string, remetente: string, userId: string): Promise<number> {
  const { data, error } = await supabase.rpc('email_grudar_remetente', {
    p_account_id: accountId,
    p_remetente: remetente,
    p_user_id: userId,
  })
  if (error) throw error
  return (data as number) ?? 0
}

/** Tira só a REGRA. Quem já foi atribuído continua com dono — ver a RPC. */
export async function desgrudarRemetente(accountId: string, remetente: string): Promise<void> {
  const { error } = await supabase.rpc('email_desgrudar_remetente', {
    p_account_id: accountId,
    p_remetente: remetente,
  })
  if (error) throw error
}

/**
 * Quantos e-mails deste remetente, nesta caixa, AINDA NÃO TÊM DONO — para
 * avisar ANTES de grudar. Medido em produção: um remetente real tem 460
 * e-mails na caixa; sem este número na tela, "grudar" pareceria uma ação de
 * uma linha só e a pessoa dispararia uma atribuição em massa sem saber.
 *
 * Duas contagens (`count: 'exact', head: true`, sem baixar linha nenhuma) em
 * vez de tentar um filtro só com JOIN e `is null`: filtrar coluna de tabela
 * embutida com `is null` mistura semântica de inner/left join de um jeito que
 * este projeto não tem outro caso testado para confirmar — a subtração de
 * duas contagens simples usa o MESMO padrão já provado em `email_states.ts`
 * (`emails!inner(...)` + `.eq('emails.coluna', ...)`), sem essa ambiguidade.
 */
export async function contarEmailsSemDono(accountId: string, remetente: string): Promise<number> {
  const alvo = remetente.trim()

  const [totalResp, comDonoResp] = await Promise.all([
    supabase
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .ilike('from_email', alvo),
    supabase
      .from('email_states')
      .select('email_id, emails!inner(account_id, from_email)', { count: 'exact', head: true })
      .eq('emails.account_id', accountId)
      .ilike('emails.from_email', alvo)
      .not('assigned_to', 'is', null),
  ])
  if (totalResp.error) throw totalResp.error
  if (comDonoResp.error) throw comDonoResp.error

  return Math.max(0, (totalResp.count ?? 0) - (comDonoResp.count ?? 0))
}
