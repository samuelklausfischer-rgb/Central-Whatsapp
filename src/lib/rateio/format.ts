export function fmt(val: number | null | undefined): string {
  return Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function fmtNum(val: number | null | undefined): string {
  return Number(val || 0).toLocaleString('pt-BR')
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
