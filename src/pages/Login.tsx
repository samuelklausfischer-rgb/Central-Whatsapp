import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { BrandLogo } from '@/components/BrandLogo'
import { useAuth } from '@/hooks/use-auth'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AuthShell } from '@/components/auth/AuthShell'
import { GlassPanel } from '@/components/ui/glass-panel'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  // Não existia antes: sem isso dava para clicar "Entrar" duas vezes e
  // disparar dois logins em voo (dois signIn concorrentes). `finally` garante
  // que o botão libera de novo mesmo se signIn lançar.
  const [enviando, setEnviando] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')

    let trimmedUsername = username.trim()
    if (!trimmedUsername) {
      setErrorMsg('Por favor, informe seu usuário.')
      return
    }

    setEnviando(true)
    try {
      const { error } = await signIn(trimmedUsername, password)
      if (!error) {
        navigate('/dashboard')
      } else {
        setErrorMsg('Usuário ou senha incorretos.')
      }
    } finally {
      setEnviando(false)
    }
  }

  return (
    <AuthShell>
      <GlassPanel>
        <form onSubmit={handleLogin} className="space-y-6">
          <div className="text-center space-y-2">
            {/* h-11 de propósito: a esfera do PRN Hub já está na foto de
                fundo, então o lockup aqui é reforço e não deve competir em
                tamanho com ela. */}
            <div className="flex items-center justify-center mb-4">
              <BrandLogo className="h-11 w-auto object-contain" />
            </div>
            <p className="text-sm text-white/70">Faça login com suas credenciais corporativas.</p>
          </div>
          <div className="space-y-4">
            <Input
              placeholder="Usuário"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="h-11 bg-white/10 border-white/25 text-white placeholder:text-white/55 focus-visible:ring-white/40"
            />
            <Input
              placeholder="Senha"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-11 bg-white/10 border-white/25 text-white placeholder:text-white/55 focus-visible:ring-white/40"
            />
            {errorMsg && <p className="text-sm text-red-400 font-medium">{errorMsg}</p>}
          </div>
          <Button className="w-full h-11 text-base" type="submit" disabled={enviando}>
            {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Entrar
          </Button>
        </form>
      </GlassPanel>
    </AuthShell>
  )
}
