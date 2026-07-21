import { useState } from 'react'
import logoUrl from '/logo.png'
import { useAuth } from '@/hooks/use-auth'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GridBackground } from '@/components/ui/grid-background'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
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

    const { error } = await signIn(trimmedUsername, password)
    if (!error) {
      navigate('/dashboard')
    } else {
      setErrorMsg('Usuário ou senha incorretos.')
    }
  }

  return (
    <div className="relative flex items-center justify-center min-h-screen overflow-hidden">
      <GridBackground />
      <form
        onSubmit={handleLogin}
        className="relative z-10 p-8 bg-card rounded-xl shadow-2xl border border-border space-y-6 w-[400px]"
      >
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-3 mb-4">
            <img src={logoUrl} alt="Central Whats" className="h-16 w-16 object-contain" />
            <span className="text-3xl font-display font-bold tracking-tight text-foreground">
              Central <span className="text-blue-500">Whats</span>
            </span>
          </div>
          <p className="text-sm text-muted-foreground">Faça login com suas credenciais corporativas.</p>
        </div>
        <div className="space-y-4">
          <Input
            placeholder="Usuário"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <Input
            placeholder="Senha"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {errorMsg && <p className="text-sm text-red-500 font-medium">{errorMsg}</p>}
        </div>
        <Button className="w-full h-11 text-base" type="submit">
          Entrar
        </Button>
      </form>
    </div>
  )
}
