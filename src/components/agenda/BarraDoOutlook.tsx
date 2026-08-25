import { CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { COR_AVISO, COR_ERRO, COR_ICONE_OUTLOOK } from './cores'
import type { StatusDaConexao } from '@/services/agenda_microsoft'

/**
 * A faixa de estado do Outlook e os dois avisos da tela.
 *
 * Erro do Outlook e erro da Agenda são SEPARADOS de propósito: falha ao ler o
 * Outlook não impede a agenda daqui de funcionar, então vira aviso âmbar e não
 * erro vermelho. Misturar os dois faria a pessoa achar que perdeu tudo quando
 * perdeu só a metade de fora.
 */
export function BarraDoOutlook({
  conexao,
  erroOutlook,
  erro,
  aoConectar,
  aoDesconectar,
}: {
  conexao: StatusDaConexao
  erroOutlook: string | null
  erro: string | null
  aoConectar: () => void
  aoDesconectar: () => void
}) {
  return (
    <>
      {/*
        Só aparece quando o servidor já tem as chaves do aplicativo. Sem elas,
        oferecer "Conectar" seria prometer um botão que daria erro.
      */}
      {conexao.configurado && (
        <div className="mx-6 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-accent/30 px-4 py-2.5">
          <CalendarDays className={cn('h-4 w-4 shrink-0', COR_ICONE_OUTLOOK)} aria-hidden="true" />
          {conexao.conectado ? (
            <>
              <span className="min-w-0 flex-1 break-words text-sm text-muted-foreground">
                Outlook conectado{conexao.conta_email ? ` como ${conexao.conta_email}` : ''}
              </span>
              <Button variant="ghost" size="sm" onClick={aoDesconectar}>
                Desconectar
              </Button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 break-words text-sm text-muted-foreground">
                Conecte seu Outlook para ver aqui os compromissos que já estão lá.
              </span>
              <Button size="sm" onClick={aoConectar}>
                Conectar Outlook
              </Button>
            </>
          )}
        </div>
      )}

      {erroOutlook && (
        <p className={cn('mx-6 mt-3 rounded-lg border p-3 text-sm', COR_AVISO)}>
          {erroOutlook} — os compromissos criados aqui continuam aparecendo normalmente.
        </p>
      )}

      {erro && <p className={cn('mx-6 mt-4 rounded-lg border p-3 text-sm', COR_ERRO)}>{erro}</p>}
    </>
  )
}
