/**
 * Cliente do serviço HTTP que renderiza a Proposta Comercial.
 *
 * A ferramenta deixou de montar o HTML no navegador: agora manda o `DadosProposta`
 * cru para um serviço (Python/EasyPanel) que devolve o arquivo pronto em base64 —
 * PDF, Word, Excel ou os três num ZIP. Isso torna o serviço a FONTE ÚNICA da
 * proposta (mesmos templates, paginação de exames, Word/Excel), sem duplicar o
 * mini-Jinja de `montar-html.ts`.
 *
 * Segue o molde de `src/services/rateio/rateio-service.ts`: POST → resposta com
 * `{ arquivo: { nome, mime, base64 } }`, decodificada para Blob aqui.
 */

import { appEnv } from '@/lib/env'
import type { DadosProposta } from '@/lib/proposta/dados'

export type FormatoProposta = 'pdf' | 'word' | 'excel'

/** Endpoint do serviço para cada formato. `zip` traz os três de uma vez. */
type Endpoint = FormatoProposta | 'zip'

interface RespostaRender {
  ok: boolean
  erro?: string
  arquivo?: { nome: string; mime: string; base64: string }
}

/** Arquivo pronto para download: já decodificado do base64 para Blob. */
export interface ArquivoProposta {
  nome: string
  mime: string
  blob: Blob
}

/** `true` quando o serviço remoto está configurado (senão, cai no fallback local). */
export function servicoPropostaConfigurado(): boolean {
  return Boolean(appEnv.VITE_PROPOSTA_RENDER_URL)
}

function base64ParaBlob(base64: string, mime: string): Blob {
  const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return new Blob([bin], { type: mime })
}

async function pedir(endpoint: Endpoint, dados: DadosProposta): Promise<ArquivoProposta> {
  const baseUrl = appEnv.VITE_PROPOSTA_RENDER_URL
  if (!baseUrl) {
    throw new Error('Serviço de proposta não configurado (VITE_PROPOSTA_RENDER_URL).')
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (appEnv.VITE_PROPOSTA_API_KEY) headers['X-API-Key'] = appEnv.VITE_PROPOSTA_API_KEY

  const url = `${baseUrl.replace(/\/+$/, '')}/api/${endpoint}`

  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(dados) })
  } catch {
    throw new Error('Não consegui falar com o serviço de proposta. Verifique a conexão.')
  }

  // O serviço devolve `{ ok:false, erro }` com status 400/401/500 — tentar ler o
  // JSON dá uma mensagem melhor do que só o código HTTP.
  let json: RespostaRender | null = null
  try {
    json = (await res.json()) as RespostaRender
  } catch {
    json = null
  }

  if (!res.ok || !json?.ok) {
    const motivo = json?.erro || `serviço respondeu HTTP ${res.status}`
    if (res.status === 401) throw new Error(`Acesso negado ao serviço de proposta (${motivo}).`)
    throw new Error(`Não consegui gerar a proposta: ${motivo}.`)
  }

  if (!json.arquivo?.base64) throw new Error('O serviço não devolveu o arquivo da proposta.')

  return {
    nome: json.arquivo.nome,
    mime: json.arquivo.mime,
    blob: base64ParaBlob(json.arquivo.base64, json.arquivo.mime),
  }
}

/** Renderiza a proposta num formato (PDF/Word/Excel) e devolve o Blob para download. */
export function renderizarProposta(
  dados: DadosProposta,
  formato: FormatoProposta,
): Promise<ArquivoProposta> {
  return pedir(formato, dados)
}

/** Renderiza os três formatos num único ZIP. */
export function baixarPropostaZip(dados: DadosProposta): Promise<ArquivoProposta> {
  return pedir('zip', dados)
}
