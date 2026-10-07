/**
 * Separa o que a pessoa ESCREVEU do histórico que o programa de e-mail colou
 * embaixo ("De: … Enviado: …", "Em seg., … escreveu:", a cadeia inteira de
 * respostas citadas).
 *
 * POR QUE EXISTE. Na visão de conversa cada resposta vira um bloco, e a
 * resposta nº 5 carrega dentro dela as quatro anteriores — que já estão nos
 * blocos de baixo. Sem cortar, o mesmo texto aparece cinco vezes e o que a
 * pessoa de fato disse some no meio.
 *
 * É FUNÇÃO PURA e sem DOM de propósito: roda em teste de linha de comando e não
 * depende de `DOMParser` (que não existe fora do navegador). O preço é que
 * trabalha sobre o TEXTO do HTML, com regex — por isso corta no PRIMEIRO
 * marcador e nunca tenta "consertar" a árvore: o que sobra pode ter tag aberta,
 * e o iframe que mostra isso fecha sozinho no fim do documento.
 *
 * Duas travas contra o pior defeito possível, que é esconder conteúdo:
 *  - se o que sobraria acima do corte é (quase) vazio, NÃO corta — o caso típico
 *    é o encaminhamento sem comentário, em que o conteúdo todo é o "citado";
 *  - o trecho cortado nunca é jogado fora: volta em `citado`, e a tela oferece
 *    "Mostrar histórico citado".
 */

export interface HistoricoCortado {
  /** O que a pessoa escreveu — é o que o bloco mostra por padrão. */
  principal: string
  /** O que veio depois do corte, ou `null` se não há marcador (ou cortar esvaziaria a mensagem). */
  citado: string | null
}

/* ——— HTML ——— */

/**
 * Marcadores que são uma TAG: o corte é feito no começo dela.
 *
 * Cada um é de um programa:
 *  - `appendonsend` / `divRplyFwdMsg`: Outlook (web e novo). O primeiro é uma
 *    `<div>` vazia que fica logo ANTES da linha divisória; o segundo, o cabeçalho
 *    "De/Enviado". Usa-se o que aparecer primeiro.
 *  - `gmail_quote`: Gmail. A `<div>` já contém a linha "Em … escreveu:", então
 *    cortar nela leva o cabeçalho junto.
 *  - `blockquote type="cite"`: Apple Mail e Thunderbird. A linha "escreveu:" fica
 *    FORA da tag, por isso há tratamento à parte (`recuarSobreLinhaEscreveu`).
 *  - `yahoo_quoted` / `OLK_SRC_BODY_SECTION`: Yahoo e Outlook para Mac.
 *
 * O `x_` opcional é o prefixo que o Outlook web acrescenta quando reaproveita o
 * HTML de uma mensagem já citada.
 */
const MARCADORES_DE_TAG: RegExp[] = [
  /<[a-z][^>]*\bid\s*=\s*["']?(?:x_)?appendonsend\b/i,
  /<[a-z][^>]*\bid\s*=\s*["']?(?:x_)?divRplyFwdMsg\b/i,
  /<(?:div|blockquote)\b[^>]*\bclass\s*=\s*["'][^"']*\bgmail_quote\b/i,
  /<blockquote\b[^>]*\btype\s*=\s*["']?cite\b/i,
  /<[a-z][^>]*\b(?:id|class)\s*=\s*["']?[^"'>\s]*yahoo_quoted/i,
  /<[a-z][^>]*\bid\s*=\s*["']?OLK_SRC_BODY_SECTION\b/i,
]

/**
 * "-----Original Message-----" e a versão em português, escritas como texto no HTML.
 *
 * O `(?:^|[^-])` na frente só ancora a busca no COMEÇO da sequência de traços.
 * Sem ele a regex tentava cada traço de uma linha de `-----…` como início e, a cada
 * tentativa, varria o resto da linha de novo: tempo quadrático no tamanho da
 * sequência, no HTML inteiro. O caractere de âncora é descontado em quem usa
 * (`primeiroMarcadorHtml`), como já se faz com o `>` das outras.
 */
const MARCADOR_MENSAGEM_ORIGINAL =
  /(?:^|[^-])-{3,}\s*(?:Original Message|Mensagem original)\s*-{3,}/i

/**
 * "Em seg., 6 de out. de 2026 às 14:32, Fulano <f@x.com> escreveu:" escrito como
 * texto. Exige começo de tag/linha antes para não pegar "on … wrote:" no meio de
 * uma frase comum. Os `<…>` no meio são permitidos porque o e-mail do remetente
 * costuma vir como link (`<a href="mailto:…">`).
 */
const MARCADOR_EM_ESCREVEU_HTML =
  /(?:^|>)\s*(?:Em|On)\s(?:[^<>]|<[^>]*>){3,300}?(?:escreveu|wrote)\s*:/i

/**
 * Começo de um cabeçalho "De: …" (ou "From: …"), com as tags de negrito que o
 * Outlook põe em volta. Só vale se "Enviado:"/"Sent:" aparecer logo depois —
 * isso é conferido à parte, porque expressar "logo depois, atravessando tags"
 * numa regex só ficaria ilegível.
 */
const INICIO_DE_CABECALHO_DE =
  /(?:^|>)\s*(?:<(?:b|strong|span|font|u)\b[^>]*>\s*)*(?:De|From)\s*:/gi
// Sem `\s*` antes do grupo: ele já aceita espaço, e dois quantificadores sobre o
// mesmo caractere, seguidos, viram tempo quadrático numa fileira de espaços.
const ENVIADO_LOGO_DEPOIS =
  /(?:Enviado|Sent|Enviada em|Data|Date)(?:<[^>]*>|\s|&nbsp;)*:/i

/**
 * O que pode estar colado ANTES do marcador e que pertence a ele, não à fala da
 * pessoa: abertura de bloco ainda sem texto, quebra de linha, a linha divisória
 * (`<hr>`) e a "régua" de sublinhados que o Outlook desenha.
 *
 * É UM item só; quem acha a sequência deles no fim do trecho é `inicioDaSobra`. A
 * forma antiga, `(?:item)+$` numa regex, explodia: com `_{5,}` dentro do grupo
 * repetido, uma fileira de N sublinhados podia ser repartida de 2^N jeitos e a
 * regex testava todos antes de desistir (64 sublinhados = 2 s, durante o render).
 * O `(?!_)` faz o item pegar sempre a fileira INTEIRA.
 */
const ITEM_DE_SOBRA_HTML =
  /(?:\s|<(?:div|p|span|b|strong|font|i|em|u|table|tbody|tr|td|center)\b[^>]*>|<br\s*\/?>|<hr\b[^>]*>|&nbsp;|_{5,}(?!_))/iy

/**
 * Quanto do trecho anterior olhar ao tirar a sobra. A sobra de verdade é curta;
 * limitar a janela evita varrer o corpo inteiro a cada mensagem aberta.
 */
const JANELA_DA_SOBRA = 3000

/**
 * Onde começa a sequência de itens de sobra que vai até o FIM de `trecho` — ou
 * `trecho.length` se o fim não é sobra.
 *
 * Uma varredura só, da esquerda para a direita, sem voltar: em cada posição ou
 * consome um item (e a sequência em curso continua) ou larga a sequência e anda um
 * caractere. Custo linear. A regex equivalente (`(?:item)+$`, sem âncora de
 * início) tentava cada posição como começo e relia até o fim a cada vez, o que
 * dava tempo quadrático numa fileira de espaços ou quebras de linha. O resultado
 * é o mesmo porque cada item é determinístico a partir do primeiro caractere
 * (nenhum começo de item se confunde com outro), então não há o que "voltar".
 */
function inicioDaSobra(trecho: string, item: RegExp): number {
  let inicio = -1
  let p = 0
  while (p < trecho.length) {
    item.lastIndex = p
    const achou = item.exec(trecho)
    if (achou) {
      if (inicio < 0) inicio = p
      p += Math.max(achou[0].length, 1)
    } else {
      inicio = -1
      p += 1
    }
  }
  return inicio < 0 ? trecho.length : inicio
}

/**
 * A linha "Em … escreveu:" que o Apple Mail deixa logo acima do `blockquote`.
 *
 * O fim é `(?:\s*:)?` + grupo, e não `\s*:?\s*` + grupo: o grupo já aceita espaço, e
 * três quantificadores seguidos sobre o mesmo caractere davam tempo cúbico numa
 * fileira de espaços entre "escreveu" e o texto seguinte.
 */
const LINHA_ESCREVEU_NO_FIM_HTML =
  /(?:Em|On)\s(?:[^<>]|<[^>]*>){3,400}?(?:escreveu|wrote)(?:\s*:)?(?:<[^>]*>|\s|&nbsp;)*$/i

/** Quanto do fim do trecho olhar ao procurar a linha "escreveu:" — evita regex em corpo inteiro. */
const JANELA_DA_LINHA_ESCREVEU = 700

/** Acima disto o texto visível conta como "tem conteúdo". Abaixo, cortar esvaziaria a mensagem. */
const MINIMO_DE_CARACTERES_VISIVEIS = 2

/** Texto que o leitor veria, sem tag, comentário, `<style>` nem entidades de espaço. */
function textoVisivelDoHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(?:style|head|script)\b[\s\S]*?<\/(?:style|head|script)>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|#160|#xa0|zwnj|zwj|#8203);?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function temConteudo(htmlOuTexto: string, ehHtml: boolean): boolean {
  if (ehHtml && /<img\b/i.test(htmlOuTexto)) return true
  const visivel = ehHtml ? textoVisivelDoHtml(htmlOuTexto) : htmlOuTexto.trim()
  return [...visivel].length >= MINIMO_DE_CARACTERES_VISIVEIS
}

/** Posição do primeiro marcador do HTML, ou `-1`. */
function primeiroMarcadorHtml(html: string): number {
  let menor = -1
  const considerar = (posicao: number) => {
    if (posicao >= 0 && (menor < 0 || posicao < menor)) menor = posicao
  }

  for (const marcador of MARCADORES_DE_TAG) {
    considerar(html.search(marcador))
  }

  const mensagemOriginal = MARCADOR_MENSAGEM_ORIGINAL.exec(html)
  if (mensagemOriginal) {
    considerar(mensagemOriginal.index + (mensagemOriginal[0].startsWith('-') ? 0 : 1))
  }

  const emEscreveu = MARCADOR_EM_ESCREVEU_HTML.exec(html)
  if (emEscreveu) {
    // O `>` inicial da regex é só âncora; o corte vai logo depois dele.
    considerar(emEscreveu.index + (emEscreveu[0].startsWith('>') ? 1 : 0))
  }

  INICIO_DE_CABECALHO_DE.lastIndex = 0
  let candidato: RegExpExecArray | null
  while ((candidato = INICIO_DE_CABECALHO_DE.exec(html))) {
    const posicao = candidato.index + (candidato[0].startsWith('>') ? 1 : 0)
    if (menor >= 0 && posicao >= menor) break
    if (ENVIADO_LOGO_DEPOIS.test(html.slice(posicao, posicao + 900))) {
      considerar(posicao)
      break
    }
  }

  return menor
}

/** Leva o corte para ANTES da linha "…escreveu:" que antecede um `blockquote`, se houver. */
function recuarSobreLinhaEscreveuHtml(html: string, posicao: number): number {
  const inicioDaJanela = Math.max(0, posicao - JANELA_DA_LINHA_ESCREVEU)
  const antes = html.slice(inicioDaJanela, posicao)
  const achou = LINHA_ESCREVEU_NO_FIM_HTML.exec(antes)
  return achou ? inicioDaJanela + achou.index : posicao
}

/** Tira do fim de `antes` o que pertence ao marcador (ver `ITEM_DE_SOBRA_HTML`). */
function posicaoSemSobraHtml(html: string, posicao: number): number {
  const inicioDaJanela = Math.max(0, posicao - JANELA_DA_SOBRA)
  return inicioDaJanela + inicioDaSobra(html.slice(inicioDaJanela, posicao), ITEM_DE_SOBRA_HTML)
}

export function cortarHistoricoHtml(html: string | null | undefined): HistoricoCortado {
  const original = html ?? ''
  const marcador = primeiroMarcadorHtml(original)
  if (marcador <= 0) return { principal: original, citado: null }

  // Ordem importa: primeiro tira a sobra colada no marcador (`<hr>`, `<br>`),
  // depois procura a linha "escreveu:" que ficou exposta, e tira a sobra de novo.
  let corte = posicaoSemSobraHtml(original, marcador)
  corte = recuarSobreLinhaEscreveuHtml(original, corte)
  corte = posicaoSemSobraHtml(original, corte)

  const principal = original.slice(0, corte)
  if (!temConteudo(principal, true)) return { principal: original, citado: null }
  return { principal, citado: original.slice(corte) }
}

/* ——— Texto puro ——— */

const MARCADORES_DE_TEXTO: RegExp[] = [
  /^[ \t]*-{3,}[ \t]*(?:Original Message|Mensagem original)[ \t]*-{3,}[ \t]*$/im,
  // "De: …" seguido, em até 4 linhas, de "Enviado: …".
  /^[ \t]*(?:De|From)[ \t]*:[^\n]*\n(?:[^\n]*\n){0,4}?[ \t]*(?:Enviado|Sent|Enviada em|Data|Date)[ \t]*:/im,
  // "Em … escreveu:" — a frase pode quebrar em até 3 linhas.
  /^[ \t]*(?:Em|On)[ \t][^\n]*(?:\n[^\n]*){0,2}?(?:escreveu|wrote)[ \t]*:[ \t]*$/im,
  // Citação no estilo `> texto`.
  /^[ \t]*>/m,
]

// Mesmo esquema do HTML (ver `inicioDaSobra`). A linha-régua vem ANTES de `\s` de
// propósito: as duas começam num `\n` e, como a varredura não volta atrás, a ordem
// é que decide. O fim de cada régua é conferido por `(?=\n|$)`, então um
// `[_\-=]{5,}` não tem como ser repartido.
const ITEM_DE_SOBRA_TEXTO = /(?:(?:^|\n)[ \t]*[_\-=]{5,}[ \t]*(?=\n|$)|\s)/y
// `(?:[ \t]*:)?` + `[ \t\n]*`, e não `[ \t]*:?[ \t\n]*`: o segundo grupo já aceita
// espaço, e a sobreposição dava tempo quadrático numa fileira de espaços.
const LINHA_ESCREVEU_NO_FIM_TEXTO =
  /(?:^|\n)[ \t]*(?:Em|On)[ \t][^\n]*(?:\n[^\n]*){0,2}?(?:escreveu|wrote)(?:[ \t]*:)?[ \t\n]*$/i

export function cortarHistoricoTexto(texto: string | null | undefined): HistoricoCortado {
  const original = texto ?? ''

  let marcador = -1
  for (const regex of MARCADORES_DE_TEXTO) {
    const posicao = original.search(regex)
    if (posicao >= 0 && (marcador < 0 || posicao < marcador)) marcador = posicao
  }
  if (marcador <= 0) return { principal: original, citado: null }

  const tirarSobra = (posicao: number) => {
    const inicioDaJanela = Math.max(0, posicao - JANELA_DA_SOBRA)
    return inicioDaJanela + inicioDaSobra(original.slice(inicioDaJanela, posicao), ITEM_DE_SOBRA_TEXTO)
  }

  let corte = tirarSobra(marcador)
  const antes = original.slice(Math.max(0, corte - JANELA_DA_LINHA_ESCREVEU), corte)
  const escreveu = LINHA_ESCREVEU_NO_FIM_TEXTO.exec(antes)
  if (escreveu) corte = tirarSobra(Math.max(0, corte - JANELA_DA_LINHA_ESCREVEU) + escreveu.index)

  const principal = original.slice(0, corte)
  if (!temConteudo(principal, false)) return { principal: original, citado: null }
  return { principal, citado: original.slice(corte) }
}
