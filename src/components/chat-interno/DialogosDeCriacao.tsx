import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SeletorDePessoas } from '@/components/chat-interno/SeletorDePessoas'
import { useToast } from '@/hooks/use-toast'
import { abrirDireta, criarGrupo, mensagemDoErro } from '@/services/chat_interno'
import { carregarDiretorio, carregarResumo, useChatInternoStore } from '@/stores/chatInterno'

/** Lista de colegas pronta para os diálogos; relê o diretório toda vez que o diálogo abre. */
function useDiretorio(aberto: boolean) {
  const pessoas = useChatInternoStore((e) => e.diretorio)
  const estado = useChatInternoStore((e) => e.diretorioEstado)
  const recarregar = useCallback(() => void carregarDiretorio(true), [])
  useEffect(() => {
    // Sempre relê ao abrir: gente nova e gente desativada muda, e o diálogo é
    // aberto raramente — o custo é uma RPC.
    if (aberto) void carregarDiretorio(true)
  }, [aberto])
  return { pessoas: pessoas ?? [], carregando: estado === 'carregando' || estado === 'inicial', erro: estado === 'erro', recarregar }
}

/** "Nova conversa": escolher UMA pessoa abre (ou reabre) a conversa direta com ela. */
export function DialogoNovaConversa({
  aberto,
  onFechar,
  onAbrirConversa,
}: {
  aberto: boolean
  onFechar: () => void
  onAbrirConversa: (conversaId: string) => void
}) {
  const { toast } = useToast()
  const { pessoas, carregando, erro, recarregar } = useDiretorio(aberto)
  const [abrindo, setAbrindo] = useState<string | null>(null)

  const escolher = async (id: string) => {
    setAbrindo(id)
    try {
      const conversaId = await abrirDireta(id)
      // A lista precisa já conter a conversa quando a janela abrir; sem isto a
      // janela acharia que ela não existe.
      await carregarResumo({ forcar: true })
      onFechar()
      onAbrirConversa(conversaId)
    } catch (e) {
      toast({ title: mensagemDoErro(e, 'Não foi possível abrir a conversa'), variant: 'destructive' })
    } finally {
      setAbrindo(null)
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !abrindo && onFechar()}>
      <DialogContent className="gap-4 border-chat-border bg-chat-panel sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
          <DialogDescription>Escolha uma pessoa da equipe para conversar.</DialogDescription>
        </DialogHeader>
        <SeletorDePessoas
          pessoas={pessoas}
          carregando={carregando}
          erro={erro}
          onTentarDeNovo={recarregar}
          modo="unico"
          onEscolher={(id) => void escolher(id)}
          ocupado={abrindo}
        />
      </DialogContent>
    </Dialog>
  )
}

/** "Novo grupo": nome + várias pessoas. Quem cria vira administrador. */
export function DialogoNovoGrupo({
  aberto,
  onFechar,
  onAbrirConversa,
}: {
  aberto: boolean
  onFechar: () => void
  onAbrirConversa: (conversaId: string) => void
}) {
  const { toast } = useToast()
  const { pessoas, carregando, erro, recarregar } = useDiretorio(aberto)
  const [nome, setNome] = useState('')
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set())
  const [criando, setCriando] = useState(false)

  // Reabrir não pode trazer o rascunho do grupo anterior.
  useEffect(() => {
    if (aberto) {
      setNome('')
      setEscolhidos(new Set())
    }
  }, [aberto])

  const alternar = (id: string) =>
    setEscolhidos((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(id)) proximo.delete(id)
      else proximo.add(id)
      return proximo
    })

  const nomeLimpo = nome.trim().replace(/\s+/g, ' ')
  const podeCriar = nomeLimpo.length >= 1 && escolhidos.size >= 1 && !criando

  const criar = async () => {
    if (!podeCriar) return
    setCriando(true)
    try {
      const conversaId = await criarGrupo(nomeLimpo, [...escolhidos])
      await carregarResumo({ forcar: true })
      onFechar()
      onAbrirConversa(conversaId)
    } catch (e) {
      toast({ title: mensagemDoErro(e, 'Não foi possível criar o grupo'), variant: 'destructive' })
    } finally {
      setCriando(false)
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !criando && onFechar()}>
      <DialogContent className="gap-4 border-chat-border bg-chat-panel sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Novo grupo</DialogTitle>
          <DialogDescription>Dê um nome e escolha quem participa. Você será o administrador.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="chat-interno-nome-grupo">Nome do grupo</Label>
          <Input
            id="chat-interno-nome-grupo"
            value={nome}
            maxLength={80}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Financeiro - fechamento"
            className="border-chat-border bg-chat-sidebar text-chat-text"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void criar()
              }
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between">
            <Label>Participantes</Label>
            <span className="text-xs text-chat-muted">
              {escolhidos.size === 0 ? 'Ninguém escolhido' : `${escolhidos.size} escolhido${escolhidos.size > 1 ? 's' : ''}`}
            </span>
          </div>
          <SeletorDePessoas
            pessoas={pessoas}
            carregando={carregando}
            erro={erro}
            onTentarDeNovo={recarregar}
            modo="multiplo"
            selecionados={escolhidos}
            onAlternar={alternar}
            alturaMaxima="max-h-[260px]"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onFechar} disabled={criando} className="border-chat-border bg-transparent hover:bg-chat-hover">
            Cancelar
          </Button>
          <Button type="button" onClick={() => void criar()} disabled={!podeCriar}>
            {criando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Criar grupo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
