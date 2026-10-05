// Executa fn sobre os itens com no máximo `limite` chamadas simultâneas.
export async function executarEmPool<T>(itens: T[], limite: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let prox = 0
  const trabalhador = async () => {
    while (prox < itens.length) {
      const i = prox++
      await fn(itens[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador))
}

// O PostgREST limita 1000 linhas por chamada: busca de 1000 em 1000 até acabar.
export async function paginar<T>(
  buscar: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  tamanho = 1000,
): Promise<T[]> {
  const todas: T[] = []
  for (let de = 0; ; de += tamanho) {
    const { data, error } = await buscar(de, de + tamanho - 1)
    if (error) throw new Error(error.message)
    const lote = (data ?? []) as T[]
    todas.push(...lote)
    if (lote.length < tamanho) return todas
  }
}
