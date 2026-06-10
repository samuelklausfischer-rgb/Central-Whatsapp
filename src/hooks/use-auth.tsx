import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react'
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

async function loadUserData(
  session: { user: { id: string; email?: string | null } },
  signal: { aborted: boolean },
) {
  const profile = await fetchProfile(session.user.id)
  if (!profile || signal.aborted) return null

  const mergedUser = { ...profile, email: session.user.email || profile.email || '' }
  let deviceList: Device[] = []
  let deviceIdList: string[] = []

  if (profile.is_admin) {
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

  useEffect(() => {
    let mounted = true
    const signal = { get aborted() { return !mounted } }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      if (session?.user) {
        setLoading(true)
        // Defer async work outside the callback to prevent Supabase auth deadlock
        setTimeout(async () => {
          if (!mounted) return
          try {
            const result = await loadUserData(session, signal)
            if (!result || !mounted) return
            setUser(result.user)
            setIsAuthenticated(true)
            setAllowedDevices(result.devices)
            setAllowedDeviceIds(result.deviceIds)
          } catch {
            if (!mounted) return
            setUser(null)
            setIsAuthenticated(false)
            setAllowedDeviceIds([])
            setAllowedDevices([])
          } finally {
            if (mounted) setLoading(false)
          }
        }, 0)
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
      setAllowedDevices(result.devices)
      setAllowedDeviceIds(result.deviceIds)
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
    supabase.auth.signOut()
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
