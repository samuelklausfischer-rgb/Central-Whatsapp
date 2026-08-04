import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Ponte de sessão Central Whats -> projeto Licitações. Mesmo desenho da
// financeiro-bridge: recebe o access token do app principal, confere a permissão
// DE NOVO no servidor e devolve um OTP de uso único (hashed_token) para o app do
// Licitações trocar por uma sessão própria via verifyOtp.
//
// Roda no projeto Licitações (qndymclntzdrdhrwlcda), por isso verify_jwt = false:
// o JWT que chega é do projeto principal e o gateway daqui não saberia validá-lo.

// Config pública do projeto principal "Central Whats" (self-hosted).
// Não é segredo: é a mesma anon key que já vai no bundle do app
// (VITE_SUPABASE_PUBLISHABLE_KEY). Fica embutida aqui porque esta function vive
// em outro projeto Supabase, sem env compartilhada com o principal.
const MAIN_SUPABASE_URL = 'https://apps-supabase.srofjl.easypanel.host'
const MAIN_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzUyNzAwMDAwLCJleHAiOjIzODQ1MDAwMDB9.Gseqw0-_o6Nmwmz3mCWvgxjjCfJB1LhVgTV83uJe-F4'

const LICITACAO_SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const LICITACAO_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const TOOL = 'licitacoes'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const licitacaoServiceHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${LICITACAO_SERVICE_KEY}`,
  apikey: LICITACAO_SERVICE_KEY,
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function randomPassword() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

type Caller = { id: string; email: string; name: string | null }
type CallerResult = Caller | { error: Response }

async function verifyMainCaller(authHeader: string): Promise<CallerResult> {
  if (!authHeader) return { error: json({ error: 'Authorization header required' }, 401) }

  const userResp = await fetch(`${MAIN_SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: MAIN_SUPABASE_ANON_KEY },
  })
  if (!userResp.ok) return { error: json({ error: 'Invalid session' }, 401) }

  const authUser = await userResp.json()
  if (!authUser?.id || !authUser?.email) {
    return { error: json({ error: 'Invalid session' }, 401) }
  }

  // A liberação é lida com o token do PRÓPRIO usuário: a policy
  // tool_access_select_own_or_admin já garante que ele só enxerga a linha dele,
  // então uma linha ausente é indistinguível de "sem acesso" — que é o que
  // queremos. Nunca confiar no que o frontend mandou.
  const accessResp = await fetch(
    `${MAIN_SUPABASE_URL}/rest/v1/tool_access?user_id=eq.${encodeURIComponent(authUser.id)}&tool=eq.${TOOL}&select=tool`,
    { headers: { Authorization: authHeader, apikey: MAIN_SUPABASE_ANON_KEY } },
  )
  if (!accessResp.ok) return { error: json({ error: 'Unable to validate access' }, 500) }

  const rows = await accessResp.json()
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: json({ error: 'Licitações access required', reason: 'sem liberação' }, 403) }
  }

  const profileResp = await fetch(
    `${MAIN_SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=name`,
    { headers: { Authorization: authHeader, apikey: MAIN_SUPABASE_ANON_KEY } },
  )
  const profiles = profileResp.ok ? await profileResp.json() : []
  const name = Array.isArray(profiles) ? (profiles[0]?.name ?? null) : null

  return { id: authUser.id as string, email: authUser.email as string, name }
}

/** Mantém nome/email/status em dia no perfil do Licitações. NÃO mexe em `role`:
 *  o trigger on_auth_user_created já cria como 'admin', e sobrescrever aqui
 *  desfaria um rebaixamento feito de propósito na tela de Usuários. */
async function syncProfile(userId: string, email: string, name: string | null) {
  const patch: Record<string, unknown> = { email, status: 'active' }
  if (name) patch.name = name

  const resp = await fetch(
    `${LICITACAO_SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: { ...licitacaoServiceHeaders, Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    },
  )
  if (!resp.ok) return

  const updated = await resp.json().catch(() => [])
  if (Array.isArray(updated) && updated.length > 0) return

  // Nenhuma linha casou (trigger desligado ou perfil apagado à mão): cria.
  await fetch(`${LICITACAO_SUPABASE_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...licitacaoServiceHeaders, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id: userId, email, name, role: 'admin', status: 'active' }),
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  if (!LICITACAO_SUPABASE_URL || !LICITACAO_SERVICE_KEY) {
    return json({ error: 'Licitações Supabase environment not configured' }, 500)
  }

  const caller = await verifyMainCaller(req.headers.get('Authorization') || '')
  if ('error' in caller) return caller.error

  try {
    const createResp = await fetch(`${LICITACAO_SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: licitacaoServiceHeaders,
      body: JSON.stringify({
        email: caller.email,
        email_confirm: true,
        password: randomPassword(),
        user_metadata: { bridged_from: 'central-whats', main_user_id: caller.id, name: caller.name },
      }),
    })

    if (!createResp.ok) {
      const errText = await createResp.text()
      const alreadyExists = createResp.status === 422 || /already.*registered/i.test(errText)
      if (!alreadyExists) {
        return json({ error: `Failed to provision Licitações account: ${errText}` }, 502)
      }
    }

    const linkResp = await fetch(`${LICITACAO_SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: licitacaoServiceHeaders,
      body: JSON.stringify({ type: 'magiclink', email: caller.email }),
    })

    if (!linkResp.ok) {
      const errText = await linkResp.text()
      return json({ error: `Failed to generate Licitações session link: ${errText}` }, 502)
    }

    const link = await linkResp.json()
    const hashedToken = link?.hashed_token ?? link?.properties?.hashed_token
    const verificationType = link?.verification_type ?? link?.properties?.verification_type ?? 'magiclink'
    // O GoTrue devolve o próprio usuário junto do link; o formato varia entre
    // versões, então tentar as três formas antes de desistir.
    const licitacaoUserId = link?.user?.id ?? link?.id ?? link?.user_id ?? null

    if (!hashedToken) {
      return json({ error: 'Licitações session link missing hashed_token' }, 502)
    }

    if (licitacaoUserId) {
      await syncProfile(licitacaoUserId, caller.email, caller.name)
    }

    return json({ hashed_token: hashedToken, verification_type: verificationType })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})
