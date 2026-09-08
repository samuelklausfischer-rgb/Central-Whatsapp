import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check, ExternalLink, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { GlassDialogContent } from '@/components/ui/glass-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/use-auth'
import { getEmailPrefs, salvarEmailPrefs } from '@/services/email_prefs'
import {
  getEmailTemplates,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
} from '@/services/email_templates'
import { sanitizarAssinatura } from '@/lib/email/sanitizar-assinatura'
import { extrairImagensEmbutidas, paraPrevia } from '@/lib/email/assinatura-embutida'
import type { EmailTemplate } from '@/lib/supabase/email-types'

/**
 * "Meus ajustes" — o que é DE CADA PESSOA no Email Hub.
 *
 * Mora aqui dentro, e não em Configurações, porque é ajuste que se mexe no meio
 * do trabalho: você percebe que a assinatura está errada respondendo um e-mail,
 * não navegando pelo menu do perfil.
 *
 * O que NÃO entra: conectar caixa, chaves do aplicativo da Microsoft, setores.
 * Isso é administrativo e continua em `settings/EmailAccountSettings`.
 */
export function MeusAjustesDialog({
  aberto,
  onOpenChange,
}: {
  aberto: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { user } = useAuth()
  const { toast } = useToast()

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <GlassDialogContent className="sm:max-w-2xl gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-0 border-b border-border/60 px-5 py-4">
          <DialogTitle className="text-[15px] leading-tight">Meus ajustes</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Valem só para você, em todas as caixas que você usa
          </p>
        </DialogHeader>

        <Tabs defaultValue="assinatura" className="flex min-h-0 flex-col">
          <div className="px-5 pt-3">
            <TabsList className="h-8">
              <TabsTrigger value="assinatura" className="text-xs">
                Assinatura
              </TabsTrigger>
              <TabsTrigger value="frases" className="text-xs">
                Frases prontas
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="assinatura" className="m-0 min-h-0">
            <AbaAssinatura userId={user?.id ?? null} aberto={aberto} toast={toast} />
          </TabsContent>

          <TabsContent value="frases" className="m-0 min-h-0">
            <AbaFrases userId={user?.id ?? null} aberto={aberto} toast={toast} />
          </TabsContent>
        </Tabs>
      </GlassDialogContent>
    </Dialog>
  )
}

type Avisar = ReturnType<typeof useToast>['toast']

// ——— Assinatura ———

function AbaAssinatura({
  userId,
  aberto,
  toast,
}: {
  userId: string | null
  aberto: boolean
  toast: Avisar
}) {
  const editor = useRef<HTMLDivElement>(null)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [avisos, setAvisos] = useState<string[]>([])
  const [temAlgo, setTemAlgo] = useState(false)
  const [origem, setOrigem] = useState<'gerador' | 'colada' | null>(null)
  /**
   * O HTML que veio do banco, esperando o editor existir.
   *
   * NÃO dá para escrever direto no `ref` dentro do `.then()` da busca: enquanto
   * `carregando` é `true`, o `contentEditable` nem está montado, então
   * `editor.current` é `null` e a atribuição era descartada em silêncio pelo
   * `if`. Era exatamente isto que fazia a assinatura salva pelo gerador não
   * aparecer aqui — o dado estava certo no banco o tempo todo.
   */
  const [htmlCarregado, setHtmlCarregado] = useState<string | null>(null)

  useEffect(() => {
    if (htmlCarregado === null || !editor.current) return
    editor.current.innerHTML = htmlCarregado
    setTemAlgo(Boolean(htmlCarregado.trim()))
  }, [htmlCarregado])

  useEffect(() => {
    if (!aberto || !userId) return
    let vivo = true
    setCarregando(true)
    setHtmlCarregado(null)
    getEmailPrefs(userId)
      .then((p) => {
        if (!vivo) return
        // O editor mostra com `data:`; o que está guardado usa `cid:`, que não
        // renderiza fora de um e-mail.
        setHtmlCarregado(paraPrevia(p.assinatura_html ?? '', p.assinatura_imagens))
        setOrigem(p.assinatura_origem ?? null)
        setAvisos([])
      })
      .catch(() => {
        if (vivo) toast({ title: 'Não consegui carregar sua assinatura', variant: 'destructive' })
      })
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [aberto, userId, toast])

  /**
   * A limpeza acontece NA COLAGEM, não só no salvar.
   *
   * Deixar o HTML cru do Word entrar no editor bagunçaria a nossa própria tela
   * — o `<style>` dele vaza para fora do elemento, porque aqui não há iframe
   * isolando nada. Limpar na entrada também deixa a pessoa VER na hora o que
   * sobreviveu, em vez de descobrir depois de salvar.
   */
  const aoColar = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const cru = e.clipboardData.getData('text/html') || e.clipboardData.getData('text/plain')
    const { html, avisos: novos } = sanitizarAssinatura(cru)
    // `insertHTML` mantém o cursor e o desfazer do navegador funcionando; trocar
    // o `innerHTML` na mão apagaria o histórico de edição.
    document.execCommand('insertHTML', false, html)
    setAvisos(novos)
    setTemAlgo(Boolean(editor.current?.innerHTML.trim()))
  }, [])

  async function salvar() {
    if (!userId) return
    setSalvando(true)
    try {
      // Limpa DE NOVO no salvar. A colagem já limpa, mas nada impede alguém de
      // digitar direto ou de o navegador injetar marcação própria ao editar.
      const { html: limpo, avisos: novos } = sanitizarAssinatura(editor.current?.innerHTML ?? '')
      // Mesmo tratamento da assinatura gerada: as imagens saem do corpo e viram
      // anexo embutido. Sem isto, uma assinatura colada com logotipo chegaria
      // sem o logotipo no Gmail e no Outlook de mesa.
      const { html, imagens } = extrairImagensEmbutidas(limpo)
      await salvarEmailPrefs(userId, {
        assinatura_html: html,
        assinatura_imagens: imagens,
        assinatura_origem: 'colada',
      })
      setHtmlCarregado(limpo)
      if (editor.current) editor.current.innerHTML = limpo
      setAvisos(novos)
      setOrigem('colada')
      setTemAlgo(Boolean(html))
      toast({ title: 'Assinatura salva', description: 'Ela vai junto nos próximos envios.' })
    } catch (err) {
      toast({
        title: 'Não consegui salvar',
        description: err instanceof Error ? err.message : 'Tente novamente',
        variant: 'destructive',
      })
    } finally {
      setSalvando(false)
    }
  }

  async function limpar() {
    if (!userId) return
    if (!window.confirm('Apagar sua assinatura? Os próximos e-mails sairão sem ela.')) return
    setSalvando(true)
    try {
      await salvarEmailPrefs(userId, {
        assinatura_html: '',
        assinatura_imagens: [],
        assinatura_origem: undefined,
      })
      setHtmlCarregado('')
      if (editor.current) editor.current.innerHTML = ''
      setAvisos([])
      setOrigem(null)
      setTemAlgo(false)
      toast({ title: 'Assinatura apagada' })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="flex flex-col">
      <div className="max-h-[55vh] overflow-y-auto px-5 py-4">
        {/*
          O gerador é o caminho principal, e a colagem virou a reserva.

          Quem gera em Assinaturas sai com a marca certa e sem trabalho; colar é
          para quem tem uma assinatura fora do padrão da PRN. O atalho abaixo não
          precisa de gate: a ferramenta não tem guarda de permissão nenhuma
          (`App.tsx` diz, com todas as letras, que todo mundo precisa gerar a sua).
        */}
        <div className="mb-3 flex items-start gap-3 rounded-2xl border border-border/60 bg-foreground/[0.03] p-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground">
              Gere a sua no padrão da empresa
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              A ferramenta Assinaturas monta com a marca, o telefone e o cargo — e um botão
              lá dentro já a traz para cá.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild className="flex-shrink-0">
            <Link to="/ferramentas/assinaturas">
              Abrir
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>

        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          {origem === 'gerador'
            ? 'Esta assinatura veio da ferramenta Assinaturas. Você pode editá-la aqui, ou gerar de novo por lá.'
            : 'Ou cole aqui a assinatura que você já usa no Outlook — a formatação vem junto.'}{' '}
          Ela vale em <strong>qualquer caixa</strong> que você responder, a sua e as
          compartilhadas.
        </p>

        {/*
          O editor é montado SEMPRE, e o "carregando" vira sobreposição.

          Trocar um pelo outro parece inofensivo e não é: com o editor fora da
          árvore, o `ref` fica nulo justamente no instante em que a resposta do
          banco chega, e o conteúdo é perdido sem nenhum erro.
        */}
        <div className="relative">
          <div
            ref={editor}
            contentEditable={!carregando}
            onPaste={aoColar}
            onInput={() => setTemAlgo(Boolean(editor.current?.innerHTML.trim()))}
            role="textbox"
            aria-multiline="true"
            aria-busy={carregando}
            aria-label="Sua assinatura"
            // Fundo branco fixo, como o corpo do e-mail no leitor: a assinatura
            // foi escrita para fundo claro e some no tema escuro se herdar o nosso.
            // Rolagem na horizontal em vez de `max-w-full` nas imagens.
            //
            // `max-width:100%` encolhe a LARGURA da imagem enquanto a altura fica
            // travada no `style` inline da assinatura — em 460px de espaço o painel
            // da marca ia de 218x186 para 140x186 e os ícones sumiam. Rolar mostra a
            // assinatura como ela é; achatar mostra uma que não existe.
            className="min-h-[180px] overflow-x-auto rounded-2xl border border-border/60 bg-white p-4 text-sm text-neutral-900 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 [&_a]:text-blue-700 [&_a]:underline"
          />
          {carregando && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-2xl bg-white/80 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando...
            </div>
          )}
        </div>

        {!carregando && !temAlgo && (
          <p className="mt-2 text-xs text-muted-foreground/70">
            Vazio: seus e-mails sairão sem assinatura.
          </p>
        )}

        {avisos.map((a) => (
          <p
            key={a}
            className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            {a}
          </p>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/60 px-5 py-3.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={limpar}
          disabled={salvando || carregando || !temAlgo}
          className="text-muted-foreground hover:text-destructive"
        >
          Apagar
        </Button>
        <Button onClick={salvar} disabled={salvando || carregando} size="sm" className="gap-1.5 px-4">
          {salvando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Salvar
        </Button>
      </div>
    </div>
  )
}

// ——— Frases prontas ———

/**
 * As frases prontas já existiam inteiras no banco e no serviço — `create`,
 * `update` e `delete` estavam escritos e **sem um único chamador**. O seletor no
 * compositor também já existia, escondido atrás de `templates.length > 0`, então
 * nunca aparecia. Esta aba é a peça que faltava.
 */
function AbaFrases({
  userId,
  aberto,
  toast,
}: {
  userId: string | null
  aberto: boolean
  toast: Avisar
}) {
  const [lista, setLista] = useState<EmailTemplate[]>([])
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState<EmailTemplate | 'nova' | null>(null)
  const [titulo, setTitulo] = useState('')
  const [assunto, setAssunto] = useState('')
  const [corpo, setCorpo] = useState('')
  const [salvando, setSalvando] = useState(false)

  const recarregar = useCallback(() => {
    setCarregando(true)
    getEmailTemplates()
      .then(setLista)
      .catch(() => toast({ title: 'Não consegui carregar as frases', variant: 'destructive' }))
      .finally(() => setCarregando(false))
  }, [toast])

  useEffect(() => {
    if (aberto) recarregar()
  }, [aberto, recarregar])

  function abrirNova() {
    setEditando('nova')
    setTitulo('')
    setAssunto('')
    setCorpo('')
  }

  function abrirExistente(t: EmailTemplate) {
    setEditando(t)
    setTitulo(t.title)
    setAssunto(t.subject_template ?? '')
    setCorpo(t.body_html)
  }

  async function salvar() {
    if (!userId || !titulo.trim() || !corpo.trim()) {
      toast({ title: 'Dê um nome e escreva a frase', variant: 'destructive' })
      return
    }
    setSalvando(true)
    try {
      if (editando === 'nova') {
        await createEmailTemplate({
          user_id: userId,
          title: titulo.trim(),
          subject_template: assunto.trim() || null,
          body_html: corpo,
          variables: null,
          category: null,
          // Compartilhar com a equipe fica de fora por ora: a policy de INSERT
          // não impede marcar `is_global`, então quem segura isso é a tela — e
          // um "vale para todos" merece decisão consciente, não um interruptor
          // solto no meio de um formulário pessoal.
          is_global: false,
          is_active: true,
        } as Omit<EmailTemplate, 'id' | 'created_at' | 'updated_at'>)
      } else if (editando) {
        await updateEmailTemplate(editando.id, {
          title: titulo.trim(),
          subject_template: assunto.trim() || null,
          body_html: corpo,
        })
      }
      setEditando(null)
      recarregar()
      toast({ title: 'Frase salva' })
    } catch (err) {
      toast({
        title: 'Não consegui salvar',
        description: err instanceof Error ? err.message : 'Tente novamente',
        variant: 'destructive',
      })
    } finally {
      setSalvando(false)
    }
  }

  async function apagar(t: EmailTemplate) {
    if (!window.confirm(`Apagar a frase "${t.title}"?`)) return
    try {
      await deleteEmailTemplate(t.id)
      recarregar()
    } catch {
      toast({ title: 'Não consegui apagar', variant: 'destructive' })
    }
  }

  if (editando) {
    return (
      <div className="flex flex-col">
        <div className="max-h-[55vh] space-y-3 overflow-y-auto px-5 py-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Nome</Label>
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Como você vai encontrar esta frase"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Assunto (opcional)</Label>
            <Input
              value={assunto}
              onChange={(e) => setAssunto(e.target.value)}
              placeholder="Preenche o assunto ao aplicar"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Texto</Label>
            <Textarea
              value={corpo}
              onChange={(e) => setCorpo(e.target.value)}
              placeholder="O que você repete todo dia"
              className="min-h-[160px] resize-none text-sm"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-3.5">
          <Button variant="ghost" size="sm" onClick={() => setEditando(null)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando} size="sm" className="gap-1.5 px-4">
            {salvando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Salvar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="max-h-[55vh] overflow-y-auto px-5 py-4">
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Respostas que você repete o dia todo, salvas para usar em um clique. Elas aparecem
          no menu <strong>Modelo</strong> quando você escreve um e-mail.
        </p>

        {carregando ? (
          <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : lista.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma frase ainda</p>
            <p className="text-xs text-muted-foreground/70">
              Crie a primeira e ela aparece na hora de escrever
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {lista.map((t) => {
              const minha = t.user_id === userId
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-foreground/[0.03]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t.body_html.replace(/<[^>]*>/g, ' ').slice(0, 90) || 'sem texto'}
                    </p>
                  </div>
                  {/* Frase compartilhada por outra pessoa aparece, mas não se
                      edita: a policy do banco recusaria, e um botão que só
                      produz erro é pior que botão nenhum. */}
                  {minha ? (
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        onClick={() => abrirExistente(t)}
                        aria-label={`Editar ${t.title}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => apagar(t)}
                        aria-label={`Apagar ${t.title}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <span className="flex-shrink-0 rounded-lg bg-foreground/5 px-2 py-0.5 text-[10px] text-muted-foreground">
                      da equipe
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end border-t border-border/60 px-5 py-3.5">
        <Button onClick={abrirNova} size="sm" className="gap-1.5 px-4">
          <Plus className="h-3.5 w-3.5" />
          Nova frase
        </Button>
      </div>
    </div>
  )
}
