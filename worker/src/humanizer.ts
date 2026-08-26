/**
 * Humanizador — o motor anti-ban.
 *
 * Portado do `prn-vigilante` (`automation/src/core/humanizer.ts`), que roda em
 * produção desde março/2026. A matemática é a mesma; o que mudou é de onde vem a
 * configuração: lá era variável de ambiente global, aqui vem DA CAMPANHA, porque
 * cada disparo tem um risco diferente — 5 contatos internos aceitam pressa, 500
 * clientes não.
 *
 * As quatro estratégias, na ordem em que agem:
 *  1. Atraso de digitação proporcional ao tamanho do texto.
 *  2. Intervalo aleatório entre mensagens, com jitter de ±15% para não existir
 *     padrão fixo — cadência regular é o que um robô tem e uma pessoa não.
 *  3. Pausa longa a cada N mensagens, simulando o descanso de quem digita.
 *  4. Janela de horário (opcional, hoje desligada por decisão do Samuel).
 */

export interface RitmoDaCampanha {
  delay_min_ms: number
  delay_max_ms: number
  jitter_pct: number
  pausa_a_cada: number
  pausa_longa_ms: number
  respeitar_horario?: boolean
  hora_inicio?: number
  hora_fim?: number
}

/** 6 caracteres por segundo, com piso de 0,8 s e teto de 8 s — igual ao original. */
const CPS = 6
const DIGITACAO_MIN_MS = 800
const DIGITACAO_MAX_MS = 8000

export const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** O que o worker vai esperar antes deste envio — sorteado, ainda não cumprido. */
export interface PlanoDeEspera {
  /** `false` = fora da janela de horário; o alvo volta para a fila. */
  pode: boolean
  pausaLongaMs: number
  intervaloMs: number
  totalMs: number
}

export class Humanizador {
  /**
   * Contador por CAMPANHA, e não global.
   *
   * A pausa longa existe para imitar quem para de digitar depois de um punhado de
   * mensagens. Um contador único entre campanhas faria a 1ª mensagem de um
   * disparo herdar o cansaço do disparo anterior — e, pior, a pausa cairia em
   * lugares que não correspondem a nada.
   */
  private enviadasPorCampanha = new Map<string, number>()

  /** Quanto tempo "levaria para digitar" este texto. */
  atrasoDeDigitacao(texto: string): number {
    const base = (texto.length / CPS) * 1000
    return Math.max(DIGITACAO_MIN_MS, Math.min(base, DIGITACAO_MAX_MS))
  }

  /**
   * Intervalo entre mensagens, com jitter.
   *
   * O jitter é simétrico (±pct), então não desloca a média — é isso que permite a
   * tela prever o término com `(min + max) / 2` sem errar sistematicamente.
   */
  intervaloEntreMensagens(r: RitmoDaCampanha): number {
    const base = Math.random() * (r.delay_max_ms - r.delay_min_ms) + r.delay_min_ms
    const faixa = base * (r.jitter_pct ?? 0)
    const jitter = (Math.random() * 2 - 1) * faixa
    return Math.max(r.delay_min_ms, Math.floor(base + jitter))
  }

  private ehHoraDePausar(campanhaId: string, aCada: number): boolean {
    if (!aCada || aCada <= 0) return false
    const n = (this.enviadasPorCampanha.get(campanhaId) ?? 0) + 1
    if (n >= aCada) {
      this.enviadasPorCampanha.set(campanhaId, 0)
      return true
    }
    this.enviadasPorCampanha.set(campanhaId, n)
    return false
  }

  /**
   * Está dentro da janela permitida?
   *
   * Devolve os ms até a próxima janela quando está fora, para o motor dormir o
   * necessário em vez de acordar de minuto em minuto sem poder fazer nada.
   */
  dentroDaJanela(r: RitmoDaCampanha): { pode: boolean; esperarMs: number } {
    if (!r.respeitar_horario) return { pode: true, esperarMs: 0 }

    const inicio = r.hora_inicio ?? 8
    const fim = r.hora_fim ?? 20
    const agora = new Date()
    const h = agora.getHours()
    if (h >= inicio && h < fim) return { pode: true, esperarMs: 0 }

    const alvo = new Date(agora)
    if (h >= fim) alvo.setDate(alvo.getDate() + 1)
    alvo.setHours(inicio, 0, 0, 0)
    return { pode: false, esperarMs: alvo.getTime() - agora.getTime() }
  }

  /**
   * SORTEIA a espera entre contatos, sem esperar.
   *
   * ── POR QUE SORTEAR E ESPERAR SÃO DUAS COISAS ───────────────────────────────
   * Antes isto era um método só, que sorteava e dormia. O número ficava preso na
   * memória do worker: a tela sabia QUE um disparo estava correndo, mas não tinha
   * como dizer quanto faltava para o próximo.
   *
   * Separando, o motor recebe o plano, GRAVA no banco quando o envio vai
   * acontecer (`disparo_alvos.previsto_para`) e só então dorme. A contagem
   * regressiva da tela passa a ser o número que o worker sorteou, não uma
   * estimativa paralela que erraria a cada jitter.
   *
   * `pode = false` quando está fora da janela de horário — aí o alvo volta para a
   * fila em vez de ser marcado como falha, porque não falhou nada.
   *
   * ── POR QUE A DIGITAÇÃO NÃO ESTÁ AQUI ───────────────────────────────────────
   * No original, `applyPreSendDelay` dorme o tempo de digitação e SÓ DEPOIS dorme
   * o intervalo entre mensagens — que chega a 13 minutos. Lá isso não incomoda,
   * porque o "digitando…" real vem do `delay: 1200` no payload do envio, colado na
   * mensagem.
   *
   * Aqui o "digitando…" é uma chamada de presença de verdade, e mantê-la nessa
   * ordem mostraria o indicador por 8 s e só entregaria a mensagem 13 minutos
   * depois — o contato veria alguém começar a escrever e sumir. Por isso a
   * digitação saiu daqui e virou o último passo antes do envio, no motor.
   */
  planejarEspera(campanhaId: string, r: RitmoDaCampanha): PlanoDeEspera {
    const janela = this.dentroDaJanela(r)
    if (!janela.pode) return { pode: false, pausaLongaMs: 0, intervaloMs: 0, totalMs: 0 }

    const pausaLongaMs = this.ehHoraDePausar(campanhaId, r.pausa_a_cada) ? r.pausa_longa_ms : 0
    const intervaloMs = this.intervaloEntreMensagens(r)
    return { pode: true, pausaLongaMs, intervaloMs, totalMs: pausaLongaMs + intervaloMs }
  }

  /** Cumpre o plano. Separado do sorteio para o motor poder publicar antes de dormir. */
  async cumprirEspera(plano: PlanoDeEspera, logar: (m: string) => void): Promise<void> {
    if (plano.pausaLongaMs > 0) {
      logar(`pausa de segurança: ${Math.round(plano.pausaLongaMs / 1000)}s`)
      await dormir(plano.pausaLongaMs)
    }
    logar(`intervalo anti-ban: ${Math.round(plano.intervaloMs / 1000)}s`)
    await dormir(plano.intervaloMs)
  }

  /** Chamado quando a campanha some da fila, para o contador não vazar. */
  esquecerCampanha(campanhaId: string) {
    this.enviadasPorCampanha.delete(campanhaId)
  }
}
