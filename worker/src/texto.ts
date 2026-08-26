/**
 * Monta o texto que vai para cada destinatário.
 *
 * Vive num módulo só seu, e não dentro do motor, porque é lógica pura e precisa
 * ser testável sem banco: o motor importa o cliente Supabase, que exige
 * credencial já na carga do módulo — testar a substituição de variável não pode
 * depender de ter a chave de serviço em mãos.
 */

/**
 * `{nome}` vira o PRIMEIRO nome, não o nome inteiro.
 *
 * "Olá Maria" soa como mensagem de gente; "Olá Maria Aparecida da Silva Santos"
 * denuncia mala direta — e parecer mala direta é exatamente o que aumenta o risco
 * de o número ser bloqueado.
 *
 * Sem nome (ou quando o "nome" é o próprio número, que é o que sobra num contato
 * desconhecido), a saudação some junto com a vírgula pendurada. Sem isso a pessoa
 * receberia "Olá , tudo bem?", que é pior do que não cumprimentar.
 */
export function montarTexto(modelo: string, nomeExibicao: string | null): string {
  const primeiro = (nomeExibicao ?? '').trim().split(/\s+/)[0] ?? ''
  const ehNumero = /^\d+$/.test(primeiro)
  const tratamento = ehNumero ? '' : primeiro

  if (!tratamento) {
    return modelo
      .replace(/,?\s*\{nome\}/gi, '')
      .replace(/\{nome\}/gi, '')
      .trim()
  }
  return modelo.replace(/\{nome\}/gi, tratamento)
}
