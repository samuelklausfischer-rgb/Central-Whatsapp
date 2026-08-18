/**
 * Carregando, erro e vazio são TRÊS coisas diferentes e cada uma tem a sua
 * mensagem. O Dashboard antigo tratava as três como vazio, então uma queda de
 * rede virava "nada pendente" — a leitura oposta à realidade, justamente num
 * painel cuja função é avisar do que falta fazer.
 *
 * Extraído de `src/pages/Index.tsx` porque mais de 8 telas precisam do mesmo
 * contrato (tarefas, notas, agendamentos, etc. em cada tela nova). Comentário
 * e comportamento preservados ao pé da letra — só mudou o endereço do
 * arquivo.
 */
import { AlertTriangle } from 'lucide-react'

export function EstadoPainel({
  carregando, erro, vazio, mensagemVazio, aoTentarDeNovo,
}: {
  carregando: boolean; erro: boolean; vazio: boolean
  mensagemVazio: string; aoTentarDeNovo?: () => void
}) {
  if (carregando) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          // `bg-muted/40` era opaco sobre `bg-card` — sobre vidro translúcido
          // ficava um retângulo sólido destoando do resto. `bg-foreground/10`
          // acompanha o token de texto, então funciona nos dois temas sem
          // precisar de um par `dark:`.
          <div key={i} className="h-11 rounded-xl bg-foreground/10 animate-pulse" />
        ))}
      </div>
    )
  }
  if (erro) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center gap-2">
        <AlertTriangle className="h-6 w-6 text-amber-500" />
        <p className="text-xs text-muted-foreground">Não deu para carregar agora.</p>
        {aoTentarDeNovo && (
          <button
            onClick={aoTentarDeNovo}
            className="text-xs font-medium text-foreground underline underline-offset-2 hover:opacity-80"
          >
            Tentar de novo
          </button>
        )}
      </div>
    )
  }
  if (vazio) {
    return <p className="text-xs text-muted-foreground text-center py-6">{mensagemVazio}</p>
  }
  return null
}
