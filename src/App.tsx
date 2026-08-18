import { lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { BrowserRouter, HashRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { isNativeAndroid } from '@/lib/app-info'
import { AuthShell } from '@/components/auth/AuthShell'
import { GlassPanel } from '@/components/ui/glass-panel'

/**
 * `HashRouter` onde NÃO existe servidor para resolver rotas.
 *
 * No Electron o app vem de arquivo local; no APK, de um servidor embutido que só
 * conhece `index.html`. Nos dois casos uma URL como `/dashboard` não é
 * resolvível: basta o WebView recarregar (o Android recria a Activity ao girar a
 * tela, ao mudar o tema do sistema ou ao retomar depois de liberar memória) para
 * o app voltar num caminho que não existe. Pior: com `--base ./`, os assets
 * passariam a ser procurados em `/dashboard/assets/...`. Tela preta, sem erro.
 *
 * A checagem do Android vem do Capacitor, e não do userAgent, porque o WebView
 * se identifica como Chrome comum — não há marca própria para procurar.
 */
const isElectron = window.navigator.userAgent.includes('Electron')
const Router = isElectron || isNativeAndroid() ? HashRouter : BrowserRouter
import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import Layout from './components/Layout'
import { AppProvider } from './stores/useAppStore'
import SettingsLayout from './pages/settings/SettingsLayout'
import Login from './pages/Login'
import { AuthProvider, useAuth } from './hooks/use-auth'
import { ToolAccessProvider, useToolAccess } from './hooks/use-tool-access'
// As ferramentas em si são carregadas pelo `ToolHost` (mesmo `import()`, então o
// Vite não duplica o pedaço) — a rota abaixo só registra qual está ativa.
import { FerramentaHospedada } from './components/tools/FerramentaHospedada'
import { UpdateGate } from './components/UpdateGate'
import { ErrorBoundary } from './components/ErrorBoundary'
import { canAccessFinanceiroTools } from './lib/permissions'

const Index = lazy(() => import('./pages/Index'))
const ChatHub = lazy(() => import('./pages/ChatHub'))
const EmailHub = lazy(() => import('./pages/EmailHub'))
const EmailAccountSettings = lazy(() => import('./pages/settings/EmailAccountSettings'))
const CRM = lazy(() => import('./pages/CRM'))
const Notes = lazy(() => import('./pages/Notes'))
const Triggers = lazy(() => import('./pages/Triggers'))
const ScheduledMessages = lazy(() => import('./pages/ScheduledMessages'))
const NotFound = lazy(() => import('./pages/NotFound'))
const GeneralSettings = lazy(() => import('./pages/settings/GeneralSettings'))
const LabelsSettings = lazy(() => import('./pages/settings/LabelsSettings'))
const AiAssistantSettings = lazy(() => import('./pages/settings/AiAssistantSettings'))
const InstancesSettings = lazy(() => import('./pages/settings/InstancesSettings'))
const AdminPage = lazy(() => import('./pages/admin/AdminPage'))
// Harness de dev para os estados do UpdatePanel que `main.cjs:53` nunca produz
// fora de dev real (downloading/ready exigem update de verdade). `import.meta.env.DEV`
// vira a constante `false` no build de produção e o branch morto some antes do
// bundle ser gerado — por isso o `lazy(() => import(...))` real do harness nunca
// chega a virar chunk no pacote publicado para a frota.
const SplashPreview = import.meta.env.DEV ? lazy(() => import('./pages/dev/SplashPreview')) : null

const ProtectedRoute = () => {
  const { isAuthenticated, loading } = useAuth()
  // Boot-level: só acontece uma vez por abertura do app, enquanto a sessão do
  // Supabase resolve. Usa a mesma moldura do splash de update e do login
  // (AuthShell + GlassPanel), então quem já está logado vê uma sequência
  // visualmente contínua: splash -> "Entrando…" -> dashboard, sempre na mesma
  // arte de fundo sorteada na abertura.
  if (loading)
    return (
      <AuthShell>
        <GlassPanel className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Entrando…</span>
        </GlassPanel>
      </AuthShell>
    )
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />
}

const AdminRoute = () => {
  const { user } = useAuth()
  return user?.is_admin ? <Outlet /> : <Navigate to="/dashboard" replace />
}

// Mais restrito que AdminRoute de propósito: `is_admin` não considera
// `devices_restricted`, então admins com acesso deliberadamente limitado ainda
// leriam a atividade da equipe inteira pelo Relatório App.
const SuperAdminRoute = () => {
  const { user } = useAuth()
  return user?.is_super_admin ? <Outlet /> : <Navigate to="/dashboard" replace />
}

const FinanceiroToolRoute = () => {
  const { user } = useAuth()
  return canAccessFinanceiroTools(user) ? <Outlet /> : <Navigate to="/dashboard" replace />
}

// A liberação das ferramentas externas vem do banco, não do perfil já carregado.
// Enquanto ela não chega, esperar: redirecionar no `false` inicial jogaria para
// o dashboard todo mundo que abre a rota direto (link salvo, F5 na própria tela).
const ExternalToolRoute = ({ tool }: { tool: 'relatorios' | 'licitacoes' | 'propostaComercial' }) => {
  const access = useToolAccess()
  if (access.loading)
    return (
      <div className="h-full w-full flex items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    )
  return access[tool] ? <Outlet /> : <Navigate to="/dashboard" replace />
}

const App = () => {
  const appContent = (
    <AuthProvider>
        <ToolAccessProvider>
        <AppProvider>
          <TooltipProvider>
          <Toaster />
          <Sonner />
          <Suspense
            fallback={
              // Neutro de propósito: este fallback dispara tanto no boot quanto a
              // cada navegação in-app entre páginas com lazy() (ex.: dashboard ->
              // /crm), então NÃO pode usar AuthShell — uma foto de praia tropical
              // apareceria no meio da sessão só porque o usuário trocou de tela.
              // Só o ProtectedRoute, acima, é boot-level de verdade.
              <div className="h-screen w-full flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            }
          >
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* Pública e fora do ProtectedRoute de propósito: é justamente a tela de
                ANTES do login que precisa ser testada, e só existe fora de produção. */}
            {import.meta.env.DEV && SplashPreview && (
              <Route path="/dev/splash" element={<SplashPreview />} />
            )}
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Index />} />
                <Route path="/chat" element={<ChatHub />} />
                <Route path="/email" element={<EmailHub />} />
                <Route path="/crm" element={<CRM />} />
                <Route path="/notes" element={<Notes />} />
                <Route path="/triggers" element={<Triggers />} />
                <Route path="/scheduled-messages" element={<ScheduledMessages />} />
                <Route element={<AdminRoute />}>
                  <Route path="/admin" element={<AdminPage />} />
                </Route>
                {/*
                  As ferramentas não são mais desenhadas pela rota: quem desenha é
                  o `ToolHost`, dentro do Layout, que não desmonta ao trocar de
                  tela. A rota virou registrador, então ir ao WhatsApp e voltar
                  não recomeça o trabalho do zero — e nas duas embutidas por
                  iframe, não pede login de novo.

                  As guardas ficam onde estavam: quem não tem permissão nem chega
                  a montar o registrador, logo a ferramenta nunca abre.
                */}
                <Route element={<FinanceiroToolRoute />}>
                  <Route path="/ferramentas/analise-prn" element={<FerramentaHospedada slug="analise-prn" />} />
                  <Route path="/ferramentas/rateio-mobilemed" element={<FerramentaHospedada slug="rateio-mobilemed" />} />
                </Route>
                <Route element={<SuperAdminRoute />}>
                  <Route path="/ferramentas/relatorio-app" element={<FerramentaHospedada slug="relatorio-app" />} />
                </Route>
                <Route element={<ExternalToolRoute tool="relatorios" />}>
                  <Route path="/ferramentas/relatorios" element={<FerramentaHospedada slug="relatorios" />} />
                </Route>
                <Route element={<ExternalToolRoute tool="licitacoes" />}>
                  <Route path="/ferramentas/licitacoes" element={<FerramentaHospedada slug="licitacoes" />} />
                </Route>
                <Route element={<ExternalToolRoute tool="propostaComercial" />}>
                  <Route
                    path="/ferramentas/proposta-comercial"
                    element={<FerramentaHospedada slug="proposta-comercial" />}
                  />
                </Route>
                {/*
                  Assinaturas não tem guarda: é assinatura de e-mail, todo mundo
                  que trabalha aqui precisa gerar a sua.
                */}
                <Route path="/ferramentas/assinaturas" element={<FerramentaHospedada slug="assinaturas" />} />
                <Route path="/settings" element={<SettingsLayout />}>
                  <Route path="general" element={<GeneralSettings />} />
                  <Route path="labels" element={<LabelsSettings />} />
                  <Route path="ai-assistant" element={<AiAssistantSettings />} />
                  <Route path="email-accounts" element={<EmailAccountSettings />} />
                  <Route element={<AdminRoute />}>
                    <Route path="instances" element={<InstancesSettings />} />
                  </Route>
                  <Route index element={<Navigate to="general" replace />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </TooltipProvider>
      </AppProvider>
      </ToolAccessProvider>
    </AuthProvider>
  )
  return (
    <Router future={{ v7_startTransition: false, v7_relativeSplatPath: false }}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <ErrorBoundary label="app">
          <ErrorBoundary label="update-gate" fallback={appContent}>
            <UpdateGate>{appContent}</UpdateGate>
          </ErrorBoundary>
        </ErrorBoundary>
      </ThemeProvider>
    </Router>
  )
}

export default App
