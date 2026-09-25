import { Mail, MailOpen, Star, StarOff, Archive, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

interface Props {
  /** Quantos e-mails estão marcados agora. A barra some quando é zero — quem decide isso é o `EmailHub` (não renderiza o componente). */
  selecionados: number
  /** Quantos e-mails existem na lista ATUAL (a página de até 100 que está na tela), para o checkbox "selecionar todos" saber se já pegou todo mundo. */
  totalNaLista: number
  /** Liga (true) ou desliga (false) a seleção de todos os e-mails da lista atual. */
  onSelecionarTodos: (marcar: boolean) => void
  onLimparSelecao: () => void
  onMarcarLido: () => void
  onMarcarNaoLido: () => void
  onAdicionarEstrela: () => void
  onRemoverEstrela: () => void
  onArquivar: () => void
  /** Enquanto uma ação em massa está em voo: desabilita os botões para não empilhar cliques. */
  operando: boolean
  /** "12 de 40", só durante o fan-out de marcar lido/estrela — arquivar é uma chamada só e não tem etapas para mostrar. */
  progresso: { feitos: number; total: number } | null
}

/**
 * Faixa de ações em massa da caixa de e-mail.
 *
 * Entra como uma linha A MAIS abaixo da busca (`EmailList` já tem a sua) —
 * de propósito não substitui nem cobre a barra de busca, que continua
 * funcionando normalmente com ou sem seleção ativa.
 *
 * `flex-wrap` nos botões: o app tem layout mobile, e cinco ações com rótulo
 * não cabem numa linha só em tela estreita. Deixar quebrar em vez de
 * espremer em ícone sem texto (que ninguém decoraria o significado).
 */
export function EmailBulkBar({
  selecionados,
  totalNaLista,
  onSelecionarTodos,
  onLimparSelecao,
  onMarcarLido,
  onMarcarNaoLido,
  onAdicionarEstrela,
  onRemoverEstrela,
  onArquivar,
  operando,
  progresso,
}: Props) {
  if (selecionados === 0) return null

  const todosMarcados = totalNaLista > 0 && selecionados >= totalNaLista
  // "Parcial" é o terceiro estado do checkbox mestre (nem tudo, nem nada) —
  // sem ele a pessoa não teria como saber, só olhando o checkbox do topo, que
  // a seleção não cobre a lista inteira.
  const parcial = selecionados > 0 && !todosMarcados

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-muted/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <Checkbox
          checked={todosMarcados ? true : parcial ? 'indeterminate' : false}
          onCheckedChange={(marcado) => onSelecionarTodos(marcado === true)}
          aria-label="Selecionar todos os emails da lista"
          disabled={operando}
        />
        <span className="text-sm font-medium whitespace-nowrap">
          {selecionados} selecionado{selecionados === 1 ? '' : 's'}
        </span>
        {progresso && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {progresso.feitos} de {progresso.total}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1 ml-auto">
        <Button size="sm" variant="ghost" className="gap-1.5" disabled={operando} onClick={onMarcarLido}>
          <MailOpen className="h-4 w-4" />
          Lido
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5" disabled={operando} onClick={onMarcarNaoLido}>
          <Mail className="h-4 w-4" />
          Não lido
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5" disabled={operando} onClick={onAdicionarEstrela}>
          <Star className="h-4 w-4" />
          Estrela
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5" disabled={operando} onClick={onRemoverEstrela}>
          <StarOff className="h-4 w-4" />
          Sem estrela
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={operando} onClick={onArquivar}>
          <Archive className="h-4 w-4" />
          Arquivar
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" disabled={operando} onClick={onLimparSelecao}>
          <X className="h-4 w-4" />
          Limpar
        </Button>
      </div>
    </div>
  )
}
