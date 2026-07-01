import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const EVOLUTION_API_URL = (Deno.env.get('EVOLUTION_API_URL') || 'http://apps-evolution-api.srofjl.easypanel.host').replace(/\/+$/, '')
const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY') || ''

function sbHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const deviceId = url.searchParams.get('id') || ''

  if (!deviceId) {
    return new Response(JSON.stringify({ error: 'device id required' }), { status: 400 })
  }

  const headers = sbHeaders()

  const devResp = await fetch(
    `${SUPABASE_URL}/rest/v1/devices?id=eq.${deviceId}&select=id,instance_key`,
    { headers }
  )
  const devices = await devResp.json()
  const device = Array.isArray(devices) ? devices[0] : null

  if (!device || !device.instance_key) {
    return new Response(JSON.stringify({ error: 'device not found or no instance_key' }), { status: 404 })
  }

  let avatarUrl = ''

  try {
    const resp = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
      method: 'GET',
      headers: { apikey: EVOLUTION_API_KEY },
    })
    if (resp.ok) {
      const data = await resp.json()
      if (Array.isArray(data)) {
        // A Evolution API passou a retornar os campos direto no objeto
        // (sem aninhar em "instance"). Mantemos os dois formatos por
        // compatibilidade, já que versões antigas da API ainda aninhavam.
        const inst = data.find((i: any) => (i.name ?? i.instance?.instanceName) === device.instance_key)
        const profilePicUrl = inst?.profilePicUrl ?? inst?.instance?.profilePicUrl
        if (profilePicUrl) {
          avatarUrl = profilePicUrl
        }
      }
    }
  } catch {}

  const updateData: Record<string, unknown> = { avatar_updated_at: new Date().toISOString() }
  if (avatarUrl) updateData.avatar_url = avatarUrl

  await fetch(`${SUPABASE_URL}/rest/v1/devices?id=eq.${deviceId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(updateData),
  })

  return new Response(JSON.stringify({ avatar_url: avatarUrl || null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
