/**
 * Portão de build: falha se faltar variável que NÃO pode ter padrão no código.
 *
 * Por que existe: a v0.0.207 foi publicada a partir de uma pasta cujo
 * `.env.local` tinha 4 das 10 variáveis que o código lê. O Vite grava `VITE_*`
 * no bundle em tempo de build, então o app foi para a frota com URL vazia e
 * duas ferramentas quebradas — sem nenhum erro no build. O binário saiu
 * quebrado em silêncio, e o problema só apareceu quando um usuário clicou.
 *
 * A divisão é intencional:
 * - URLs públicas têm PADRÃO em `src/lib/env.ts` e não entram nesta lista.
 * - Segredos não podem ter padrão no código, então são checados aqui.
 *
 * Usa o `loadEnv` do próprio Vite em vez de ler `.env.local` na mão: é a mesma
 * resolução que o build vai fazer, incluindo variáveis vindas do ambiente. Sem
 * isso o build do Docker — onde os valores chegam por `ENV`, não por arquivo —
 * falharia por engano.
 */
import { loadEnv } from 'vite'

const OBRIGATORIAS = [
  ['VITE_SUPABASE_URL', 'URL do Supabase principal'],
  ['VITE_SUPABASE_PUBLISHABLE_KEY', 'chave publicável do Supabase principal'],
  ['VITE_FINANCEIRO_SUPABASE_URL', 'URL do Supabase financeiro (Análise PRN, Rateio)'],
  ['VITE_FINANCEIRO_SUPABASE_ANON_KEY', 'chave anon do Supabase financeiro'],
]

const modo = process.env.NODE_ENV || 'production'
const env = loadEnv(modo, process.cwd(), 'VITE_')

const faltando = OBRIGATORIAS.filter(([nome]) => !String(env[nome] ?? '').trim())

if (faltando.length > 0) {
  console.error('\n  Build interrompido: faltam variáveis de ambiente obrigatórias.\n')
  for (const [nome, descricao] of faltando) {
    console.error(`    ${nome}`)
    console.error(`      ${descricao}`)
  }
  console.error(`
  Como resolver: crie um '.env.local' na raiz do projeto com essas variáveis.
  O arquivo '.env.example' tem o formato e os nomes; os valores de produção
  estão no EasyPanel e nos ARG do Dockerfile.

  '.env.local' é gitignored de propósito (tem segredo), então NÃO vem no clone
  nem viaja entre cópias do repositório. Buildar sem ele já publicou uma versão
  quebrada antes — é isso que esta checagem existe para impedir.
`)
  process.exit(1)
}
