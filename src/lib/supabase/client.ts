import { createClient } from '@supabase/supabase-js'
import { appEnv } from '@/lib/env'

const supabaseUrl = appEnv.VITE_SUPABASE_URL
const supabaseAnonKey = appEnv.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 40,
    },
  },
})

export default supabase
