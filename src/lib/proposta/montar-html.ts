/**
 * Monta o HTML de 13 páginas da proposta — o mesmo que o Chrome imprime.
 *
 * POR QUE OS TEMPLATES CONTINUAM EM JINJA
 * Os 13 slides são copiados **sem edição** de
 * `PROPOSTA PRN PDF/work/templates/slide-NN.html.j2`. Converter tudo para JSX ou
 * template string daria ~1.700 linhas geradas que ninguém consegue comparar com
 * o original — e o original é o gabarito de fidelidade do PDF. Mantendo o
 * arquivo idêntico, atualizar o desenho é copiar o `.j2` por cima, e o
 * `slides.html.j2` daqui pode ser conferido linha a linha contra o de lá.
 *
 * O preço é este renderizador. Ele é minúsculo porque os templates usam só três
 * construções — conferido por inventário nos 13 arquivos:
 *   - `{{ caminho.no.objeto }}` com os filtros `upper`, `nbsp` e `length`
 *   - `{% for x in lista %} … {% endfor %}` (3 ocorrências, sem aninhamento)
 * Não é um Jinja de verdade e nem tenta ser: qualquer construção nova nos
 * templates precisa passar por aqui de propósito, para não entrar sem revisão.
 */

import type { DadosProposta } from './dados'

/**
 * Lido dentro da função, e não no topo do módulo, para o motor continuar
 * importável fora do Vite — é assim que `scripts/conferir-proposta.mjs`
 * consegue rodar a renderização no Node, sem build.
 */
const base = () => import.meta.env.BASE_URL

/**
 * Espaco fixo: impede "90 dias" de quebrar entre o numero e a palavra.
 *
 * Vai por constante escapada porque o U+00A0 e indistinguivel de um espaco
 * comum ao ler o arquivo — literal, ninguem percebe se for normalizado de volta.
 */
const ESPACO_FIXO = String.fromCharCode(0xa0)
const nbsp = (v: unknown) => String(v).replaceAll(" ", ESPACO_FIXO)

/** Mesmo escape do `select_autoescape` do Jinja, que estava ligado. */
const esc = (v: unknown) =>
  String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Caminha `cliente.nome` dentro do escopo atual. */
function resolver(caminho: string, escopo: Record<string, unknown>): unknown {
  return caminho.split('.').reduce<unknown>(
    (atual, parte) =>
      atual && typeof atual === 'object' ? (atual as Record<string, unknown>)[parte] : undefined,
    escopo,
  )
}

const FILTROS: Record<string, (v: unknown) => unknown> = {
  upper: (v) => String(v ?? '').toUpperCase(),
  nbsp: (v) => nbsp(v),
  length: (v) => (Array.isArray(v) ? v.length : 0),
}

/** Resolve as `{{ ... }}` de um trecho, sem tocar nos `{% ... %}`. */
function interpolar(trecho: string, escopo: Record<string, unknown>): string {
  return trecho.replace(/{{\s*([^}]+?)\s*}}/g, (_todo, expressao: string) => {
    const [caminho, ...filtros] = expressao.split('|').map((s) => s.trim())
    let valor = resolver(caminho, escopo)
    for (const f of filtros) {
      const filtro = FILTROS[f]
      if (!filtro) throw new Error(`Filtro Jinja não suportado no template: "${f}"`)
      valor = filtro(valor)
    }
    // `length` produz número e não vem de digitação: escapar é inofensivo.
    return esc(valor)
  })
}

/**
 * Expande os `{% for %}` (uma passada, sem aninhamento) e depois interpola.
 *
 * A ordem importa: o corpo do laço precisa ser interpolado uma vez POR ITEM,
 * com a variável do laço no escopo.
 */
function renderizar(template: string, escopo: Record<string, unknown>): string {
  const comLacos = template.replace(
    /{%\s*for\s+(\w+)\s+in\s+([\w.]+)\s*%}([\s\S]*?){%\s*endfor\s*%}/g,
    (_todo, variavel: string, listaCaminho: string, corpo: string) => {
      const lista = resolver(listaCaminho, escopo)
      if (!Array.isArray(lista)) return ''
      return lista.map((item) => interpolar(corpo, { ...escopo, [variavel]: item })).join('')
    },
  )
  return interpolar(comLacos, escopo)
}

interface Pecas {
  template: string
  estilos: string
  slides: string
  imagens: Record<string, string>
}

let pecas: Promise<Pecas> | null = null

/** Baixa esqueleto, CSS, slides e a logo em base64. Memoizado por sessão. */
export function carregarPecas(): Promise<Pecas> {
  if (!pecas) {
    const texto = (arquivo: string) =>
      fetch(`${base()}proposta/${arquivo}`).then((r) => {
        if (!r.ok) throw new Error(`${arquivo} respondeu ${r.status}`)
        return r.text()
      })

    pecas = Promise.all([
      texto('template.html'),
      texto('estilos.css'),
      texto('slides.html.j2'),
      texto('imagens.json').then((t) => JSON.parse(t) as Record<string, string>),
    ])
      .then(([template, estilos, slides, imagens]) => ({ template, estilos, slides, imagens }))
      .catch((erro) => {
        pecas = null // não condenar a ferramenta por uma falha de rede
        throw erro
      })
  }
  return pecas
}

/**
 * O HTML completo e AUTOCONTIDO da proposta.
 *
 * Autocontido é requisito, não capricho: no Electron ele é gravado num arquivo
 * temporário fora da pasta do app, e na web vai para um iframe `srcdoc`. Nos
 * dois casos não existe caminho relativo que resolva `assets/logo.png` — por
 * isso a logo entra como `data:` URI, no lugar do `<base href>` que o app
 * Python usava. As fontes já vêm embutidas em base64 dentro do CSS.
 */
export function montarHtml(dados: DadosProposta, p: Pecas): string {
  const secoes = renderizar(p.slides, dados as unknown as Record<string, unknown>)

  // TODAS as substituições abaixo usam a forma de FUNÇÃO de propósito. Passar o
  // CSS ou o HTML como string faria o motor de regex interpretar `$&`, `$1` e
  // `` $` `` dentro deles — um `$&` perdido no CSS colaria o marcador de volta
  // no lugar do estilo, e o PDF sairia sem formatação nenhuma.
  const comImagens = Object.entries(p.imagens).reduce(
    (html, [caminho, dataUri]) => html.replaceAll(`src="${caminho}"`, () => `src="${dataUri}"`),
    secoes,
  )

  const titulo = esc(`Proposta Comercial — PRN Diagnósticos × ${dados.cliente.nome}`)

  return p.template
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${titulo}</title>`)
    .replace('<!--STYLES-->', () => p.estilos)
    .replace('<!--SECTIONS-->', () => comImagens)
}
