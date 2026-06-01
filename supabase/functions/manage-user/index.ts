import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const serviceHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  apikey: SUPABASE_SERVICE_KEY,
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function requireAdmin(authHeader: string) {
  if (!authHeader) return { error: json({ error: 'Authorization header required' }, 401) }

  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_SERVICE_KEY },
  })

  if (!userResp.ok) return { error: json({ error: 'Invalid session' }, 401) }

  const authUser = await userResp.json()
  const profileResp = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=is_admin`,
    { headers: serviceHeaders },
  )

  if (!profileResp.ok) return { error: json({ error: 'Unable to validate admin profile' }, 500) }

  const profiles = await profileResp.json()
  if (!Array.isArray(profiles) || !profiles[0]?.is_admin) {
    return { error: json({ error: 'Admin privileges required' }, 403) }
  }

  return { user: authUser }
}

async function replaceAllowedDevices(userId: string, allowedDevices: unknown, isAdmin: boolean) {
  const deleteResp = await fetch(
    `${SUPABASE_URL}/rest/v1/user_allowed_devices?user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
      headers: { ...serviceHeaders, Prefer: 'return=minimal' },
    },
  )

  if (!deleteResp.ok) {
    const err = await deleteResp.text()
    throw new Error(`Failed to clear allowed devices: ${err}`)
  }

  if (isAdmin || !Array.isArray(allowedDevices) || allowedDevices.length === 0) return

  const uniqueDeviceIds = [...new Set(allowedDevices.filter((id) => typeof id === 'string'))]
  if (uniqueDeviceIds.length === 0) return

  const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/user_allowed_devices`, {
    method: 'POST',
    headers: { ...serviceHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify(uniqueDeviceIds.map((deviceId) => ({ user_id: userId, device_id: deviceId }))),
  })

  if (!insertResp.ok) {
    const err = await insertResp.text()
    throw new Error(`Failed to save allowed devices: ${err}`)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return json({ error: 'Supabase environment not configured' }, 500)
  }

  const admin = await requireAdmin(req.headers.get('Authorization') || '')
  if (admin.error) return admin.error

  const body = await req.json().catch(() => null)
  if (!body || !body.action) {
    return json({ error: 'action is required' }, 400)
  }

  try {
    switch (body.action) {
      case 'create': {
        const { email, password, name, username, is_admin, department, allowed_devices } = body
        if (!email || !password) {
          return json({ error: 'email and password required' }, 400)
        }

        const authResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
          method: 'POST',
          headers: serviceHeaders,
          body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            user_metadata: { name, username },
          }),
        })

        if (!authResp.ok) {
          const err = await authResp.text()
          return json({ error: err }, authResp.status)
        }

        const authUser = await authResp.json()
        const profile = {
          id: authUser.id,
          email: authUser.email || email,
          name: name || '',
          username: username || '',
          is_admin: Boolean(is_admin),
          department: department || null,
        }

        const profileResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
          method: 'POST',
          headers: { ...serviceHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(profile),
        })

        if (!profileResp.ok) {
          const err = await profileResp.text()
          return json({ error: err }, profileResp.status)
        }

        await replaceAllowedDevices(authUser.id, allowed_devices, Boolean(is_admin))

        return json({ id: authUser.id, email: authUser.email })
      }

      case 'update': {
        const { id, email, password, name, username, is_admin, department, allowed_devices } = body
        if (!id) return json({ error: 'id required' }, 400)

        const updateData: Record<string, unknown> = {}
        if (email) updateData.email = email
        if (password) updateData.password = password

        if (Object.keys(updateData).length > 0) {
          const authResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: serviceHeaders,
            body: JSON.stringify(updateData),
          })

          if (!authResp.ok) {
            const err = await authResp.text()
            return json({ error: err }, authResp.status)
          }
        }

        const profileUpdate: Record<string, unknown> = {}
        if (email !== undefined) profileUpdate.email = email
        if (name !== undefined) profileUpdate.name = name
        if (username !== undefined) profileUpdate.username = username
        if (is_admin !== undefined) profileUpdate.is_admin = Boolean(is_admin)
        if (department !== undefined) profileUpdate.department = department || null

        if (Object.keys(profileUpdate).length > 0) {
          const profileResp = await fetch(
            `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`,
            {
              method: 'PATCH',
              headers: { ...serviceHeaders, Prefer: 'return=minimal' },
              body: JSON.stringify(profileUpdate),
            },
          )

          if (!profileResp.ok) {
            const err = await profileResp.text()
            return json({ error: err }, profileResp.status)
          }
        }

        if (allowed_devices !== undefined || is_admin !== undefined) {
          await replaceAllowedDevices(id, allowed_devices, Boolean(is_admin))
        }

        return json({ status: 'updated' })
      }

      case 'delete': {
        const { id } = body
        if (!id) return json({ error: 'id required' }, 400)
        if (admin.user?.id === id) return json({ error: 'Cannot delete current admin user' }, 400)

        const authResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: serviceHeaders,
        })

        if (!authResp.ok) {
          const err = await authResp.text()
          return json({ error: err }, authResp.status)
        }

        return json({ status: 'deleted' })
      }

      default:
        return json({ error: 'unknown action: ' + body.action }, 400)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})
