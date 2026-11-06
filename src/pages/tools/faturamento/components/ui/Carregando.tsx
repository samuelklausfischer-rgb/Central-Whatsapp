/** Skeleton de carregamento (linhas cinza pulsantes). */
export function Carregando({ linhas = 3, rotulo = 'Carregando…' }: { linhas?: number; rotulo?: string }) {
  return (
    <div role="status" aria-live="polite" className="animate-pulse space-y-3">
      <span className="sr-only">{rotulo}</span>
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="h-4 rounded bg-slate-200" style={{ width: `${100 - (i % 3) * 15}%` }} />
      ))}
    </div>
  )
}
