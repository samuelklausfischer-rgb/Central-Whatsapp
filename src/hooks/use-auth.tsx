import { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo, ReactNode } from 'react'
import supabase from '@/lib/supabase/client'
import { clearAllDrafts } from '@/stores/conversationDrafts'
import { clearDeviceSnapshots } from '@/stores/conversationSummaries'
import { limparConversas } from '@/stores/conversationMessages'
import { limparFerramentas } from '@/stores/ferramentasVivas'
import type { Profile, Device } from '@/lib/supabase/types'

interface AuthContextType {
  user: (Profile & { email: string }) | null
  isAuthenticated: boolean
  signUp: (email: string, password: string, data?: Record<string, string>) => Promise<{ error: any }>
  signIn: (email: string, password: string) => Promise<{ error: any }>
  signOut: () => void
  loading: boolean
  refreshProfile: () => Promise<void>
  allowedDeviceIds: string[]
  allowedDevices: Device[]
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}

/**
 * Compara duas listas de dispositivos pelos `id`, na ordem — não pelo conteúdo
 * completo do objeto.
 *
 * `loadUserData` roda de novo a cada TOKEN_REFRESHED (o Supabase renova o token
 * em segundo plano ao recuperar foco/visibilidade) e SEMPRE devolve um array
 * novo, mesmo quando os dispositivos permitidos não mudaram nada. Sem este
 * guard, `setAllowedDevices`/`setAllowedDeviceIds` trocavam de referência a
 * cada renovação — e todo consumidor de `allowedDevices` (o efeito de seleção
 * de aparelho do ChatHub, por exemplo) reexecutava achando que havia uma
 * mudança real para reagir. Devolver a MESMA referência quando o conteúdo é
 * idêntico corta esse churn na fonte, para todos os consumidores de uma vez.
 */
function mesmosDispositivos(a: Device[], b: Device[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false
  }
  return true
}

function mesmosIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

async function fetchProfile(userId: string): Promise<(Profile & { email: string }) | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error || !data) return null
  return data as Profile & { email: string }
}

async function fetchAllowedDevices(userId: string): Promise<Device[]> {
  // Antes eram 2 round trips sequenciais (user_allowed_devices, depois devices).
  // Colapsado em 1 única request via embed do PostgREST, usando a FK
  // user_allowed_devices.device_id -> devices.id (mesmo padrão já usado em
  // src/services/emails.ts com `label_id, labels(...)`).
  const { data, error } = await supabase
    .from('user_allowed_devices')
    .select('device_id, devices(*)')
    .eq('user_id', userId)

  if (!error && data) {
    return (data as unknown as { devices: Device | null }[])
      .map((row) => row.devices)
      .filter((d): d is Device => d != null)
  }

  // O embed depende da FK estar no schema cache do PostgREST. Se não estiver, o
  // usuário restrito ficaria sem nenhum dispositivo — ou seja, trancado fora do app.
  // Por isso caímos no caminho antigo (2 round trips) em vez de devolver lista vazia.
  return await fetchAllowedDevicesLegacy(userId)
}

async function fetchAllowedDevicesLegacy(userId: string): Promise<Device[]> {
  const { data: allowed, error } = await supabase
    .from('user_allowed_devices')
    .select('device_id')
    .eq('user_id', userId)
  if (error || !allowed?.length) return []

  const deviceIds = allowed.map((row) => row.device_id)
  const { data: devices } = await supabase.from('devices').select('*').in('id', deviceIds)
  return (devices as Device[]) || []
}

async function loadUserData(
  session: { user: { id: string; email?: string | null } },
  signal: { aborted: boolean },
) {
  const profile = await fetchProfile(session.user.id)
  if (!profile || signal.aborted) return null

  const mergedUser = { ...profile, email: session.user.email || profile.email || '' }
  let deviceList: Device[] = []
  let deviceIdList: string[] = []

  const hasAllDevices = profile.is_super_admin || (profile.is_admin && !profile.devices_restricted)
  if (hasAllDevices) {
    const { data: allDevices } = await supabase.from('devices').select('*')
    if (!signal.aborted) {
      deviceList = (allDevices as Device[]) || []
      deviceIdList = deviceList.map((d) => d.id)
    }
  } else {
    const devices = await fetchAllowedDevices(session.user.id)
    if (!signal.aborted) {
      deviceList = devices
      deviceIdList = devices.map((d) => d.id)
    }
  }

  if (signal.aborted) return null
  return { user: mergedUser, devices: deviceList, deviceIds: deviceIdList }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<(Profile & { email: string }) | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [allowedDeviceIds, setAllowedDeviceIds] = useState<string[]>([])
  const [allowedDevices, setAllowedDevices] = useState<Device[]>([])

  // Only show the loading spinner on the very first auth check.
  // Subsequent token refreshes (TOKEN_REFRESHED, SIGNED_IN on reconnect) should
  // update data silently — setting loading=true would unmount the whole app tree
  // and reset all in-memory state (selected conversation, device, etc.).
  const isInitialAuthRef = useRef(true)

  useEffect(() => {
    let mounted = true
    const signal = { get aborted() { return !mounted } }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      if (session?.user) {
        if (isInitialAuthRef.current) {
          setLoading(true)
        }
        // Defer async work outside the callback to prevent Supabase auth deadlock
        setTimeout(async () => {
          if (!mounted) return
          try {
            const result = await loadUserData(session, signal)
            if (!result || !mounted) return
            setUser(result.user)
            setIsAuthenticated(true)
            // Forma funcional + comparação rasa: preserva a referência antiga
            // quando o conteúdo é igual, para não disparar de novo todo efeito
            // que depende de `allowedDevices` a cada renovação de token
            // (ver `mesmosDispositivos` acima).
            setAllowedDevices((prev) => (mesmosDispositivos(prev, result.devices) ? prev : result.devices))
            setAllowedDeviceIds((prev) => (mesmosIds(prev, result.deviceIds) ? prev : result.deviceIds))
          } catch {
            if (!mounted) return
            setUser(null)
            setIsAuthenticated(false)
            setAllowedDeviceIds([])
            setAllowedDevices([])
          } finally {
            if (mounted) {
              setLoading(false)
              isInitialAuthRef.current = false
            }
          }
        }, 0)
      } else {
        setUser(null)
        setIsAuthenticated(false)
        setAllowedDeviceIds([])
        setAllowedDevices([])
        setLoading(false)
        isInitialAuthRef.current = true
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  /**
   * Confere a SESSÃO ao voltar para a aba.
   *
   * O `onAuthStateChange` acima só percebe que a sessão morreu quando o
   * supabase-js tenta renovar o token — e ele só tenta perto do vencimento. Com
   * token de 1 hora, isso abre uma janela de até ~55 minutos em que o app se acha
   * logado e o servidor já rejeita: metade das telas funciona (o PostgREST valida
   * só assinatura e validade do JWT) e a outra metade dá 401 (as edge functions
   * consultam a sessão). Foi assim em 14/08/2026 — a aba ficou aberta durante um
   * logout feito em outro lugar.
   *
   * A aba esquecida é exatamente onde isso morde, então a hora de conferir é
   * quando alguém volta para ela. `getUser()` vai ao servidor e valida a sessão
   * de verdade — diferente de `getSession()`, que só lê o que está guardado
   * localmente e responderia "logado" mesmo com a sessão destruída.
   *
   * SÓ DESLOGA COM RECUSA EXPLÍCITA do servidor (401/403). Queda de rede, Wi-Fi
   * oscilando ou servidor fora do ar também fazem `getUser()` falhar, e expulsar
   * o atendente nesses casos seria muito pior que o problema original.
   */
  useEffect(() => {
    let verificando = false

    const verificarSessao = async () => {
      if (verificando || document.visibilityState !== 'visible') return

      // Sem sessão local não há o que conferir: quem cuida disso é o login.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      verificando = true
      try {
        const { error } = await supabase.auth.getUser()
        const status = (error as { status?: number } | null)?.status
        if (status === 401 || status === 403) {
          // Dispara o `onAuthStateChange` acima, que leva à tela de login.
          await supabase.auth.signOut({ scope: 'local' })
        }
      } catch {
        /* rede fora — mantém a sessão, tenta de novo no próximo foco */
      } finally {
        verificando = false
      }
    }

    window.addEventListener('focus', verificarSessao)
    document.addEventListener('visibilitychange', verificarSessao)
    return () => {
      window.removeEventListener('focus', verificarSessao)
      document.removeEventListener('visibilitychange', verificarSessao)
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      setUser(null)
      setIsAuthenticated(false)
      setAllowedDeviceIds([])
      setAllowedDevices([])
      setLoading(false)
      return
    }

    setLoading(true)
    let mounted = true
    const signal = { get aborted() { return !mounted } }

    try {
      const result = await loadUserData(session, signal)
      if (!result || !mounted) return
      setUser(result.user)
      setIsAuthenticated(true)
      // Mesmo guard do onAuthStateChange acima — ver `mesmosDispositivos`.
      setAllowedDevices((prev) => (mesmosDispositivos(prev, result.devices) ? prev : result.devices))
      setAllowedDeviceIds((prev) => (mesmosIds(prev, result.deviceIds) ? prev : result.deviceIds))
    } catch {
      if (!mounted) return
      setUser(null)
      setIsAuthenticated(false)
      setAllowedDeviceIds([])
      setAllowedDevices([])
    } finally {
      if (mounted) setLoading(false)
    }
  }, [])

  const signUp = useCallback(async (email: string, password: string, data?: Record<string, string>) => {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data },
      })
      return { error: error || null }
    } catch (error) {
      return { error }
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return { error: error || null }
    } catch (error) {
      return { error }
    }
  }, [])

  const signOut = useCallback(() => {
    // Só no logout EXPLÍCITO. De propósito não fica no ramo "sem sessão" do
    // onAuthStateChange: aquele também dispara em falha de refresh de token, e
    // apagaria o que o atendente escreveu sem que ele tenha pedido para sair.
    clearAllDrafts()
    // Os caches em memória guardam prévia e CORPO de mensagem — não podem
    // sobreviver para o próximo atendente que logar na mesma máquina. O store de
    // conversas é escopo de módulo (o cache antigo era um ref que morria com a
    // desmontagem), então precisa ser limpo explicitamente.
    clearDeviceSnapshots()
    limparConversas()
    // Ferramenta aberta fica montada de propósito ao trocar de tela — mas isso
    // vale para a SESSÃO. Sem isto, o próximo a logar na mesma máquina herdaria
    // a Análise PRN preenchida, e os iframes seguiriam autenticados como o
    // atendente anterior.
    limparFerramentas()
    /**
     * ESCOPO LOCAL — sair aqui não pode derrubar as outras máquinas.
     *
     * `signOut()` sem argumento usa escopo **global** no supabase-js v2: revoga
     * TODAS as sessões daquela conta, em todos os aparelhos. Isso nunca foi a
     * intenção — todo o resto desta função fala em proteger "o próximo atendente
     * na mesma máquina", que é um problema local.
     *
     * O efeito era real e recorrente: em 14/08/2026 havia contas com 8 sessões
     * simultâneas (`suportelaudos3`, `flaviani`), e um único "Sair" as derrubava
     * todas. Quem estava do outro lado não recebia aviso nenhum: seguia com um
     * token válido por até 1 hora, o chat continuava funcionando (o PostgREST só
     * confere assinatura e validade do JWT) e só as telas que passam por edge
     * function quebravam, com "Invalid session". Meia quebra, impossível de
     * reconhecer como problema de sessão.
     *
     * Contrapartida assumida: aparelho perdido continua logado até alguém revogar
     * a sessão no banco. O botão Sair deixou de ser um "sair de todos".
     */
    supabase.auth.signOut({ scope: 'local' })
  }, [])

  const value = useMemo(() => ({
    user,
    isAuthenticated,
    signUp,
    signIn,
    signOut,
    loading,
    refreshProfile,
    allowedDeviceIds,
    allowedDevices,
  }), [user, isAuthenticated, signUp, signIn, signOut, loading, refreshProfile, allowedDeviceIds, allowedDevices])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
