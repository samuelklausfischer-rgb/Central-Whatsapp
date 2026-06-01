import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import supabase from '@/lib/supabase/client'
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
  const { data: links } = await supabase
    .from('user_allowed_devices')
    .select('device_id')
    .eq('user_id', userId)
  if (!links || links.length === 0) return []

  const ids = links.map((l: { device_id: string }) => l.device_id)
  const { data: devices } = await supabase
    .from('devices')
    .select('*')
    .in('id', ids)
  return (devices as Device[]) || []
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<(Profile & { email: string }) | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [allowedDeviceIds, setAllowedDeviceIds] = useState<string[]>([])
  const [allowedDevices, setAllowedDevices] = useState<Device[]>([])

  const refreshProfile = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      setUser(null)
      setIsAuthenticated(false)
      setAllowedDeviceIds([])
      setAllowedDevices([])
      return
    }

    const profile = await fetchProfile(session.user.id)
    if (!profile) {
      setUser(null)
      setIsAuthenticated(false)
      return
    }

    const mergedUser = { ...profile, email: session.user.email || profile.email || '' }
    setUser(mergedUser)
    setIsAuthenticated(true)

    // Fetch allowed devices
    if (profile.is_admin) {
      const { data: allDevices } = await supabase
        .from('devices')
        .select('*')
      setAllowedDevices((allDevices as Device[]) || [])
      setAllowedDeviceIds((allDevices as Device[])?.map((d) => d.id) || [])
    } else {
      const devices = await fetchAllowedDevices(session.user.id)
      setAllowedDevices(devices)
      setAllowedDeviceIds(devices.map((d) => d.id))
    }
  }

  useEffect(() => {
    let mounted = true

    const loadProfile = async (session: { user: { id: string; email?: string | null } }) => {
      try {
        const profile = await fetchProfile(session.user.id)
        if (!mounted) return

        if (profile) {
          const mergedUser = { ...profile, email: session.user.email || profile.email || '' }
          setUser(mergedUser)
          setIsAuthenticated(true)

          if (profile.is_admin) {
            const { data: allDevices } = await supabase.from('devices').select('*')
            if (!mounted) return
            setAllowedDevices((allDevices as Device[]) || [])
            setAllowedDeviceIds((allDevices as Device[])?.map((d) => d.id) || [])
          } else {
            const devices = await fetchAllowedDevices(session.user.id)
            if (!mounted) return
            setAllowedDevices(devices)
            setAllowedDeviceIds(devices.map((d) => d.id))
          }
        } else {
          setUser(null)
          setIsAuthenticated(false)
          setAllowedDeviceIds([])
          setAllowedDevices([])
        }
      } catch (err) {
        console.error('loadProfile error:', err)
        if (!mounted) return
        setUser(null)
        setIsAuthenticated(false)
        setAllowedDeviceIds([])
        setAllowedDevices([])
      } finally {
        if (mounted) setLoading(false)
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      if (session?.user) {
        loadProfile(session)
      } else {
        setUser(null)
        setIsAuthenticated(false)
        setAllowedDeviceIds([])
        setAllowedDevices([])
        setLoading(false)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signUp = async (email: string, password: string, data?: Record<string, string>) => {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data },
      })
      if (error) return { error }
      return { error: null }
    } catch (error) {
      return { error }
    }
  }

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return { error }
      return { error: null }
    } catch (error) {
      return { error }
    }
  }

  const signOut = () => {
    supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        signUp,
        signIn,
        signOut,
        loading,
        refreshProfile,
        allowedDeviceIds,
        allowedDevices,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
