import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import Index from './pages/Index'
import Devices from './pages/Devices'
import ChatHub from './pages/ChatHub'
import CRM from './pages/CRM'
import Notes from './pages/Notes'
import Triggers from './pages/Triggers'
import ScheduledMessages from './pages/ScheduledMessages'
import NotFound from './pages/NotFound'
import Layout from './components/Layout'
import { AppProvider } from './stores/useAppStore'
import SettingsLayout from './pages/settings/SettingsLayout'
import GeneralSettings from './pages/settings/GeneralSettings'
import LabelsSettings from './pages/settings/LabelsSettings'
import AiAssistantSettings from './pages/settings/AiAssistantSettings'
import Login from './pages/Login'
import { AuthProvider, useAuth } from './hooks/use-auth'
import AdminPage from './pages/admin/AdminPage'

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
  <BrowserRouter future={{ v7_startTransition: false, v7_relativeSplatPath: false }}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AuthProvider>
        <AppProvider>
          <TooltipProvider>
          <Toaster />
          <Sonner />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Index />} />
                <Route path="/chat" element={<ChatHub />} />
                <Route path="/crm" element={<CRM />} />
                <Route path="/notes" element={<Notes />} />
                <Route path="/triggers" element={<Triggers />} />
                <Route path="/scheduled-messages" element={<ScheduledMessages />} />
                <Route element={<AdminRoute />}>
                  <Route path="/admin" element={<AdminPage />} />
                </Route>
                <Route path="/settings" element={<SettingsLayout />}>
                  <Route path="devices" element={<Devices />} />
                  <Route path="general" element={<GeneralSettings />} />
                  <Route path="labels" element={<LabelsSettings />} />
                  <Route path="ai-assistant" element={<AiAssistantSettings />} />
                  <Route index element={<Navigate to="general" replace />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </TooltipProvider>
      </AppProvider>
    </AuthProvider>
    </ThemeProvider>
  </BrowserRouter>
)

export default App
