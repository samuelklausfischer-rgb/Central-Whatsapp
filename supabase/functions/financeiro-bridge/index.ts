import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Public config for the MAIN "Central Whats" Supabase project (self-hosted).
// Non-secret: this is the same anon key already shipped in the app's client
// bundle (VITE_SUPABASE_PUBLISHABLE_KEY). Safe to embed here since this
// function lives in a different Supabase project (Financeiro) with no shared
// env/secrets store with the main project.
const MAIN_SUPABASE_URL = 'https://apps-supabase.srofjl.easypanel.host'
const MAIN_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzUyNzAwMDAwLCJleHAiOjIzODQ1MDAwMDB9.Gseqw0-_o6Nmwmz3mCWvgxjjCfJB1LhVgTV83uJe-F4'

const FINANCEIRO_SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const FINANCEIRO_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const FINANCEIRO_DEPARTMENT = 'Financeiro'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const financeiroServiceHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${FINANCEIRO_SERVICE_KEY}`,
  apikey: FINANCEIRO_SERVICE_KEY,
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

// Decodes JWT claims only (no signature verification) — used purely to log
// non-sensitive context (exp/iat/aud/iss) when the upstream call rejects the
// caller's token, so we can tell expiry/skew apart from other rejection
// reasons without ever logging the token itself.
function decodeJwtClaims(authHeader: string): Record<string, unknown> | null {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(normalized))
  } catch {
    return null
  }
}

type CallerResult = { email: string; id: string } | { error: Response }

async function verifyMainCaller(authHeader: string): Promise<CallerResult> {
  if (!authHeader) return { error: json({ error: 'Authorization header required' }, 401) }

  const claims = decodeJwtClaims(authHeader)
  const userResp = await fetch(`${MAIN_SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: MAIN_SUPABASE_ANON_KEY },
  })

  if (!userResp.ok) {
    const bodyText = await userResp.text().catch(() => '<unreadable>')
    console.log(JSON.stringify({
      scope: 'financeiro_bridge',
      stage: 'verify_main_caller_failed',
      status: userResp.status,
      statusText: userResp.statusText,
      bodyText: bodyText.slice(0, 500),
      tokenExp: claims?.exp ?? null,
      tokenIat: claims?.iat ?? null,
      tokenAud: claims?.aud ?? null,
      tokenIss: claims?.iss ?? null,
      nowUnix: Math.floor(Date.now() / 1000),
      authHeaderPrefix: authHeader.slice(0, 15),
    }))
    return { error: json({ error: 'Invalid session', reason: bodyText.slice(0, 200) }, 401) }
  }

  const authUser = await userResp.json()
  if (!authUser?.id || !authUser?.email) {
    console.log(JSON.stringify({
      scope: 'financeiro_bridge',
      stage: 'verify_main_caller_missing_fields',
      authUser,
    }))
    return { error: json({ error: 'Invalid session', reason: 'missing id/email on user response' }, 401) }
  }

  const profileResp = await fetch(
    `${MAIN_SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=is_admin,department`,
    { headers: { Authorization: authHeader, apikey: MAIN_SUPABASE_ANON_KEY } },
  )
  if (!profileResp.ok) {
    const bodyText = await profileResp.text().catch(() => '<unreadable>')
    console.log(JSON.stringify({
      scope: 'financeiro_bridge',
      stage: 'verify_main_caller_profile_failed',
      status: profileResp.status,
      bodyText: bodyText.slice(0, 500),
    }))
    return { error: json({ error: 'Unable to validate profile', reason: bodyText.slice(0, 200) }, 500) }
  }

  const profiles = await profileResp.json()
  const profile = Array.isArray(profiles) ? profiles[0] : null
  const eligible = Boolean(profile?.is_admin || profile?.department === FINANCEIRO_DEPARTMENT)
  if (!eligible) return { error: json({ error: 'Financeiro access required' }, 403) }

  return { email: authUser.email as string, id: authUser.id as string }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  if (!FINANCEIRO_SUPABASE_URL || !FINANCEIRO_SERVICE_KEY) {
    return json({ error: 'Financeiro Supabase environment not configured' }, 500)
  }

  const caller = await verifyMainCaller(req.headers.get('Authorization') || '')
  if ('error' in caller) return caller.error

  try {
    const createResp = await fetch(`${FINANCEIRO_SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: financeiroServiceHeaders,
      body: JSON.stringify({
        email: caller.email,
        email_confirm: true,
        password: randomPassword(),
        user_metadata: { bridged_from: 'central-whats', main_user_id: caller.id },
      }),
    })

    if (!createResp.ok) {
      const errText = await createResp.text()
      const alreadyExists = createResp.status === 422 || /already.*registered/i.test(errText)
      if (!alreadyExists) {
        return json({ error: `Failed to provision Financeiro account: ${errText}` }, 502)
      }
    }

    const linkResp = await fetch(`${FINANCEIRO_SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: financeiroServiceHeaders,
      body: JSON.stringify({ type: 'magiclink', email: caller.email }),
    })

    if (!linkResp.ok) {
      const errText = await linkResp.text()
      return json({ error: `Failed to generate Financeiro session link: ${errText}` }, 502)
    }

    const link = await linkResp.json()
    const hashedToken = link?.hashed_token ?? link?.properties?.hashed_token
    const verificationType = link?.verification_type ?? link?.properties?.verification_type ?? 'magiclink'

    if (!hashedToken) {
      return json({ error: 'Financeiro session link missing hashed_token' }, 502)
    }

    return json({ hashed_token: hashedToken, verification_type: verificationType })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})
