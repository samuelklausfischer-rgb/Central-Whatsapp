import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Se definido, é renderizado no lugar da tela de erro quando um filho lança. */
  fallback?: ReactNode
  /** Rótulo pra log (ex.: "app", "update-gate"). */
  label?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Rede de segurança: um erro de runtime em qualquer filho não pode deixar a tela
 * preta. Sem `fallback`, mostra uma tela de recuperação com botão "Recarregar".
 * Com `fallback` (ex.: os próprios children do gate), renderiza o fallback →
 * usado pra fazer o UpdateGate "falhar aberto" (deixa o app carregar).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Aparece no DevTools (Ctrl+Shift+I) pra diagnóstico.
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) return this.props.fallback
      return (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
          <span className="text-lg font-semibold">Algo deu errado ao abrir o app</span>
          <p className="max-w-md text-sm text-muted-foreground">
            {this.state.error?.message || 'Erro inesperado.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Recarregar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
