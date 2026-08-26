import { Motor } from './engine'

/**
 * Disparador em massa — worker.
 *
 * Consome `disparo_alvos` e envia pela `send_whatsapp_message`, no ritmo gravado
 * em cada campanha. Roda como serviço próprio porque um disparo no ritmo seguro
 * leva horas: ele precisa sobreviver a fechar o navegador, e não pode depender de
 * ninguém estar com a tela aberta.
 *
 * Variáveis obrigatórias: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
 * Opcionais: `WORKER_NAME`, `DRY_RUN`, `POLL_INTERVAL_MS`, `LEASE_SECONDS`.
 */

new Motor().iniciar().catch((e) => {
  console.error('[disparador] o worker morreu:', e)
  // Sair com código de erro é de propósito: o EasyPanel reinicia o container, e
  // um worker morto e reiniciado é melhor que um worker morto e silencioso.
  process.exit(1)
})
