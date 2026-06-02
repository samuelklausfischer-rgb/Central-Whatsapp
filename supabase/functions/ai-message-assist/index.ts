import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const GROQ_KEY = Deno.env.get('GROQ_KEY') || ''

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 })
  }

  if (!GROQ_KEY) {
    return new Response(JSON.stringify({ error: 'GROQ_KEY not configured' }), { status: 500 })
  }

  const body = await req.json().catch(() => null)
  if (!body) {
    return new Response(JSON.stringify({ error: 'invalid body' }), { status: 400 })
  }

  const { action, text, conversationContext } = body

  const authHeader = req.headers.get('Authorization') || ''
  const promptResp = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_assistant_prompts?action_key=eq.${encodeURIComponent(action)}&is_active=is.true&select=system_prompt`,
    { headers: { Authorization: authHeader } }
  )
  const prompts = await promptResp.json()
  const promptRecord = Array.isArray(prompts) ? prompts[0] : null

  if (!promptRecord) {
    return new Response(JSON.stringify({ error: 'Ação de IA inválida ou não encontrada' }), { status: 400 })
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
      model: 'llama-3.3-70b-versatile',
      temperature: 0.4,
      messages: groqMessages,
    }),
  })

  if (!groqResp.ok) {
    const errBody = await groqResp.text()
    return new Response(JSON.stringify({ error: 'Falha ao gerar texto: ' + errBody }), { status: 502 })
  }

  const groqResult = await groqResp.json()
  const generated = groqResult?.choices?.[0]?.message?.content || ''

  return new Response(JSON.stringify({ result: generated.trim() }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})