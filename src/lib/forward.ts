import { anexoEstaVivo } from '@/services/gallery'

/**
 * Regra única do que pode ser encaminhado.
 *
 * POR QUE UMA REGRA SÓ, E NÃO UMA LISTA DE TIPOS PERMITIDOS
 * Uma condição única resolve cinco problemas de uma vez, e cada um deles sairia
 * como bug em produção se fosse tratado separadamente:
 *
 * 1. FIGURINHA (438 na base). A função de envio no banco só trata
 *    image/video/document (endpoint /message/sendMedia) e audio; **todo o resto
 *    cai no ELSE e vai para o endpoint de ÁUDIO**. Encaminhar figurinha postaria
 *    um .webp como se fosse áudio.
 * 2. CONTATO (244) e LISTA (16). Medido no banco: esses anexos **não têm campo
 *    de URL**. Não há arquivo para repassar; cairia no ramo de texto e a paciente
 *    receberia literalmente "[Contato: ...]".
 * 3. ANEXO MORTO (6.203, 73% do total). Apontam para o Storage abandonado na
 *    migração de 16/07, cujo domínio não resolve mais. A Evolution tentaria
 *    baixar uma URL morta e o envio falharia.
 * 4. MENSAGEM APAGADA.
 * 5. MARCADOR TÉCNICO. Existem 11.935 mensagens visíveis cujo texto começa com
 *    "[" e que NÃO têm anexo nenhum ([Imagem] 2.403, [Mensagem de mídia] 1.695,
 *    [Áudio] 781, [Figurinha] 459, [Reação] 398, [Contato] 364...). Uma
 *    classificação ingênua ("tem anexo → mídia, senão → texto") faria a paciente
 *    receber a palavra "[Imagem]". É o erro mais provável do primeiro dia.
 */

/** Tipos que a função de envio realmente sabe rotear. */
const TIPOS_ENVIAVEIS = ['image', 'video', 'document', 'audio']

/**
 * Texto entre colchetes que o webhook grava quando não há conteúdo real.
 * Deliberadamente mais amplo que o `isMediaPlaceholder` do ChatWindow: cobre
 * também [Reação], [Musica] e [Mensagem apagada], que escapavam daquela lista.
 */
export function ehMarcadorTecnico(texto: string | null | undefined): boolean {
  if (!texto) return true
  const t = texto.trim()
  if (!t) return true
  return t.startsWith('[') && t.endsWith(']') && t.length <= 40
}

export interface AnexoParaEncaminhar {
  url: string
  type: string
  name: string
}

export interface ResultadoEncaminhavel {
  pode: boolean
  /** Motivo em linguagem de usuário, para mostrar por que está bloqueado. */
  motivo?: string
  anexo?: AnexoParaEncaminhar
}

export function podeEncaminhar(msg: any): ResultadoEncaminhavel {
  if (!msg) return { pode: false, motivo: 'Mensagem inválida.' }
  if (msg.deleted_at) return { pode: false, motivo: 'Mensagem apagada.' }

  const anexos = Array.isArray(msg.attachments) ? msg.attachments : []
  const anexo = anexos[0]

  if (anexo) {
    const tipo = String(anexo?.type ?? '')
    const url = String(anexo?.url ?? '')

    if (!url) {
      return {
        pode: false,
        motivo: tipo === 'contact' ? 'Cartão de contato não pode ser encaminhado.' : 'Este anexo não tem arquivo.',
      }
    }
    if (!TIPOS_ENVIAVEIS.includes(tipo)) {
      return {
        pode: false,
        motivo: tipo === 'sticker' ? 'Figurinha não pode ser encaminhada.' : 'Este tipo de anexo não pode ser encaminhado.',
      }
    }
    if (!anexoEstaVivo(url)) {
      return { pode: false, motivo: 'O arquivo não está mais disponível no servidor.' }
    }
    return {
      pode: true,
      anexo: { url, type: tipo, name: String(anexo?.name ?? 'arquivo') },
    }
  }

  // Sem anexo: só encaminha se houver texto de verdade.
  if (ehMarcadorTecnico(msg.content)) {
    return { pode: false, motivo: 'Esta mensagem não tem conteúdo para encaminhar.' }
  }
  return { pode: true }
}

/**
 * Legenda a enviar junto da mídia. Marcador técnico vira string vazia — a função
 * de envio no banco já descarta legendas assim, mas mandar explicitamente evita
 * depender desse detalhe.
 */
export function legendaParaEncaminhar(msg: any): string {
  return ehMarcadorTecnico(msg?.content) ? '' : String(msg.content ?? '')
}
