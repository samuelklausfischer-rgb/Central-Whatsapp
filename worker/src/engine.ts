import { Humanizador, dormir, type RitmoDaCampanha } from './humanizer'
import { montarTexto } from './texto'
import { enviarComRetentativa } from './envio'
import {
  adquirirLease,
  concluirAlvo,
  devolverAlvo,
  enviarMensagem,
  jaSaiu,
  marcarPrevisao,
  mostrarDigitando,
  proximoAlvo,
  soltarLease,
  type AlvoParaEnviar,
} from './supabase'

/**
 * O ciclo do worker.
 *
 * Portado do `prn-vigilante` (`automation/src/core/worker-engine.ts`), enxugado:
 * lá o motor também fazia validação de agenda, raio-X de números e classificação
 * por IA, nada disso existe aqui.
 *
 * O que ficou é o que importa: lease de worker único, heartbeat, encerramento
 * limpo e modo seco.
 */

const nome = process.env.WORKER_NAME || 'disparador'
const workerId = `${nome}-${Math.random().toString(36).slice(2, 10)}`
const seco = process.env.DRY_RUN === 'true'
const intervaloDeSondagemMs = Number(process.env.POLL_INTERVAL_MS || 5000)
const leaseSegundos = Number(process.env.LEASE_SECONDS || 90)

function log(msg: string, extra?: unknown) {
  const ts = new Date().toISOString()
  if (extra !== undefined) console.log(`[${ts}] [${workerId}] ${msg}`, extra)
  else console.log(`[${ts}] [${workerId}] ${msg}`)
}

export class Motor {
  private readonly humanizador = new Humanizador()
  private rodando = false
  private enviados = 0
  private falhas = 0

  async iniciar() {
    if (this.rodando) return
    this.rodando = true

    log(`worker iniciado${seco ? ' — MODO SECO: nada será enviado de verdade' : ''}`)
    this.registrarSinais()

    while (this.rodando) {
      try {
        const temLease = await adquirirLease(workerId, nome, leaseSegundos, {
          enviados: this.enviados,
          falhas: this.falhas,
          seco,
        })

        if (!temLease) {
          // Outra réplica está enviando. Dormir e tentar de novo é o certo: assumir
          // a fila em paralelo dobraria o ritmo anti-ban sem ninguém perceber.
          log('outra réplica tem o lease; aguardando')
          await dormir(intervaloDeSondagemMs * 3)
          continue
        }

        const alvo = await proximoAlvo(workerId)
        if (!alvo) {
          await dormir(intervaloDeSondagemMs)
          continue
        }

        await this.processar(alvo)
      } catch (e) {
        // O laço NUNCA morre por causa de um erro: um worker que sai do ar deixa a
        // campanha parada e ninguém é avisado até o cliente reclamar.
        log('erro no ciclo', e instanceof Error ? e.message : e)
        await dormir(intervaloDeSondagemMs)
      }
    }
  }

  private async processar(alvo: AlvoParaEnviar) {
    const ritmo: RitmoDaCampanha = {
      delay_min_ms: alvo.delay_min_ms,
      delay_max_ms: alvo.delay_max_ms,
      jitter_pct: Number(alvo.jitter_pct),
      pausa_a_cada: alvo.pausa_a_cada,
      pausa_longa_ms: alvo.pausa_longa_ms,
    }
    const texto = montarTexto(alvo.mensagem, alvo.nome_exibicao)

    // Ensaio é POR CAMPANHA; `DRY_RUN` continua valendo como chave mestra do
    // processo inteiro. Qualquer um dos dois liga a simulação.
    const simular = seco || alvo.ensaio === true

    // 1. Sorteia a espera SEM esperar — janela de horário, pausa longa e o
    //    intervalo aleatório de 3 a 13 min.
    const plano = this.humanizador.planejarEspera(alvo.campaign_id, ritmo)

    if (!plano.pode) {
      // Fora da janela não é falha: o alvo volta para a fila intacto.
      log(`${alvo.remote_sender}: fora da janela de envio`)
      await devolverAlvo(alvo.alvo_id)
      await dormir(60_000)
      return
    }

    // 2. PUBLICA o horário antes de dormir.
    //
    //    É isto que permite a tela contar regressivamente: o número é o que o
    //    worker acabou de sortear, não uma estimativa paralela que erraria a cada
    //    jitter. A digitação entra na conta porque ela também acontece antes do
    //    envio.
    //
    //    Falhar aqui não impede o envio — no pior caso a tela mostra "calculando".
    const digitacao = this.humanizador.atrasoDeDigitacao(texto)
    const previstoPara = new Date(Date.now() + plano.totalMs + digitacao)
    try {
      await marcarPrevisao(alvo.alvo_id, previstoPara)
    } catch (e) {
      log(`${alvo.remote_sender}: não consegui publicar a previsão`, e instanceof Error ? e.message : e)
    }

    // 3. Cumpre a espera sorteada.
    await this.humanizador.cumprirEspera(plano, (m) => log(`${alvo.remote_sender}: ${m}`))

    // 4. "digitando…" colado no envio, pela duração que o texto pediria.
    //
    //    O original calcula esse tempo e o desperdiça como sleep local — quem vê
    //    "digitando" lá é um `delay: 1200` fixo. Aqui o cálculo vira a duração de
    //    fato: mensagem curta mostra ~1 s, longa até 8 s.
    //
    //    Falhar aqui NÃO impede o envio. Mostrar "digitando" é enfeite; entregar a
    //    mensagem é o trabalho.
    if (!simular) {
      try {
        await mostrarDigitando(alvo)
      } catch (e) {
        log(`${alvo.remote_sender}: presença falhou (segue o envio)`, e instanceof Error ? e.message : e)
      }
    }
    await dormir(digitacao)

    try {
      let messageId: string | null = null
      if (simular) {
        log(`[ensaio] enviaria para ${alvo.remote_sender}: ${texto.slice(0, 60)}`)
      } else {
        const r = await enviarComRetentativa({
          enviar: () => enviarMensagem(alvo, texto),
          jaSaiu: () => jaSaiu(alvo, texto),
          dormir,
          logar: (m) => log(`${alvo.remote_sender}: ${m}`),
        })
        messageId = r.messageId
        if (r.jaHaviaSaido) log(`${alvo.remote_sender}: envio duplicado evitado`)
      }
      // `simular` vira o status `simulado`, e não `enviado`: campanha de ensaio
      // não pode ficar indistinguível de uma real e virar lixo. Um botão na tela
      // devolve os simulados para a fila.
      await concluirAlvo(alvo.alvo_id, true, messageId, null, simular)
      this.enviados++
      log(`${simular ? 'simulado' : 'enviado'} para ${alvo.remote_sender} (${this.enviados} no total)`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await concluirAlvo(alvo.alvo_id, false, null, msg, false)
      this.falhas++
      log(`FALHOU para ${alvo.remote_sender}: ${msg}`)
    }
  }

  private registrarSinais() {
    const encerrar = async (sinal: string) => {
      if (!this.rodando) return
      this.rodando = false
      log(`recebido ${sinal}, encerrando`)
      // Soltar o lease deixa a réplica seguinte assumir na hora, em vez de esperar
      // os 90 s expirarem com a fila parada.
      try { await soltarLease(workerId) } catch { /* encerrando mesmo assim */ }
      process.exit(0)
    }
    process.on('SIGINT', () => void encerrar('SIGINT'))
    process.on('SIGTERM', () => void encerrar('SIGTERM'))
  }
}
