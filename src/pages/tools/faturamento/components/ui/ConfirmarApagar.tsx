import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Download, Loader2, ShieldAlert, Undo2 } from 'lucide-react'
import { Botao } from './Botao'
import { cn } from './cn'
import { baixarBackup, restaurar, type Backup } from '../../lib/backup'

export interface ConfirmarApagarProps {
  nivel: 'leve' | 'pesado' | 'bloqueado'
  titulo: string
  efeitos: string[]
  /** Nível pesado: texto exato que o usuário precisa digitar. */
  confirmarCom?: string
  /** Nível bloqueado: o que fazer no lugar. */
  alternativa?: ReactNode
  onConfirmar: () => Promise<void>
  onCancelar: () => void
}

/** Confirmação inline para apagar: leve (2 cliques), pesado (digitar o nome) ou bloqueado (explica e oferece alternativa). */
export function ConfirmarApagar({ nivel, titulo, efeitos, confirmarCom, alternativa, onConfirmar, onCancelar }: ConfirmarApagarProps) {
  const [texto, setTexto] = useState('')
  const [rodando, setRodando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const raiz = useRef<HTMLDivElement>(null)
  // Foco no primeiro controle: o campo (pesado), [Apagar] (leve) ou [Entendi] (bloqueado).
  useEffect(() => { raiz.current?.querySelector<HTMLElement>('input, button')?.focus() }, [])

  const bloqueado = nivel === 'bloqueado'
  const exige = nivel === 'pesado' && !!confirmarCom
  const liberado = !exige || texto === confirmarCom

  async function confirmar() {
    if (!liberado || rodando) return
    setRodando(true)
    setErro(null)
    try { await onConfirmar() } catch (e) { setErro(e instanceof Error ? e.message : String(e)) } finally { setRodando(false) }
  }

  const Icone = bloqueado ? ShieldAlert : AlertTriangle
  return (
    <div
      ref={raiz}
      role="alertdialog"
      aria-labelledby="confirmar-apagar-titulo"
      className={cn('rounded-xl border p-4 text-sm', bloqueado ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-rose-200 bg-rose-50 text-rose-900')}
    >
      <div className="flex items-start gap-2">
        <Icone className={cn('mt-0.5 size-4 shrink-0', bloqueado ? 'text-amber-600' : 'text-rose-600')} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p id="confirmar-apagar-titulo" className="font-semibold">{titulo}</p>
          {efeitos.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
              {efeitos.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          {bloqueado && alternativa && <div className="mt-2 rounded-lg border border-amber-200 bg-white/70 p-2.5 text-slate-800">{alternativa}</div>}
          {exige && (
            <label className="mt-3 block text-xs font-medium">
              Digite <span className="rounded bg-white px-1 py-0.5 font-mono text-rose-700 ring-1 ring-rose-200">{confirmarCom}</span> para confirmar
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void confirmar() }}
                disabled={rodando}
                autoComplete="off"
                spellCheck={false}
                className="mt-1 block w-full rounded-lg border border-rose-300 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50"
              />
            </label>
          )}
          {erro && <p role="alert" className="mt-2 rounded border border-rose-300 bg-white px-2 py-1 text-xs text-rose-800">Não foi possível apagar: {erro}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {!bloqueado && (
              <Botao variante="perigo" tamanho="pequeno" disabled={!liberado || rodando} onClick={() => void confirmar()} icone={rodando ? Loader2 : undefined}>
                {rodando ? 'Apagando…' : 'Apagar'}
              </Botao>
            )}
            <Botao variante="secundario" tamanho="pequeno" disabled={rodando} onClick={onCancelar}>{bloqueado ? 'Entendi' : 'Cancelar'}</Botao>
          </div>
        </div>
      </div>
    </div>
  )
}

export interface AvisoDesfazerProps {
  backup: Backup
  onDesfeito: () => void
}

/** Barra "Apagado. Backup baixado." com [Desfazer] (restaura o backup) e [Baixar backup de novo]. */
export function AvisoDesfazer({ backup, onDesfeito }: AvisoDesfazerProps) {
  const [rodando, setRodando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: boolean; erros: string[] } | null>(null)

  async function desfazer() {
    setRodando(true)
    try {
      const r = await restaurar(backup)
      setResultado(r)
      if (r.ok) onDesfeito()
    } catch (e) {
      setResultado({ ok: false, erros: [e instanceof Error ? e.message : String(e)] })
    } finally {
      setRodando(false)
    }
  }

  const falhou = !!resultado && !resultado.ok
  return (
    <div role="status" className={cn('rounded-xl border p-3 text-sm', falhou ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900')}>
      <div className="flex flex-wrap items-center gap-2">
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
        <span className="flex-1 font-medium">Apagado. Backup baixado.</span>
        <Botao tamanho="pequeno" icone={rodando ? Loader2 : Undo2} disabled={rodando} onClick={() => void desfazer()}>{rodando ? 'Desfazendo…' : 'Desfazer'}</Botao>
        <Botao variante="fantasma" tamanho="pequeno" icone={Download} disabled={rodando} onClick={() => baixarBackup(backup)}>Baixar backup de novo</Botao>
      </div>
      {resultado && !resultado.ok && (
        <div role="alert" className="mt-2 text-xs">
          <p className="font-semibold">O desfazer terminou com problemas:</p>
          <ul className="list-disc pl-5">{resultado.erros.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
    </div>
  )
}
