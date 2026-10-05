export function Pill({ texto, cor }: { texto: string; cor: string }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${cor}`}>{texto}</span>
}
