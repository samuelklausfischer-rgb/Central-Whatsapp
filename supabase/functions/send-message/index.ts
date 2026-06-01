import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
}

function sbHeaders(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
}

function normalizeNumber(raw: string): string {
  if (!raw) return ''
  if (raw.includes('@g.us')) return raw
  let cleaned = raw.replace(/@s\.whatsapp\.net/g, '').replace(/@lid/g, '')
  cleaned = cleaned.replace(/\D/g, '')
  return cleaned
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'missing SUPABASE configuration' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const headers = sbHeaders(SUPABASE_SERVICE_KEY)

  let EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY') || ''
  let EVOLUTION_API_URL = (Deno.env.get('EVOLUTION_API_URL') || '').replace(/\/+$/, '')

  if (!EVOLUTION_API_KEY || !EVOLUTION_API_URL) {
    const secretsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/secrets?select=key,value`,
      { headers }
    )
    if (secretsResp.ok) {
      const rows = await secretsResp.json()
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (row.key === 'EVOLUTION_API_KEY' && !EVOLUTION_API_KEY) EVOLUTION_API_KEY = row.value
          if (row.key === 'EVOLUTION_API_URL' && !EVOLUTION_API_URL) EVOLUTION_API_URL = row.value.replace(/\/+$/, '')
        }
      }
    }
  }

  if (!EVOLUTION_API_URL) {
    EVOLUTION_API_URL = 'http://apps-evolution-api.srofjl.easypanel.host'
  }

  if (!EVOLUTION_API_KEY) {
    return new Response(JSON.stringify({ error: 'missing EVOLUTION_API_KEY secret' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json().catch(() => null)
  if (!body) {
    return new Response(JSON.stringify({ error: 'invalid body' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const { device_id, remote_sender, content, sender_id } = body
  if (!device_id || !remote_sender || !content) {
    return new Response(JSON.stringify({ error: 'device_id, remote_sender and content are required' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const deviceResp = await fetch(
    `${SUPABASE_URL}/rest/v1/devices?id=eq.${device_id}&select=id,instance_key,signature,name`,
    { headers }
  )
  if (!deviceResp.ok) {
    const deviceErr = await deviceResp.text()
    return new Response(JSON.stringify({
      error: 'failed to fetch device',
      status: deviceResp.status,
      step: 'fetch_device',
      body: deviceErr,
    }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const devices = await deviceResp.json()
  const device = Array.isArray(devices) ? devices[0] : null
  if (!device) {
    return new Response(JSON.stringify({ error: 'device not found', step: 'device_not_found' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const instanceKey = device.instance_key
  if (!instanceKey) {
    return new Response(JSON.stringify({ error: 'device has no instance_key', step: 'no_instance_key' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  let signature = device.signature || ''
  if (!signature && sender_id) {
    const userResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${sender_id}&select=signature`,
      { headers }
    )
    if (userResp.ok) {
      const users = await userResp.json()
      const user = Array.isArray(users) ? users[0] : null
      if (user?.signature) {
        signature = user.signature
      }
    }
  }

  const textContent = signature?.trim()
    ? signature.trim() + '\n\n' + content
    : content

  const normalizedNumber = normalizeNumber(remote_sender)

  const evolutionResp = await fetch(
    `${EVOLUTION_API_URL}/message/sendText/${encodeURIComponent(instanceKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: EVOLUTION_API_KEY,
      },
      body: JSON.stringify({ number: normalizedNumber, text: textContent }),
    }
  )

  if (!evolutionResp.ok) {
    const evolutionResult = await evolutionResp.json().catch(() => ({}))
    return new Response(JSON.stringify({
      error: 'Evolution API error',
      status: evolutionResp.status,
      step: 'evolution_api',
      body: evolutionResult,
    }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const evolutionResult = await evolutionResp.json().catch(() => ({}))

  const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      content: textContent,
      device_id: device.id,
      remote_sender: normalizedNumber,
      sender_id: sender_id || undefined,
      direction: 'outbound',
      is_read: true,
      origin: 'app',
    }),
  })

  if (!insertResp.ok) {
    const insertErr = await insertResp.text()
    return new Response(JSON.stringify({
      error: 'message sent but failed to save',
      step: 'insert_message',
      status: insertResp.status,
      body: insertErr,
      evolution: evolutionResult,
    }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const inserted = await insertResp.json()
  const message = Array.isArray(inserted) ? inserted[0] : inserted

  return new Response(JSON.stringify({ status: 'sent', message }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
})
