import { useState } from 'react'
import { Loader2, Camera, Users as UsersIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { EvolutionApiError } from '@/services/evolution_instances'
import {
  atualizarFotoDoGrupo,
  atualizarAssuntoDoGrupo,
  atualizarDescricaoDoGrupo,
  sairDoGrupo,
} from '@/services/groups'

/**
 * Traduz o erro da edge function pros dois casos que o atendente precisa
 * distinguir na hora ('a instância nem está mais nesse grupo' é uma causa raiz
 * bem diferente de 'você não é admin'). Qualquer outro código cai na mensagem
 * original que a Evolution devolveu — não inventamos texto pra erro que não
 * conhecemos.
 */
function mensagemDeErro(err: unknown): string {
  if (err instanceof EvolutionApiError) {
    const code = (err.details as any)?.code
    if (code === 'group_unavailable') {
      return 'Este número não está mais nesse grupo — a ação não pode ser executada.'
    }
    if (code === 'not_group_admin') {
      return 'O número conectado não é administrador deste grupo.'
    }
    return err.message || 'Erro ao executar a ação.'
  }
  return err instanceof Error ? err.message : 'Erro inesperado.'
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  deviceId: string
  groupJid: string
  /** Nome atual, só pra contexto no título do diálogo — não vem de nenhum GET. */
  groupNome: string
  /**
   * Sair do grupo é ação restrita (gate de admin decidido pelo usuário: trocar
   * foto/nome/descrição é liberado pra qualquer um com acesso ao aparelho, sair
   * é só admin). O botão fica OCULTO pra quem não é admin, não desabilitado.
   */
  isAdmin: boolean
  /** Chamado depois que `sairDoGrupo` confirma sucesso — quem chama decide o que fazer (fechar painel, tirar o contato da lista, etc). */
  onSaiuDoGrupo?: () => void
}

export function GroupActionsDialog({ open, onOpenChange, deviceId, groupJid, groupNome, isAdmin, onSaiuDoGrupo }: Props) {
  const { toast } = useToast()

  const [novoNome, setNovoNome] = useState('')
  const [salvandoNome, setSalvandoNome] = useState(false)

  const [novaDescricao, setNovaDescricao] = useState('')
  const [salvandoDescricao, setSalvandoDescricao] = useState(false)

  const [enviandoFoto, setEnviandoFoto] = useState(false)

  const [confirmandoSaida, setConfirmandoSaida] = useState(false)
  const [saindo, setSaindo] = useState(false)

  const salvarNome = async () => {
    const assunto = novoNome.trim()
    if (!assunto) return
    setSalvandoNome(true)
    try {
      await atualizarAssuntoDoGrupo(deviceId, groupJid, assunto)
      toast({ title: 'Nome do grupo atualizado' })
      setNovoNome('')
    } catch (err) {
      toast({ title: mensagemDeErro(err), variant: 'destructive' })
    } finally {
      setSalvandoNome(false)
    }
  }

  const salvarDescricao = async () => {
    setSalvandoDescricao(true)
    try {
      // Descrição vazia é válida (limpa a descrição do grupo) — por isso não há
      // guarda de "vazio não faz nada" aqui como em nome/foto.
      await atualizarDescricaoDoGrupo(deviceId, groupJid, novaDescricao.trim())
      toast({ title: 'Descrição do grupo atualizada' })
      setNovaDescricao('')
    } catch (err) {
      toast({ title: mensagemDeErro(err), variant: 'destructive' })
    } finally {
      setSalvandoDescricao(false)
    }
  }

  const trocarFoto = async (file: File) => {
    setEnviandoFoto(true)
    try {
      // PENDÊNCIA: a rota da Evolution espera o campo `image`, mas não foi
      // confirmado contra a instância real se ela aceita base64 data URL ou só
      // URL pública. Base64 é o formato mais provável (é o que a lib de criação
      // de grupo já usa em outros pontos do projeto) — mas isto precisa de
      // validação com uma chamada real antes de confiar cegamente no resultado.
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      await atualizarFotoDoGrupo(deviceId, groupJid, dataUrl)
      toast({ title: 'Foto do grupo atualizada' })
    } catch (err) {
      toast({ title: mensagemDeErro(err), variant: 'destructive' })
    } finally {
      setEnviandoFoto(false)
    }
  }

  const confirmarSaida = async () => {
    setSaindo(true)
    try {
      await sairDoGrupo(deviceId, groupJid)
      toast({ title: 'Você saiu do grupo' })
      setConfirmandoSaida(false)
      onOpenChange(false)
      onSaiuDoGrupo?.()
    } catch (err) {
      toast({ title: mensagemDeErro(err), variant: 'destructive' })
    } finally {
      setSaindo(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[440px] bg-chat-panel border-chat-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UsersIcon className="h-4 w-4 text-chat-muted" />
              Ações do grupo{groupNome ? ` — ${groupNome}` : ''}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-5 py-2">
            <div className="grid gap-2">
              <Label>Foto do grupo</Label>
              <label
                className="flex items-center justify-center gap-2 h-10 rounded-md border border-dashed border-chat-border text-sm text-chat-muted hover:bg-chat-hover cursor-pointer transition-colors"
              >
                {enviandoFoto ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
                {enviandoFoto ? 'Enviando...' : 'Escolher nova foto'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={enviandoFoto}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = '' // permite escolher o mesmo arquivo de novo depois de um erro
                    if (file) trocarFoto(file)
                  }}
                />
              </label>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="group-actions-nome">Nome do grupo</Label>
              <div className="flex gap-2">
                <Input
                  id="group-actions-nome"
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  placeholder="Novo nome..."
                  className="bg-chat-panel border-chat-border"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      salvarNome()
                    }
                  }}
                />
                <Button onClick={salvarNome} disabled={salvandoNome || !novoNome.trim()}>
                  {salvandoNome ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="group-actions-descricao">Descrição do grupo</Label>
              <Textarea
                id="group-actions-descricao"
                value={novaDescricao}
                onChange={(e) => setNovaDescricao(e.target.value)}
                placeholder="Nova descrição... (deixe em branco para limpar a descrição atual)"
                className="bg-chat-panel border-chat-border min-h-[80px]"
              />
              <div className="flex justify-end">
                <Button onClick={salvarDescricao} disabled={salvandoDescricao}>
                  {salvandoDescricao ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar descrição'}
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between sm:items-center">
            {/* Sair do grupo é destrutivo e irreversível — só admin, e nunca sem
                confirmação explícita. Oculto (não desabilitado) pra quem não é
                admin, igual ao resto das ações restritas do painel. */}
            {isAdmin && (
              <Button
                variant="outline"
                className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                onClick={() => setConfirmandoSaida(true)}
              >
                Sair do grupo
              </Button>
            )}
            <Button variant="outline" className="bg-transparent border-chat-border hover:bg-chat-hover ml-auto" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmandoSaida} onOpenChange={(v) => !saindo && setConfirmandoSaida(v)}>
        <AlertDialogContent className="bg-chat-panel border-chat-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Sair do grupo{groupNome ? ` "${groupNome}"` : ''}?</AlertDialogTitle>
            <AlertDialogDescription className="text-chat-muted">
              Esta ação é irreversível: o número conectado deixa o grupo agora e não recebe mais
              mensagens dele. Para voltar, alguém do grupo precisa adicionar o número de novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel
              disabled={saindo}
              className="bg-transparent border-chat-border hover:bg-chat-hover text-chat-text"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={saindo}
              className="bg-red-600 hover:bg-red-500 text-white"
              onClick={(e) => {
                e.preventDefault() // AlertDialogAction fecha sozinho; aqui o fechamento depende do await
                confirmarSaida()
              }}
            >
              {saindo ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sair do grupo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
