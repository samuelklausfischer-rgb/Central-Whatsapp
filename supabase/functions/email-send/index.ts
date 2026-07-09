import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import nodemailer from "npm:nodemailer@6"

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

function textFromHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
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

  // Validar JWT do usuário (extrair user_id para auditoria)
  const authHeader = req.headers.get('Authorization') || ''
  const jwt = authHeader.replace('Bearer ', '')
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // Decodificar user_id do JWT (sem verificação — Supabase já valida via RLS)
  let sender_user_id: string | null = null
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]))
    sender_user_id = payload.sub || null
  } catch {
    // jwt inválido — continuamos sem user_id no audit
  }

  const body = await req.json().catch(() => null)
  if (!body) {
    return new Response(JSON.stringify({ error: 'invalid body' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const {
    account_id,
    to,
    cc,
    bcc,
    subject,
    body_html,
    body_text,
    reply_to_email_id,
    scheduled_message_id,
  } = body

  if (!account_id || !to?.length || !subject || !body_html) {
    return new Response(JSON.stringify({ error: 'account_id, to, subject e body_html são obrigatórios' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // Buscar conta de email
  const accountResp = await fetch(
    `${SUPABASE_URL}/rest/v1/email_accounts?id=eq.${account_id}&select=*`,
    { headers }
  )
  if (!accountResp.ok) {
    return new Response(JSON.stringify({ error: 'failed to fetch email account', step: 'fetch_account' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const accounts = await accountResp.json()
  const account = Array.isArray(accounts) ? accounts[0] : null
  if (!account) {
    return new Response(JSON.stringify({ error: 'email account not found' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  if (!account.smtp_host) {
    return new Response(JSON.stringify({ error: 'conta sem configuração SMTP' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // Montar assinatura no corpo
  const signature = account.signature?.trim() || ''
  const finalHtml = signature
    ? `${body_html}<br><br><hr style="border:none;border-top:1px solid #eee"><p>${signature}</p>`
    : body_html
  const finalText = body_text || textFromHtml(finalHtml)

  // Configurar e enviar via SMTP
  let smtpAuth: { user: string; pass: string } | undefined
  if (account.provider === 'gmail' && account.oauth_access_token) {
    smtpAuth = {
      user: account.email,
      pass: account.oauth_access_token,
    }
  } else if (account.imap_password_enc) {
    smtpAuth = {
      user: account.email,
      pass: account.imap_password_enc,
    }
  }

  const transporter = nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port || 587,
    secure: account.smtp_port === 465,
    auth: smtpAuth,
    ...(account.provider === 'gmail' && account.oauth_access_token ? {
      auth: {
        type: 'OAuth2',
        user: account.email,
        accessToken: account.oauth_access_token,
      }
    } : {}),
  })

  let smtpError: string | null = null
  let messageInfo: { messageId?: string } = {}

  try {
    messageInfo = await transporter.sendMail({
      from: account.reply_to
        ? `"${account.label}" <${account.email}> Reply-To: <${account.reply_to}>`
        : `"${account.label}" <${account.email}>`,
      to: to.join(', '),
      cc: cc?.join(', '),
      bcc: bcc?.join(', '),
      subject,
      html: finalHtml,
      text: finalText,
    })
  } catch (err: unknown) {
    smtpError = err instanceof Error ? err.message : String(err)
  }

  if (smtpError) {
    return new Response(JSON.stringify({ error: 'SMTP error', detail: smtpError, step: 'smtp_send' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // Inserir o email enviado na tabela emails
  const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/emails`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id,
      direction: 'outbound',
      from_email: account.email,
      from_name: account.label,
      to_emails: to,
      cc_emails: cc || [],
      bcc_emails: bcc || [],
      subject,
      body_html: finalHtml,
      body_text: finalText,
      message_id: messageInfo.messageId || null,
      in_reply_to: reply_to_email_id || null,
      is_read: true,
      received_at: new Date().toISOString(),
    }),
  })

  if (!insertResp.ok) {
    const insertErr = await insertResp.text()
    return new Response(JSON.stringify({
      error: 'email sent but failed to save',
      step: 'insert_email',
      detail: insertErr,
    }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const inserted = await insertResp.json()
  const emailRecord = Array.isArray(inserted) ? inserted[0] : inserted

  // Se é resposta a um email existente: atualizar email_states
  if (reply_to_email_id) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/email_states?email_id=eq.${reply_to_email_id}`,
      {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'replied',
          responded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      }
    )
  }

  // Se veio do processador de agendados: atualizar scheduled_messages
  if (scheduled_message_id) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/scheduled_messages?id=eq.${scheduled_message_id}`,
      {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'sent',
          processed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      }
    )
  }

  return new Response(JSON.stringify({ status: 'sent', email: emailRecord }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
})
