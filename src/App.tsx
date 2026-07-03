import { lazy, Suspense } from 'react'
import { BrowserRouter, HashRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'

const isElectron = window.navigator.userAgent.includes('Electron')
const Router = isElectron ? HashRouter : BrowserRouter
import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import Layout from './components/Layout'
import { AppProvider } from './stores/useAppStore'
import SettingsLayout from './pages/settings/SettingsLayout'
import Login from './pages/Login'
import { AuthProvider, useAuth } from './hooks/use-auth'

const Index = lazy(() => import('./pages/Index'))
const Devices = lazy(() => import('./pages/Devices'))
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
const AnalisePrn = lazy(() => import('./pages/tools/AnalisePrn'))
const RateioMobilemed = lazy(() => import('./pages/tools/RateioMobilemed'))

const ProtectedRoute = () => {
  const { isAuthenticated, loading } = useAuth()
  if (loading)
    return (
      <div className="h-screen w-full flex items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    )
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />
}

const AdminRoute = () => {
  const { user } = useAuth()
  return user?.is_admin ? <Outlet /> : <Navigate to="/dashboard" replace />
}

const App = () => (
  <Router future={{ v7_startTransition: false, v7_relativeSplatPath: false }}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AuthProvider>
        <AppProvider>
          <TooltipProvider>
          <Toaster />
          <Sonner />
          <Suspense fallback={<div className="h-screen w-full flex items-center justify-center text-muted-foreground">Carregando...</div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
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
                  <Route path="/ferramentas/analise-prn" element={<AnalisePrn />} />
                  <Route path="/ferramentas/rateio-mobilemed" element={<RateioMobilemed />} />
                </Route>
                <Route path="/settings" element={<SettingsLayout />}>
                  <Route path="devices" element={<Devices />} />
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
    </AuthProvider>
    </ThemeProvider>
  </Router>
)

export default App
