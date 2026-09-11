export function fmt(val: number | null | undefined): string {
  return Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function fmtNum(val: number | null | undefined): string {
  return Number(val || 0).toLocaleString('pt-BR')
}

// Interpreta o valor digitado no campo de serviço adicional. Aceita "1.234,56",
// "R$ 1.234,56", "1234.56" e "1500". Sem vírgula, um ponto só é separador de milhar
// quando vem seguido de exatamente 3 dígitos (1.500 → 1500); caso contrário é decimal
// (1500.50 → 1500.5). O número resolvido é o que vai para o n8n, para essa ambiguidade
// não ser interpretada de novo do outro lado.
export function valorNumerico(v: string | number | null | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  let t = String(v ?? '')
    .trim()
    .replace(/R\$/gi, '')
    .replace(/\s/g, '')
  if (!t) return 0
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  const n = parseFloat(t)
  return Number.isFinite(n) ? n : 0
}

// Decodifica um arquivo base64 (vindo da resposta do webhook de rateio ou do
// histórico) e dispara o download no navegador.
export function baixarBase64(nome: string, mime: string, base64: string): void {
  const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const blob = new Blob([bin], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  URL.revokeObjectURL(url)
}
