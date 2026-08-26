import { useEffect, useState } from 'react'
import { Mail, Plus, Trash2, ShieldCheck, Users, User, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GlassCard } from '@/components/ui/surface'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { getAllEmailAccounts, updateEmailAccount } from '@/services/email_accounts'
import {
  getStatus,
  configurar,
  conectar,
  desconectar,
  type StatusDoEmail,
} from '@/services/email_microsoft'
import { listarSetores } from '@/services/setores'
import GerenciadorDeSetores from '@/components/email/GerenciadorDeSetores'
import type { EmailAccount } from '@/lib/supabase/email-types'

/** Valor do <Select> para "sem setor", já que Radix não aceita item de valor vazio. */
const SEM_SETOR = '__pessoal__'

/**
 * Conectar as caixas de e-mail da empresa (Microsoft 365).
 *
 * Três blocos, na ordem em que alguém precisa deles: configurar o aplicativo
 * (uma vez, admin), conectar a própria conta (todo mundo) e conectar as caixas
 * dos setores (admin).
 *
 * A lista não filtra nada no cliente: o que aparece é o que a RLS deixou passar
 * (migration 20260826124852) — conta pessoal só para o dono, caixa de setor para
 * quem está naquele setor em `user_sectors`.
 */
export default function EmailAccountSettings() {
  const { user } = useAuth()
  const { toast } = useToast()

  const [status, setStatus] = useState<StatusDoEmail>({ configurado: false, admin: false })
  const [contas, setContas] = useState<EmailAccount[]>([])
  const [setores, setSetores] = useState<string[]>([])
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)

  // Configuração da Microsoft
  const [trocandoChaves, setTrocandoChaves] = useState(false)
  const [clientId, setClientId] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  // Nova caixa de setor
  const [novoApelido, setNovoApelido] = useState('')
  const [novoSetor, setNovoSetor] = useState('')
  const [novoEmail, setNovoEmail] = useState('')

  const carregar = async () => {
    try {
      const [st, ac] = await Promise.all([getStatus(), getAllEmailAccounts()])
      setStatus(st)
      setContas(ac)
      setSetores((await listarSetores().catch(() => [])).map((s) => s.nome))
    } catch (err) {
      console.error(err)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  /*
    O retorno do consentimento acontece em OUTRA aba, na edge function — esta
    tela não é notificada de nada. Sem isso a pessoa conecta a caixa, volta, e a
    lista continua vazia, parecendo que falhou. Recarregar ao voltar o foco é o
    que fecha esse buraco.
  */
  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') carregar()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => document.removeEventListener('visibilitychange', aoVoltar)
  }, [])

  const erro = (titulo: string, e: unknown) =>
    toast({
      title: titulo,
      description: e instanceof Error ? e.message : undefined,
      variant: 'destructive',
    })

  const salvarChaves = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setSalvando(true)
    try {
      await configurar({
        client_id: clientId.trim(),
        tenant_id: tenantId.trim(),
        client_secret: clientSecret.trim(),
      })
      // Some da memória assim que sai daqui: não há motivo para o segredo
      // continuar no estado do React depois de gravado.
      setClientId('')
      setTenantId('')
      setClientSecret('')
      setTrocandoChaves(false)
      toast({ title: 'Microsoft configurada!' })
      await carregar()
    } catch (e) {
      erro('Não deu para salvar as chaves', e)
    } finally {
      setSalvando(false)
    }
  }

  const conectarMinhaConta = async () => {
    try {
      await conectar({ tipo: 'pessoal', label: 'Minha conta' })
      toast({
        title: 'Abrimos a Microsoft numa aba nova',
        description: 'Entre com a sua conta da empresa e volte para cá.',
      })
    } catch (e) {
      erro('Não deu para abrir o login da Microsoft', e)
    }
  }

  const conectarCaixaDoSetor = async (ev: React.FormEvent) => {
    ev.preventDefault()
    try {
      await conectar({
        tipo: 'setor',
        label: novoApelido.trim() || novoSetor,
        department: novoSetor,
        expected_email: novoEmail.trim(),
      })
      toast({
        title: 'Abrimos a Microsoft numa aba nova',
        description: `Entre com a senha de ${novoEmail.trim()} — não com a sua conta.`,
      })
      setNovoApelido('')
      setNovoEmail('')
    } catch (e) {
      erro('Não deu para abrir o login da Microsoft', e)
    }
  }

  const removerCaixa = async (conta: EmailAccount) => {
    const aviso = conta.department
      ? `Desconectar "${conta.label}"? O setor ${conta.department} perde o acesso a esses e-mails.`
      : `Desconectar "${conta.label}"?`
    if (!confirm(aviso)) return
    try {
      await desconectar(conta.id)
      toast({ title: 'Caixa desconectada' })
      await carregar()
    } catch (e) {
      erro('Não deu para desconectar', e)
    }
  }

  /*
    `getAllEmailAccounts()` devolve tudo o que a RLS deixou passar — e para
    administrador isso inclui a conta pessoal DAS OUTRAS PESSOAS. Filtrar só por
    `!department` fazia o admin ver o e-mail pessoal alheio dentro do bloco
    "Minha conta". Aqui a conta é minha se for minha mesmo.
  */
  const minhasContas = contas.filter((c) => !c.department && c.user_id === user?.id)
  const contasDeSetor = contas.filter((c) => c.department)
  /** Contas pessoais de outras pessoas — só um admin enxerga, e só para saber que existem. */
  const pessoaisDeOutros = contas.filter((c) => !c.department && c.user_id !== user?.id)

  const trocarSetor = async (conta: EmailAccount, setor: string) => {
    try {
      await updateEmailAccount(conta.id, { department: setor === SEM_SETOR ? null : setor })
      toast({
        title:
          setor === SEM_SETOR
            ? 'Caixa virou pessoal — só o dono vê agora'
            : `Caixa movida para ${setor}`,
      })
      await carregar()
    } catch (e) {
      erro('Não deu para trocar o setor', e)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Contas de Email</h2>
        <p className="text-muted-foreground mt-1">
          Conecte as caixas do Outlook da empresa. Caixa de setor todo o time vê; conta pessoal só
          você vê.
        </p>
      </div>

      {/* ——— 1. Configuração da Microsoft (admin) ——— */}
      {status.admin && (
        <GlassCard>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5" />
              Aplicativo da Microsoft
            </CardTitle>
          </CardHeader>
          <CardContent>
            {status.configurado && !trocandoChaves ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Configurado. As chaves ficam no servidor e não são exibidas aqui.
                </p>
                <Button variant="outline" size="sm" onClick={() => setTrocandoChaves(true)}>
                  Trocar chaves
                </Button>
              </div>
            ) : (
              <form onSubmit={salvarChaves} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Os três códigos do registro do aplicativo no Entra ID. Eles vão direto para o
                  servidor e nunca voltam para esta tela.
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ms-client-id">ID do aplicativo (cliente)</Label>
                    <Input
                      id="ms-client-id"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      placeholder="00000000-0000-0000-0000-000000000000"
                      autoComplete="off"
                      spellCheck={false}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ms-tenant-id">ID do diretório (locatário)</Label>
                    <Input
                      id="ms-tenant-id"
                      value={tenantId}
                      onChange={(e) => setTenantId(e.target.value)}
                      placeholder="ec5a76d5-4773-4c5f-ae34-e667576941ae"
                      autoComplete="off"
                      spellCheck={false}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ms-secret">Segredo do cliente — o Valor</Label>
                  {/* type=password e autoComplete=off: o segredo não deve ficar
                      visível na tela nem ser oferecido pelo navegador depois. */}
                  <Input
                    id="ms-secret"
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder="cole aqui a coluna Valor, não o ID do Segredo"
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={salvando}>
                    {salvando ? 'Salvando…' : 'Salvar'}
                  </Button>
                  {status.configurado && (
                    <Button type="button" variant="ghost" onClick={() => setTrocandoChaves(false)}>
                      Cancelar
                    </Button>
                  )}
                </div>
              </form>
            )}
          </CardContent>
        </GlassCard>
      )}

      {/* Sem as chaves, nada mais funciona — e quem não é admin não tem o que fazer. */}
      {!carregando && !status.configurado && (
        <GlassCard>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Mail className="h-8 w-8 text-muted-foreground" />
            <span className="text-lg font-medium">Microsoft ainda não configurada</span>
            <p className="max-w-md text-sm text-muted-foreground">
              {status.admin
                ? 'Preencha os três códigos do aplicativo acima para liberar a conexão das caixas.'
                : 'Quem administra o sistema precisa cadastrar o aplicativo da Microsoft antes de conectar as caixas.'}
            </p>
          </CardContent>
        </GlassCard>
      )}

      {status.configurado && (
        <>
          {/* ——— 2. Minha conta ——— */}
          <GlassCard>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <User className="h-5 w-5" />
                Minhas contas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {minhasContas.map((c) => (
                <LinhaDaConta key={c.id} conta={c} aoRemover={() => removerCaixa(c)} />
              ))}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {minhasContas.length === 0
                    ? 'Conecte o seu e-mail da empresa. Só você enxerga estas caixas.'
                    : 'Pode conectar mais de um endereço seu.'}
                </p>
                <Button onClick={conectarMinhaConta} variant={minhasContas.length ? 'outline' : 'default'}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {minhasContas.length === 0 ? 'Conectar minha conta' : 'Conectar outra conta minha'}
                </Button>
              </div>
            </CardContent>
          </GlassCard>

          {/* ——— 3. Caixas dos setores ——— */}
          <GlassCard>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5" />
                Caixas dos setores
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {status.admin && (
                <form onSubmit={conectarCaixaDoSetor} className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="caixa-email">Endereço da caixa</Label>
                      <Input
                        id="caixa-email"
                        type="email"
                        value={novoEmail}
                        onChange={(e) => setNovoEmail(e.target.value)}
                        placeholder="financeiro@prndiagnosticos.com.br"
                        autoComplete="off"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="caixa-setor">Setor</Label>
                      <Select value={novoSetor} onValueChange={setNovoSetor} required>
                        <SelectTrigger id="caixa-setor">
                          <SelectValue placeholder="Escolha o setor" />
                        </SelectTrigger>
                        <SelectContent>
                          {setores.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="caixa-apelido">Apelido (opcional)</Label>
                      <Input
                        id="caixa-apelido"
                        value={novoApelido}
                        onChange={(e) => setNovoApelido(e.target.value)}
                        placeholder="Financeiro PRN"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  {/* O erro mais caro deste fluxo tem aviso na tela E conferência
                      no servidor: o retorno recusa se entrar outra caixa. */}
                  <p className="text-sm text-amber-600 dark:text-amber-500">
                    Na tela da Microsoft, entre com a senha <strong>da caixa</strong> — não com a
                    sua conta. Se entrar com a sua, nada é conectado e avisamos o motivo.
                  </p>
                  <Button type="submit" disabled={!novoSetor || !novoEmail.trim()}>
                    <Plus className="mr-2 h-4 w-4" />
                    Conectar caixa do setor
                  </Button>
                </form>
              )}

              {contasDeSetor.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {status.admin
                    ? 'Nenhuma caixa de setor conectada ainda.'
                    : 'Nenhuma caixa do seu setor foi conectada ainda.'}
                </p>
              ) : (
                <div className="space-y-3">
                  {contasDeSetor.map((c) => (
                    <LinhaDaConta
                      key={c.id}
                      conta={c}
                      aoRemover={status.admin ? () => removerCaixa(c) : undefined}
                      setores={status.admin ? setores : undefined}
                      aoTrocarSetor={(s) => trocarSetor(c, s)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </GlassCard>

          {/* Contas pessoais alheias não entram no bloco "Minhas contas" — mas o
              admin precisa saber que existem, para não achar que sumiram nem
              tentar conectá-las de novo. Sem botão: não é caixa dele. */}
          {status.admin && pessoaisDeOutros.length > 0 && (
            <GlassCard>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <User className="h-5 w-5" />
                  Contas pessoais da equipe
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Conectadas pelas próprias pessoas. Você vê que existem, mas não os e-mails
                  delas.
                </p>
                {pessoaisDeOutros.map((c) => (
                  <LinhaDaConta key={c.id} conta={c} />
                ))}
              </CardContent>
            </GlassCard>
          )}

          {status.admin && <GerenciadorDeSetores aoMudar={carregar} />}
        </>
      )}
    </div>
  )
}

function LinhaDaConta({
  conta,
  aoRemover,
  setores,
  aoTrocarSetor,
}: {
  conta: EmailAccount
  aoRemover?: () => void
  /** Passar a lista habilita a troca de setor na própria linha (só admin). */
  setores?: string[]
  aoTrocarSetor?: (setor: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{conta.label}</span>
          {/* Sem o seletor, o setor continua visível como etiqueta. */}
          {!setores &&
            (conta.department ? (
              <Badge variant="secondary">{conta.department}</Badge>
            ) : (
              <Badge variant="outline">Pessoal</Badge>
            ))}
          {!conta.is_active && <Badge variant="destructive">Inativa</Badge>}
        </div>
        <p className="truncate text-sm text-muted-foreground">{conta.email}</p>
      </div>

      <div className="flex items-center gap-2">
        {/* Trocar o setor aqui evita desconectar e reconectar a caixa só para
            corrigir a lotação — e reconectar exige a senha dela de novo. */}
        {setores && aoTrocarSetor && (
          <Select value={conta.department ?? SEM_SETOR} onValueChange={aoTrocarSetor}>
            <SelectTrigger className="w-[190px]" aria-label="Setor da caixa">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {setores.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
              <SelectItem value={SEM_SETOR}>Sem setor (pessoal)</SelectItem>
            </SelectContent>
          </Select>
        )}
        {aoRemover && (
          <Button variant="ghost" size="icon" onClick={aoRemover} aria-label="Desconectar caixa">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
