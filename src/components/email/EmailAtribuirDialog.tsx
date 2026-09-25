import { useEffect, useState } from 'react'
import { AlertTriangle, Link2, Link2Off, Loader2, UserCheck, UserMinus } from 'lucide-react'
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { GlassDialogContent } from '@/components/ui/glass-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import {
  atribuirEmail,
  grudarRemetente,
  desgrudarRemetente,
  getRemetentesFixos,
  contarEmailsSemDono,
  listarColegas,
  type RemetenteFixo,
  type Colega,
} from '@/services/email_atribuicao'
import type { Email } from '@/lib/supabase/email-types'

/**
 * Atribuir um e-mail a alguém da equipe, e (separado, mais sério) grudar o
 * remetente numa pessoa — item 3 da fila de 25/09/2026.
 *
 * O formato segue `EmailPinDialog`: mesmo cabeçalho, mesmo `GlassDialogContent`.
 * A diferença de peso entre as duas seções é DE PROPÓSITO — atribuir troca só
 * este e-mail; grudar é uma regra permanente que decide o dono de e-mail que
 * ainda nem chegou, por isso vem numa caixa destacada (âmbar) com aviso antes
 * de confirmar.
 */

function nomeDaPessoa(p: Colega): string {
  return p.setor ? `${p.nome} · ${p.setor}` : p.nome
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  email: Email
  /** Quem é o dono HOJE deste e-mail (`email_states.assigned_to`) — `null` se ninguém. */
  donoAtual: string | null
  /** Id de quem está logado, para o atalho "Pegar para mim". `null` enquanto a sessão carrega. */
  meuId: string | null
  /** Avisa o `EmailHub` do novo dono, sem esperar recarregar a pasta inteira. */
  onAtribuido: (emailId: string, novoDono: string | null) => void
}

export function EmailAtribuirDialog({ open, onOpenChange, email, donoAtual, meuId, onAtribuido }: Props) {
  const [pessoas, setPessoas] = useState<Colega[]>([])
  const [carregandoPessoas, setCarregandoPessoas] = useState(false)
  const [pessoaEscolhida, setPessoaEscolhida] = useState('')
  const [atribuindo, setAtribuindo] = useState(false)

  // ── Remetente grudado ──
  const [regra, setRegra] = useState<RemetenteFixo | null>(null)
  const [pessoaParaGrudar, setPessoaParaGrudar] = useState('')
  const [semDono, setSemDono] = useState<number | null>(null)
  const [grudando, setGrudando] = useState(false)
  const [desgrudando, setDesgrudando] = useState(false)

  const remetente = email.from_email

  // Recarrega tudo a cada abertura — o e-mail (e o remetente) pode ter mudado
  // desde a última vez que o diálogo esteve aberto.
  useEffect(() => {
    if (!open) return
    setPessoaEscolhida(donoAtual ?? '')

    setCarregandoPessoas(true)
    listarColegas()
      .then(setPessoas)
      .catch((e) =>
        toast({
          title: 'Não consegui listar a equipe',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        }),
      )
      .finally(() => setCarregandoPessoas(false))

    setSemDono(null)
    Promise.all([getRemetentesFixos(email.account_id), contarEmailsSemDono(email.account_id, remetente)])
      .then(([regras, n]) => {
        const atual = regras.find((r) => r.remetente === remetente.trim().toLowerCase()) ?? null
        setRegra(atual)
        setPessoaParaGrudar(atual?.user_id ?? '')
        setSemDono(n)
      })
      .catch((e) => console.error('remetente fixo:', e))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, email.id])

  async function aplicarAtribuicao(novoDono: string | null) {
    setAtribuindo(true)
    try {
      await atribuirEmail(email.id, novoDono)
      onAtribuido(email.id, novoDono)
      toast({ title: novoDono ? 'E-mail atribuído' : 'Dono removido' })
    } catch (e) {
      toast({
        title: 'Não consegui atribuir',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setAtribuindo(false)
    }
  }

  async function confirmarGrudar() {
    if (!pessoaParaGrudar) return
    setGrudando(true)
    try {
      const aplicados = await grudarRemetente(email.account_id, remetente, pessoaParaGrudar)
      toast({
        title: regra ? 'Regra atualizada' : 'Remetente grudado',
        description:
          aplicados > 0
            ? `${aplicados} e-mail${aplicados === 1 ? '' : 's'} já recebido${aplicados === 1 ? '' : 's'} foi${aplicados === 1 ? '' : 'ram'} atribuído${aplicados === 1 ? '' : 's'} agora.`
            : 'Nenhum e-mail antigo precisou mudar de dono.',
      })
      const regras = await getRemetentesFixos(email.account_id)
      setRegra(regras.find((r) => r.remetente === remetente.trim().toLowerCase()) ?? null)
      // Este e-mail específico também pode ter ganhado dono agora — o Hub
      // decide sozinho se precisa recarregar a organização/lista.
      onAtribuido(email.id, pessoaParaGrudar)
    } catch (e) {
      toast({
        title: 'Não consegui grudar o remetente',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setGrudando(false)
    }
  }

  async function confirmarDesgrudar() {
    setDesgrudando(true)
    try {
      await desgrudarRemetente(email.account_id, remetente)
      setRegra(null)
      toast({ title: 'Remetente desgrudado', description: 'Quem já tinha dono continua com dono.' })
    } catch (e) {
      toast({
        title: 'Não consegui desgrudar',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setDesgrudando(false)
    }
  }

  const nomePor = (id: string | null) => {
    if (!id) return null
    const p = pessoas.find((x) => x.id === id)
    return p ? nomeDaPessoa(p) : 'alguém'
  }

  const ocupado = atribuindo || grudando || desgrudando

  return (
    <Dialog open={open} onOpenChange={(v) => !ocupado && onOpenChange(v)}>
      <GlassDialogContent className="sm:max-w-md gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-0 border-b border-border/60 px-5 py-4">
          <DialogTitle className="text-[15px] leading-tight">Atribuir e-mail</DialogTitle>
          <p className="truncate text-xs text-muted-foreground" title={email.subject ?? undefined}>
            {email.subject || '(sem assunto)'}
          </p>
        </DialogHeader>

        <div className="space-y-5 px-5 py-4">
          {/* Seção 1 — dono DESTE e-mail */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Responsável por este e-mail</Label>
            {donoAtual && (
              <p className="text-xs text-muted-foreground">
                Hoje com: <strong className="text-foreground">{nomePor(donoAtual)}</strong>
              </p>
            )}
            <div className="flex gap-2">
              <Select value={pessoaEscolhida} onValueChange={setPessoaEscolhida} disabled={ocupado || carregandoPessoas}>
                <SelectTrigger className="h-9 flex-1">
                  <SelectValue placeholder="Escolher pessoa..." />
                </SelectTrigger>
                <SelectContent>
                  {pessoas.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {nomeDaPessoa(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={ocupado || !pessoaEscolhida || pessoaEscolhida === donoAtual}
                onClick={() => aplicarAtribuicao(pessoaEscolhida)}
              >
                {atribuindo && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Atribuir
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={ocupado || !meuId || donoAtual === meuId}
                onClick={() => meuId && aplicarAtribuicao(meuId)}
              >
                <UserCheck className="h-3.5 w-3.5" />
                Pegar para mim
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground hover:text-destructive"
                disabled={ocupado || !donoAtual}
                onClick={() => aplicarAtribuicao(null)}
              >
                <UserMinus className="h-3.5 w-3.5" />
                Tirar o dono
              </Button>
            </div>
          </div>

          {/*
            Seção 2 — grudar o remetente. Visualmente MAIS séria (moldura âmbar)
            que a de cima: isto não muda um e-mail, muda o destino de todo e-mail
            futuro daquele endereço, e ainda reatribui o que já chegou sem dono.
          */}
          <div className="space-y-2.5 rounded-lg border border-amber-300/70 bg-amber-50/60 p-3 dark:border-amber-800/70 dark:bg-amber-950/30">
            <div className="flex items-start gap-2">
              <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                  Todo e-mail futuro de <span className="break-all font-mono">{remetente}</span> vai direto para
                  esta pessoa
                </p>
                <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
                  Regra permanente, aplicada pelo banco assim que o e-mail chega — vale até alguém desgrudar.
                </p>
              </div>
            </div>

            {regra && (
              <p className="text-xs text-amber-900 dark:text-amber-200">
                Hoje grudado em <strong>{nomePor(regra.user_id)}</strong>.
              </p>
            )}

            <Select
              value={pessoaParaGrudar}
              onValueChange={setPessoaParaGrudar}
              disabled={ocupado || carregandoPessoas}
            >
              <SelectTrigger className="h-9 bg-background">
                <SelectValue placeholder="Escolher pessoa..." />
              </SelectTrigger>
              <SelectContent>
                {pessoas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {nomeDaPessoa(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/*
              ⚠️ O aviso que evita disparo em massa sem querer. Medido em
              produção: um remetente real tem 460 e-mails na caixa — sem contar
              ANTES de confirmar, "grudar" pareceria uma ação de uma linha só,
              e quem clicasse não saberia que estava reatribuindo centenas de
              mensagens de uma vez.
            */}
            {semDono !== null && semDono > 0 && (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-900 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Isso também vai atribuir {semDono} e-mail{semDono === 1 ? '' : 's'} já recebido
                {semDono === 1 ? '' : 's'} deste remetente que ainda não {semDono === 1 ? 'tem' : 'têm'} dono.
              </p>
            )}

            <div className="flex justify-end gap-2">
              {regra && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-muted-foreground"
                  disabled={ocupado}
                  onClick={confirmarDesgrudar}
                >
                  {desgrudando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2Off className="h-3.5 w-3.5" />}
                  Desgrudar
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-amber-400 text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
                disabled={ocupado || !pessoaParaGrudar}
                onClick={confirmarGrudar}
              >
                {grudando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {regra ? 'Trocar' : 'Grudar'}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border/60 px-5 py-3.5">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={ocupado}>
            Fechar
          </Button>
        </DialogFooter>
      </GlassDialogContent>
    </Dialog>
  )
}
