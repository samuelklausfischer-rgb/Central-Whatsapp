import { format } from 'date-fns'
import { AlertTriangle, Link2, Mail, Pencil, Repeat, Trash2, UserCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COR_ACAO_EXCLUIR, COR_AVISO, COR_OUTLOOK, COR_REPETE, CORES_IMPORTANCIA } from './cores'
import type { ItemDaAgenda } from './tipos'

/** O cartão do compromisso, na lista lateral do dia. */
export function CartaoDoCompromisso({
  ev,
  aoEditar,
  aoExcluir,
  aoReenviarConvite,
  reenviandoConvite = false,
}: {
  ev: ItemDaAgenda
  aoEditar: (ev: ItemDaAgenda) => void
  aoExcluir: (ev: ItemDaAgenda) => void
  /** Refaz o convite do grupo no Outlook depois de uma falha. */
  aoReenviarConvite?: (ev: ItemDaAgenda) => void
  reenviandoConvite?: boolean
}) {
  /*
    O botão de tentar de novo só faz sentido para QUEM CRIOU.

    O evento mora na caixa de correio do organizador, e refazer o convite com o
    token de outra pessoa criaria um evento novo na caixa dela — deixando o
    original órfão no Outlook do criador. Para quem não criou, o aviso aparece
    mesmo assim: saber que o convite não chegou é informação útil (é a diferença
    entre "não recebi" e "não fui convidado"), mesmo sem poder consertar.
  */
  const podeReenviar = Boolean(ev.outlook_sync_erro) && ev.souOCriador && Boolean(aoReenviarConvite)

  return (
    <div className="rounded-lg border border-border/60 bg-accent/30 p-3">
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
          {/* Selo DISCRETO, só ícone: o convite deu certo, então não há nada
              para a pessoa fazer — é confirmação, não chamado. O caso que
              precisa de espaço e de palavras é o contrário, o da falha, e ele
              aparece embaixo. O `outlook_sync_erro` tem precedência: com erro
              pendente, o `outlook_event_id` pode ser de uma tentativa anterior
              que já não corresponde ao que está na tela. */}
          {ev.outlook_event_id && !ev.outlook_sync_erro && (
            <span
              className={cn('inline-flex items-center rounded border px-1 text-[10px]', COR_OUTLOOK)}
              title="O grupo foi convidado no Outlook"
            >
              <UserCheck className="h-2.5 w-2.5" />
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

      {/*
        AVISO, e não erro: o compromisso existe, está marcado e todo mundo do
        grupo o vê aqui. O que falhou foi só o convite na agenda da Microsoft —
        por isso `COR_AVISO` (âmbar) e não `COR_ERRO` (vermelho), que é
        reservado ao que impede a tela de funcionar.

        A mensagem do Graph vai INTEIRA, sem tradução: "conexão expirada" e
        "o endereço fulano@… não existe" dão em ações completamente diferentes,
        e resumir as duas para "falha ao convidar" apagaria justamente a parte
        que diz o que fazer.
      */}
      {ev.outlook_sync_erro && (
        <div className={cn('mt-2 rounded-lg border p-2.5 text-xs', COR_AVISO)}>
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">
              O grupo <b>não foi convidado</b> no Outlook: {ev.outlook_sync_erro}
            </span>
          </p>
          {podeReenviar && (
            <button
              type="button"
              onClick={() => aoReenviarConvite?.(ev)}
              disabled={reenviandoConvite}
              className="mt-1.5 pl-[1.375rem] text-xs font-medium underline-offset-2 hover:underline disabled:opacity-60"
            >
              {reenviandoConvite ? 'Convidando…' : 'Tentar de novo'}
            </button>
          )}
        </div>
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
