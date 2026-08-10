import { useState, useMemo, useCallback } from 'react'
import { Search, Loader2, Users } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { SmartAvatar } from '@/components/chat/SmartAvatar'
import { cn } from '@/lib/utils'
import { podeCompartilhar } from '@/services/contact_share'
import { criarGrupo } from '@/services/groups'
import { EvolutionApiError } from '@/services/evolution_instances'
import { useToast } from '@/hooks/use-toast'
import type { Contact } from '@/lib/supabase/types'

/**
 * Criar grupo novo no WhatsApp. Ação restrita a admin — o gate fica no ponto de
 * entrada (`ChatList`), aqui dentro não se repete a checagem.
 *
 * SELETOR DE PARTICIPANTES — por que não reaproveitar `ContactPickerDialog`
 * como componente: aquele diálogo é o de COMPARTILHAR CARTÃO. Título
 * ("Compartilhar contato"), texto do botão ("Enviar") e o próprio `onEnviar`
 * (que já DISPARA o envio, não só devolve a seleção) são hardcoded para aquele
 * fluxo, sem prop para trocar a cópia. Encaixar a criação de grupo ali dentro
 * exigiria inventar props novas nele para um caso de uso que não é o dele —
 * mais acoplamento do que reaproveitamento de verdade.
 *
 * O que ESTE componente reaproveita, ponto a ponto, é o padrão visual e de
 * filtro do `ContactPickerDialog`: mesmo `podeCompartilhar` (participante de
 * grupo também precisa de telefone de verdade — grupo e LID não servem, mesmo
 * motivo documentado lá), mesmo teto `MAX_ITENS`, mesma lista com busca +
 * `Checkbox` + `SmartAvatar` dentro de `ScrollArea`.
 */
interface Props {
  aberto: boolean
  onFechar: () => void
  deviceId: string | null
  contacts: Contact[]
  instanceKey?: string
  /** Disparado após a Evolution confirmar a criação, com o JID do grupo novo. */
  onCriado?: (groupJid: string | null) => void
}

const MAX_ITENS = 80

/**
 * `not_group_admin` é o código que a edge function usa nas ações sobre um grupo
 * JÁ EXISTENTE (promover, remover, mudar assunto/descrição/foto) — ela passa
 * pela função `respostaErroDeGrupo`, que inspeciona a resposta da Evolution.
 * `groupCreateAction` não passa por ali: toda falha de criação cai no ramo
 * genérico `code: 'evolution_error'` com o status HTTP original da Evolution em
 * `details.evolutionStatus`. Por isso o sinal de "sem permissão" na CRIAÇÃO é o
 * status 401/403 dentro de `details`, não o `code` — mas ainda tratamos
 * `not_group_admin` também, caso o backend evolua para reaproveitar aquele
 * código aqui.
 */
function mensagemDeErro(err: unknown): string {
  if (err instanceof EvolutionApiError) {
    const details = err.details as { code?: string; evolutionStatus?: number } | undefined
    const semPermissao = details?.code === 'not_group_admin' || details?.evolutionStatus === 403 || details?.evolutionStatus === 401
    if (semPermissao) {
      return 'O número conectado não tem permissão para criar grupos no WhatsApp.'
    }
    return err.message || 'Não foi possível criar o grupo.'
  }
  return err instanceof Error ? err.message : 'Não foi possível criar o grupo.'
}

export function CreateGroupDialog({ aberto, onFechar, deviceId, contacts, instanceKey, onCriado }: Props) {
  const { toast } = useToast()
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [busca, setBusca] = useState('')
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [criando, setCriando] = useState(false)

  const compartilhaveis = useMemo(() => contacts.filter(podeCompartilhar), [contacts])

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const comNome = compartilhaveis.map((c) => ({
      c,
      nome: c.nickname || c.name || `+${c.remote_jid}`,
    }))
    const ordenados = comNome.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    if (!termo) return ordenados.slice(0, MAX_ITENS)
    return ordenados
      .filter((x) => x.nome.toLowerCase().includes(termo) || x.c.remote_jid.includes(termo))
      .slice(0, MAX_ITENS)
  }, [compartilhaveis, busca])

  const alternar = useCallback((jid: string) => {
    setMarcados((prev) => {
      const proximo = new Set(prev)
      if (proximo.has(jid)) proximo.delete(jid)
      else proximo.add(jid)
      return proximo
    })
  }, [])

  // Mesma razão do `ContactPickerDialog`: este diálogo não desmonta ao trocar
  // de conversa/aparelho, então fechar sem limpar deixaria nome, descrição e
  // participantes marcados pendurados para a próxima abertura.
  const resetar = useCallback(() => {
    setNome('')
    setDescricao('')
    setBusca('')
    setMarcados(new Set())
  }, [])

  const fechar = useCallback(() => {
    if (criando) return
    resetar()
    onFechar()
  }, [criando, onFechar, resetar])

  const criar = useCallback(async () => {
    const subject = nome.trim()
    if (!subject) {
      toast({ title: 'Dê um nome ao grupo', variant: 'destructive' })
      return
    }
    if (marcados.size === 0) {
      toast({ title: 'Selecione ao menos um participante', variant: 'destructive' })
      return
    }
    if (!deviceId) {
      toast({ title: 'Selecione um dispositivo antes de criar o grupo', variant: 'destructive' })
      return
    }
    setCriando(true)
    try {
      const participants = [...marcados]
      const resultado = await criarGrupo(deviceId, subject, participants, descricao.trim() || undefined)
      toast({
        title: 'Grupo criado',
        description: `"${subject}" foi criado com ${participants.length} participante${participants.length > 1 ? 's' : ''}.`,
      })
      onCriado?.(resultado.groupJid)
      resetar()
      onFechar()
    } catch (err) {
      toast({ title: 'Não foi possível criar o grupo', description: mensagemDeErro(err), variant: 'destructive' })
    } finally {
      setCriando(false)
    }
  }, [nome, descricao, marcados, deviceId, onCriado, onFechar, resetar, toast])

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="sm:max-w-[440px] bg-chat-panel border-chat-border flex flex-col max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="text-chat-text flex items-center gap-2">
            <Users className="h-4 w-4" />
            Criar grupo
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2 shrink-0">
          <Input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do grupo"
            disabled={criando}
            className="bg-chat-hover border-chat-border"
            maxLength={100}
          />
          <Textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descrição (opcional)"
            disabled={criando}
            className="bg-chat-hover border-chat-border resize-none"
            rows={2}
            maxLength={500}
          />
        </div>

        <div className="relative shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-chat-muted" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar contato..."
            disabled={criando}
            className="pl-9 bg-chat-hover border-chat-border"
          />
        </div>

        <ScrollArea className="h-[260px] -mx-2 px-2">
          <div className="flex flex-col gap-0.5 py-1">
            {filtrados.length === 0 && (
              <p className="text-center text-sm text-chat-muted py-8">Nenhum contato encontrado.</p>
            )}
            {filtrados.map(({ c, nome: nomeContato }) => {
              const marcado = marcados.has(c.remote_jid)
              return (
                <button
                  key={c.remote_jid}
                  type="button"
                  disabled={criando}
                  onClick={() => alternar(c.remote_jid)}
                  className={cn(
                    'flex items-center gap-3 rounded px-2 py-2 text-left transition-colors',
                    marcado ? 'bg-chat-hover' : 'hover:bg-chat-hover',
                    criando && 'opacity-50',
                  )}
                >
                  <Checkbox checked={marcado} className="shrink-0" tabIndex={-1} />
                  <SmartAvatar
                    jid={c.remote_jid}
                    name={nomeContato}
                    instanceKey={instanceKey}
                    contactRecord={c}
                    className="h-9 w-9 shrink-0"
                    fallbackClassName="text-xs bg-chat-hover text-chat-text"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-sm text-chat-text">{nomeContato}</span>
                    <span className="block truncate text-xs text-chat-muted">+{c.remote_jid}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={fechar} disabled={criando}>
            Cancelar
          </Button>
          <Button onClick={criar} disabled={criando}>
            {criando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Criar grupo{marcados.size > 0 ? ` (${marcados.size})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
