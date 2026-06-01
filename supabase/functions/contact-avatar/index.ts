import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const EVOLUTION_API_URL = (Deno.env.get('EVOLUTION_API_URL') || 'https://apps-evolution-api.srofjl.easypanel.host').replace(/\/+$/, '')
const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY') || ''

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function sbHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const url = new URL(req.url)
  const jid = url.searchParams.get('jid') || ''
  const instanceName = url.searchParams.get('instance') || ''

  if (!jid || !instanceName) {
    return jsonResponse({ error: 'jid and instance params required' }, 400)
  }

  const apiHeaders = { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY }
  let avatarUrl = ''
  let contactName = ''

  if (jid.includes('@g.us')) {
    try {
      const resp = await fetch(
        `${EVOLUTION_API_URL}/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(jid)}`,
        { headers: apiHeaders },
      )
      if (resp.ok) {
        const data = await resp.json()
        avatarUrl = data.pictureUrl || ''
        contactName = data.subject || ''
      }
    } catch {}
  } else {
    try {
      const number = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`
      const resp = await fetch(
        `${EVOLUTION_API_URL}/chat/fetchProfilePictureUrl/${instanceName}`,
        {
          method: 'POST',
          headers: apiHeaders,
          body: JSON.stringify({ number }),
        },
      )
      if (resp.ok) {
        const data = await resp.json()
        avatarUrl = data.profilePictureUrl || ''
      }
    } catch {}
  }

  const headers = sbHeaders()
  const now = new Date().toISOString()

  const findResp = await fetch(
    `${SUPABASE_URL}/rest/v1/contacts?remote_jid=eq.${encodeURIComponent(jid)}&select=id`,
    { headers },
  )
  const contacts = await findResp.json()
  const contact = Array.isArray(contacts) ? contacts[0] : null

  if (contact) {
    const updateData: Record<string, unknown> = { avatar_updated_at: now }
    if (contactName) updateData.name = contactName
    if (avatarUrl) updateData.avatar_url = avatarUrl
    await fetch(`${SUPABASE_URL}/rest/v1/contacts?id=eq.${contact.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(updateData),
    })
  } else {
    await fetch(`${SUPABASE_URL}/rest/v1/contacts`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        remote_jid: jid,
        name: contactName || undefined,
        avatar_url: avatarUrl || null,
        avatar_updated_at: now,
      }),
    })
  }

  return jsonResponse({ avatar_url: avatarUrl || null, name: contactName || null })
})
