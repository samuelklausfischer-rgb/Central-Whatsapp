import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Sun, Moon, Sparkles, MessageSquarePlus, ChevronRight } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuth } from '@/hooks/use-auth'
import { ferramentasDoUsuario, itensDeConta, ehAcao, type ItemDeFerramenta } from '@/lib/navegacao'
import { NotificationsDialog } from '@/components/NotificationsDialog'
import { ReleaseNotesDialog } from '@/components/ReleaseNotesDialog'
import { ReportarProblemaDialog } from '@/components/ReportarProblemaDialog'
import { getBundleVersion } from '@/lib/app-info'

/**
 * Tudo que não cabe nas abas do rodapé.
 *
 * No celular, a barra do desktop empurrava para fora da tela justamente os itens
 * de conta: **Sair**, **Configurações** e **Gestão de Equipe** eram
 * inalcançáveis. Esta folha existe para que nenhum destino do app dependa de
 * caber numa linha horizontal.
 *
 * A lista vem de `lib/navegacao`, a MESMA que alimenta a barra do desktop —
 * inclusive os gates de permissão.
 */
export function MobileMoreSheet({
  aberta,
  onAbrirChange,
}: {
  aberta: boolean
  onAbrirChange: (v: boolean) => void
}) {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()
  const [notifAberto, setNotifAberto] = useState(false)
  const [notasAberto, setNotasAberto] = useState(false)
  const [problemaAberto, setProblemaAberto] = useState(false)

  const escuro = resolvedTheme === 'dark'
  const ferramentas = ferramentasDoUsuario(user)
  const conta = itensDeConta(user)
  const iniciais = (user?.name?.[0] || user?.username?.[0] || 'U').toUpperCase()

  function irPara(url: string) {
    onAbrirChange(false)
    navigate(url)
  }

  function acionar(item: ItemDeFerramenta) {
    if (ehAcao(item)) {
      // Fecha a folha ANTES de abrir o diálogo: duas camadas empilhadas fazem o
      // voltar do Android fechar as duas de uma vez.
      onAbrirChange(false)
      setNotifAberto(true)
      return
    }
    irPara(item.url)
  }

  return (
    <>
      <Sheet open={aberta} onOpenChange={onAbrirChange}>
        <SheetContent
          side="bottom"
          className="h-[85dvh] rounded-t-2xl border-border bg-background p-0 flex flex-col"
        >
          <SheetHeader className="px-4 pt-4 pb-3 border-b border-border shrink-0">
            <SheetTitle className="flex items-center gap-3 text-left">
              <Avatar className="h-10 w-10 border border-border">
                <AvatarImage src={user?.avatar_url || undefined} alt={user?.name || 'Usuário'} />
                <AvatarFallback className="bg-primary/20 text-primary text-sm">{iniciais}</AvatarFallback>
              </Avatar>
              <span className="flex-1 min-w-0">
                <span className="block truncate text-base font-medium text-foreground">
                  {user?.name || user?.username || 'Usuário'}
                </span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  @{user?.username}
                </span>
              </span>
            </SheetTitle>
          </SheetHeader>

          {/* `overscroll-contain` impede que a rolagem no fim da lista arraste a
              folha inteira e a feche sem querer. */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-3">
            <Secao titulo="Ferramentas">
              {ferramentas.map((item) => (
                <Linha
                  key={item.title}
                  icone={item.icon}
                  titulo={item.title}
                  descricao={item.description}
                  onClick={() => acionar(item)}
                />
              ))}
            </Secao>

            <Secao titulo="Conta">
              {conta.map((item) => (
                <Linha
                  key={item.url}
                  icone={item.icon}
                  titulo={item.title}
                  descricao={item.description}
                  onClick={() => irPara(item.url)}
                />
              ))}
              <Linha
                icone={escuro ? Sun : Moon}
                titulo={escuro ? 'Modo claro' : 'Modo escuro'}
                descricao="Aparência do app"
                onClick={() => setTheme(escuro ? 'light' : 'dark')}
                mantemAberta
              />
            </Secao>

            <Secao titulo="Sobre">
              <Linha
                icone={Sparkles}
                titulo="Últimas atualizações"
                descricao={`Versão ${getBundleVersion() ?? '—'}`}
                onClick={() => {
                  onAbrirChange(false)
                  setNotasAberto(true)
                }}
              />
              <Linha
                icone={MessageSquarePlus}
                titulo="Reportar problema"
                descricao="Erro ou sugestão"
                onClick={() => {
                  onAbrirChange(false)
                  setProblemaAberto(true)
                }}
              />
            </Secao>

            <div className="mt-3 px-2">
              <button
                type="button"
                onClick={() => {
                  onAbrirChange(false)
                  signOut()
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-destructive active:bg-destructive/10"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                  <LogOut className="h-5 w-5" />
                </span>
                <span className="text-[15px] font-medium">Sair da conta</span>
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <NotificationsDialog open={notifAberto} onOpenChange={setNotifAberto} />
      <ReleaseNotesDialog open={notasAberto} onOpenChange={setNotasAberto} />
      <ReportarProblemaDialog open={problemaAberto} onOpenChange={setProblemaAberto} />
    </>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {titulo}
      </p>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

function Linha({
  icone: Icone,
  titulo,
  descricao,
  onClick,
  mantemAberta,
}: {
  icone: React.ElementType
  titulo: string
  descricao: string
  onClick: () => void
  /** Ações que não navegam (tema) não mostram a seta de "vai para outra tela". */
  mantemAberta?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // `min-h-[56px]`: alvo de toque confortável. Abaixo disso o dedo erra.
      className="flex min-h-[56px] w-full items-center gap-3 rounded-xl px-4 py-2 text-left active:bg-accent"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent">
        <Icone className="h-5 w-5 text-foreground/80" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-foreground">{titulo}</span>
        <span className="block truncate text-xs text-muted-foreground">{descricao}</span>
      </span>
      {!mantemAberta && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />}
    </button>
  )
}
