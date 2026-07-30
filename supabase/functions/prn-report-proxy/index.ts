import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Proxy do webhook de análise PRN.
//
// Motivo: o app roda em máquinas que alcançam o Supabase (*.supabase.co) mas não
// necessariamente o host do n8n (apps-n8n.srofjl.easypanel.host) — filtro de rede
// no endpoint do Financeiro derrubava o POST antes de sair da máquina (falha em
// ~5ms, sem nenhuma execução no n8n). Roteando por aqui, o cliente só precisa
// falar com o domínio que já funciona e a chamada ao n8n sai do servidor.

const N8N_WEBHOOK_URL =
  Deno.env.get('PRN_N8N_WEBHOOK_URL') || 'https://apps-n8n.srofjl.easypanel.host/webhook/prn/report'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED' } }, 405)

  const startedAt = Date.now()

  try {
    // Repassa o corpo em streaming: o FormData carrega o xlsx diário, a cópia em
    // base64 e o JSON do histórico, que juntos podem passar de alguns MB —
    // bufferizar aqui arriscaria a memória da function.
    const upstream = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        // Só o content-type importa para o n8n reconstruir o multipart (o boundary
        // vive nesse header). Os headers de auth do Supabase não são repassados.
        'Content-Type': req.headers.get('content-type') ?? 'application/octet-stream',
      },
      body: req.body,
      // Exigido pelo Deno/fetch para corpo em streaming.
      duplex: 'half',
    } as RequestInit)

    // Devolve status, content-type e corpo do n8n sem alterar, para que o
    // parsePrnResponse do cliente (incluindo o caminho legacy_html) siga valendo.
    const passthroughHeaders = new Headers(corsHeaders)
    const upstreamContentType = upstream.headers.get('content-type')
    if (upstreamContentType) passthroughHeaders.set('Content-Type', upstreamContentType)
    passthroughHeaders.set('X-Prn-Proxy-Duration-Ms', String(Date.now() - startedAt))

    return new Response(upstream.body, {
      status: upstream.status,
      headers: passthroughHeaders,
    })
  } catch (error) {
    // Aqui o proxy chegou a rodar mas não alcançou o n8n. Código próprio para
    // separar isso de "o n8n respondeu com erro" nos registros de prn_report_runs.
    const message = error instanceof Error ? error.message : 'Unexpected error'
    console.log(JSON.stringify({
      scope: 'prn_report_proxy',
      stage: 'upstream_fetch_failed',
      target: N8N_WEBHOOK_URL,
      durationMs: Date.now() - startedAt,
      message,
    }))

    return json(
      {
        ok: false,
        error: {
          code: 'PROXY_UPSTREAM_UNREACHABLE',
          message: 'O proxy não conseguiu alcançar o motor de análise (n8n).',
          details: message,
        },
      },
      502,
    )
  }
})
