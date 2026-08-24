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

// A service_role não tem `sub` no JWT, então `auth.uid()` é nulo dentro dos
// triggers e o banco não tem como saber quem clicou em "Salvar". Estes headers
// declaram o autor: `audit_actor()` e `audit_source()` leem daqui via
// `current_setting('request.headers')`. Sem isso o histórico grava autor nulo.
function headersDoAutor(actorId: string) {
  return {
    ...serviceHeaders,
    'x-actor-id': actorId,
    'x-actor-source': 'manage-user',
  }
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

// Troca a lista de aparelhos do usuário pela lista recebida.
//
// NÃO recebe mais `isAdmin`. Antes, ser admin fazia esta função apagar tudo e
// desistir de regravar — o que, em 18/08/2026, tirou a Renata de todas as
// instâncias numa edição que só queria mexer no e-mail dela. Quem decide os
// aparelhos é a lista enviada, não o cargo. Lista vazia continua significando
// "limpar tudo", mas agora só chega aqui quando quem chamou realmente quis isso.
async function replaceAllowedDevices(
  userId: string,
  allowedDevices: unknown,
  headers: Record<string, string>,
) {
  const deleteResp = await fetch(
    `${SUPABASE_URL}/rest/v1/user_allowed_devices?user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
      headers: { ...headers, Prefer: 'return=minimal' },
    },
  )

  if (!deleteResp.ok) {
    const err = await deleteResp.text()
    throw new Error(`Failed to clear allowed devices: ${err}`)
  }

  if (!Array.isArray(allowedDevices) || allowedDevices.length === 0) return

  const uniqueDeviceIds = [...new Set(allowedDevices.filter((id) => typeof id === 'string'))]
  if (uniqueDeviceIds.length === 0) return

  const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/user_allowed_devices`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(uniqueDeviceIds.map((deviceId) => ({ user_id: userId, device_id: deviceId }))),
  })

  if (!insertResp.ok) {
    const err = await insertResp.text()
    throw new Error(`Failed to save allowed devices: ${err}`)
  }
}

// As chamadas ao /auth/v1/admin/users não passam pelo PostgREST, então nenhum
// trigger as enxerga: e-mail e senha mudariam sem deixar rastro atribuível.
// Esta é a única linha de auditoria que a função grava na mão.
//
// A senha NUNCA vai gravada, nem a antiga nem a nova — só o fato de ter mudado.
async function logAuthChange(
  actorId: string,
  targetUserId: string,
  changes: Record<string, unknown>,
  headers: Record<string, string>,
) {
  if (Object.keys(changes).length === 0) return

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/admin_audit_log`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      actor_id: actorId,
      target_user_id: targetUserId,
      entity: 'auth.users',
      action: 'update',
      changes,
      source: 'manage-user',
    }),
  })

  // Falhar a auditoria não pode desfazer uma alteração que já foi aplicada no
  // auth. Registra no log da função para não sumir em silêncio.
  if (!resp.ok) {
    console.error('Falha ao gravar auditoria de auth.users:', await resp.text())
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

  // Daqui para baixo TODA escrita usa estes headers: é o que faz o histórico
  // sair com o nome de quem clicou em vez de "service_role".
  const actorId: string = admin.user?.id ?? ''
  const escrita = headersDoAutor(actorId)

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
          headers: { ...escrita, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(profile),
        })

        if (!profileResp.ok) {
          const err = await profileResp.text()
          return json({ error: err }, profileResp.status)
        }

        await replaceAllowedDevices(authUser.id, allowed_devices, escrita)

        return json({ id: authUser.id, email: authUser.email })
      }

      case 'update': {
        const { id, email, password, name, username, is_admin, department, allowed_devices, devices_explicit } = body
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

          // A troca de e-mail já fica registrada pelo trigger do profiles logo
          // abaixo, com valor antigo e novo. A senha não passa por lá — só o
          // fato de ter mudado é gravado, nunca o valor.
          if (password) {
            await logAuthChange(actorId, id, { password: { de: null, para: 'alterada' } }, escrita)
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
              headers: { ...escrita, Prefer: 'return=minimal' },
              body: JSON.stringify(profileUpdate),
            },
          )

          if (!profileResp.ok) {
            const err = await profileResp.text()
            return json({ error: err }, profileResp.status)
          }
        }

        // Só mexe nos aparelhos quando a chamada realmente trouxe uma lista.
        // O gatilho antigo era `allowed_devices !== undefined || is_admin !== undefined`,
        // e como a tela sempre manda `is_admin`, qualquer edição de nome ou
        // e-mail entrava aqui e apagava os aparelhos da pessoa — inclusive os
        // que o painel de super-admin tinha concedido.
        //
        // `devices_explicit` existe por causa da versão ANTIGA da tela, que
        // continua publicada por um tempo depois deste deploy: ela manda
        // `allowed_devices: []` para todo admin, e `[]` é um array — sem esta
        // segunda condição a limpeza aconteceria exatamente igual. Só o cliente
        // novo declara a flag, então só ele consegue esvaziar a lista de alguém.
        if (Array.isArray(allowed_devices) && (devices_explicit === true || allowed_devices.length > 0)) {
          await replaceAllowedDevices(id, allowed_devices, escrita)
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
