import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const GROQ_KEY = Deno.env.get('GROQ_KEY') || ''

/**
 * Modelo de texto da Groq.
 *
 * Era `llama-3.3-70b-versatile`, que a Groq ANUNCIOU DESCONTINUADO em
 * 17/06/2026 (ver console.groq.com/docs/deprecations). O sintoma foi a IA de
 * organizar texto parar de funcionar — reportada em 17/08/2026, batendo com o
 * período de desligamento —, e a causa demorou a aparecer porque o front
 * engolia o erro num toast genérico, sem registrar a resposta do servidor.
 *
 * `openai/gpt-oss-120b` é o substituto que a própria Groq indica: mais rápido e
 * mais barato na entrada. É modelo de RACIOCÍNIO, e é por isso que a chamada
 * abaixo passa `reasoning_effort`/`include_reasoning` — ver o comentário lá.
 *
 * Fica como env var para o próximo desligamento não exigir deploy de código:
 * basta trocar a variável no container. A descontinuação vai se repetir.
 */
const GROQ_MODEL = Deno.env.get('GROQ_MODEL') || 'openai/gpt-oss-120b'

/**
 * Sonda de deploy. As edge functions do self-hosted são servidas por VOLUME:
 * conferir o arquivo dentro do container mostra o que está em disco, não o que
 * o isolate do Deno está executando. Este marcador volta no corpo da resposta e
 * é a única checagem que prova qual código está realmente rodando.
 * TROCAR A CADA DEPLOY desta função.
 */
const BUILD_MARKER = 'groq-gpt-oss-120b-2026-08-20'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405)
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return jsonResponse({ error: 'Supabase credentials not configured' }, 500)
  }

  if (!GROQ_KEY) {
    return jsonResponse({ error: 'GROQ_KEY not configured' }, 500)
  }

  const body = await req.json().catch(() => null)
  if (!body || !body.action) {
    return jsonResponse({ error: 'action is required' }, 400)
  }

  const { action, text, conversationContext } = body

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  }
  const promptResp = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_assistant_prompts?action_key=eq.${encodeURIComponent(action)}&is_active=is.true&select=system_prompt`,
    { headers: sbHeaders }
  )

  if (!promptResp.ok) {
    const errBody = await promptResp.text()
    return jsonResponse({
      error: 'Falha ao buscar prompt',
      detail: `HTTP ${promptResp.status}: ${errBody}`,
    }, 502)
  }

  const prompts = await promptResp.json()
  const promptRecord = Array.isArray(prompts) ? prompts[0] : null

  if (!promptRecord) {
    return jsonResponse({ error: 'Ação de IA inválida ou não encontrada' }, 400)
  }

  let prompt = promptRecord.system_prompt
  prompt += `\n\nREGRAS:\n- Responda apenas em português do Brasil (pt-BR).\n- Nenhuma explicação, saudação, confirmação ou meta-fala (ex: nada de "Aqui está", "Claro").\n- Não use aspas envolvendo a resposta.\n- Retorne apenas o texto final e nada mais.`

  const groqMessages: Array<{ role: string; content: string }> = [
    { role: 'system', content: prompt },
  ]

  if (action === 'suggest_reply') {
    let contextStr = ''
    if (Array.isArray(conversationContext) && conversationContext.length > 0) {
      contextStr = conversationContext
        .map((m: any) => `${m.role === 'assistant' ? 'Atendente' : 'Cliente'}: ${m.text}`)
        .join('\n')
    }
    groqMessages.push({
      role: 'user',
      content: `Contexto da conversa:\n${contextStr}\n\nPor favor, sugira uma resposta curta e profissional para o Cliente.`,
    })
  } else {
    groqMessages.push({ role: 'user', content: text || '' })
  }

  const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.4,
      messages: groqMessages,
      // `gpt-oss-120b` é modelo de RACIOCÍNIO — diferente do Llama que estava
      // aqui antes. Sem estes dois campos ele gasta tempo (e tokens) pensando e
      // pode devolver o raciocínio junto da resposta. Numa função cujo trabalho
      // é organizar o texto que o atendente vai mandar para um cliente, isso
      // apareceria como lixo no meio da mensagem. `low` porque reescrever texto
      // não é tarefa que exige deliberação, e `include_reasoning: false` para o
      // pensamento não voltar no corpo.
      reasoning_effort: 'low',
      include_reasoning: false,
    }),
  })

  if (!groqResp.ok) {
    const errBody = await groqResp.text()
    return jsonResponse({ error: 'Falha ao gerar texto: ' + errBody }, 502)
  }

  const groqResult = await groqResp.json()
  const mensagem = groqResult?.choices?.[0]?.message
  const generated = mensagem?.content || ''

  /**
   * Cinto e suspensório contra o raciocínio vazar.
   *
   * `include_reasoning: false` deveria bastar, mas provedores compatíveis com a
   * API da OpenAI já mudaram esse contrato mais de uma vez, e alguns devolvem o
   * pensamento embutido no próprio `content`, entre `<think>...</think>`. Se
   * isso acontecer aqui, o atendente vê o raciocínio dentro da mensagem que ia
   * mandar para o cliente — então o bloco é removido antes de sair.
   */
  const limpo = generated.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()

  return jsonResponse({ result: limpo, marcador: BUILD_MARKER })
})