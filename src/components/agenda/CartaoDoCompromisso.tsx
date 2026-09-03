import { format } from 'date-fns'
import { Link2, Mail, Pencil, Repeat, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COR_ACAO_EXCLUIR, COR_OUTLOOK, COR_REPETE, CORES_IMPORTANCIA, estiloDaCorPessoal } from './cores'
import type { ItemDaAgenda } from './tipos'

/** O cartão do compromisso, na lista lateral do dia. */
export function CartaoDoCompromisso({
  ev,
  aoEditar,
  aoExcluir,
}: {
  ev: ItemDaAgenda
  aoEditar: (ev: ItemDaAgenda) => void
  aoExcluir: (ev: ItemDaAgenda) => void
}) {
  return (
    <div
      className="rounded-lg border border-border/60 bg-accent/30 p-3"
      style={estiloDaCorPessoal(ev.cor)}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => ev.podeEditar && aoEditar(ev)}
          className={cn(
            'min-w-0 flex-1 break-words text-left text-sm font-medium',
            ev.podeEditar && 'hover:text-primary',
          )}
          title={ev.podeEditar ? 'Clique para editar' : undefined}
        >
          {ev.titulo}
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {ev.seRepete && (
            <span
              className={cn('inline-flex items-center rounded border px-1 text-[10px]', COR_REPETE)}
              title="Faz parte de um compromisso que se repete"
            >
              <Repeat className="h-2.5 w-2.5" />
            </span>
          )}
          {/* Origem antes de importância: saber DE ONDE vem é o que responde
              "por que isso está aqui se eu não marquei". */}
          {ev.origem === 'outlook' ? (
            <span className={cn('rounded border px-1.5 text-[10px]', COR_OUTLOOK)}>Outlook</span>
          ) : (
            <span className={cn('rounded border px-1.5 text-[10px]', CORES_IMPORTANCIA[ev.importancia])}>
              {ev.importancia}
            </span>
          )}
        </div>
      </div>

      <p className="mt-0.5 text-xs text-muted-foreground">
        {ev.dia_inteiro
          ? 'Dia inteiro'
          : `${format(new Date(ev.starts_at), 'HH:mm')} – ${format(new Date(ev.ends_at), 'HH:mm')}`}
        {ev.escopo === 'setor' && ` · setor ${ev.setor}`}
        {ev.escopo === 'grupo' && ' · grupo'}
      </p>

      {ev.descricao && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{ev.descricao}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {ev.link && (
          <a
            href={ev.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Link2 className="h-3 w-3" />
            {ev.origem === 'outlook' ? 'Abrir no Outlook' : 'Abrir link'}
          </a>
        )}
        {ev.email && (
          <a
            href={`mailto:${ev.email}`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Mail className="h-3 w-3" /> {ev.email}
          </a>
        )}

        <div className="ml-auto flex items-center gap-3">
          {/* Editar e excluir seguem regras DIFERENTES na agenda interna: o
              designado edita, mas só o criador (ou um admin) apaga. */}
          {ev.podeEditar && (
            <button
              type="button"
              onClick={() => aoEditar(ev)}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Pencil className="h-3 w-3" /> Editar
            </button>
          )}
          {ev.podeExcluir && (
            <button
              type="button"
              onClick={() => aoExcluir(ev)}
              className={cn('inline-flex items-center gap-1 text-xs hover:underline', COR_ACAO_EXCLUIR)}
            >
              <Trash2 className="h-3 w-3" /> Excluir
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
