import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { cortarHistoricoHtml, cortarHistoricoTexto } from './cortarHistorico'
import { esconderCidPendente, extrairCids, substituirCids } from './cid'
import { resolverImagensCid } from '@/services/email_attachments'

/**
 * Limpeza do HTML de e-mail recebido.
 *
 * É propositalmente rasa: quem de fato segura o conteúdo é o `sandbox` do iframe
 * SEM `allow-scripts` — nem `<script>` nem `onclick=` executam, mesmo que passem
 * por aqui. Esta limpeza só tira o que seria incômodo (redirecionamento,
 * `<base>` que desviaria os links) e o que seria perigoso se o sandbox um dia
 * fosse afrouxado. NÃO adicionar `allow-scripts` ao iframe com base nela.
 */
function sanitizarHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    // `<base>` do remetente desviaria o `target` e os caminhos relativos; e o
    // `refresh` poderia mandar o leitor embora sozinho.
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
}

/**
 * Imagem externa SEMPRE carrega (decisão do usuário, 07/10/2026): o bloqueio com
 * "Mostrar imagens" fazia o e-mail parecer quebrado, e quem abre mensagem aqui
 * quer ver a mensagem. O custo é conhecido — o remetente pode saber que foi
 * aberto (pixel de rastreamento) —, mitigado pelo `no-referrer` do documento,
 * que ao menos não entrega o endereço do app.
 *
 * `http://` vira `https://`: o app é servido em https e o navegador bloqueia
 * imagem http como "conteúdo misto", que era outra causa de imagem que não aparece.
 */
function imagensSempreHttps(html: string): string {
  return html.replace(/(<img\b[^>]*?\bsrc\s*=\s*["'])http:\/\//gi, '$1https://')
}

/** Estilo do documento do iframe: legível, e sem deixar o conteúdo estourar a largura. */
const ESTILO_DO_DOCUMENTO = `
  * { box-sizing: border-box; }
  html { margin: 0; padding: 0; overflow-x: auto; overflow-y: hidden; }
  body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 14px;
    line-height: 1.55;
    color: #1f2328;
    background: #fff;
    overflow-wrap: break-word;
  }
  /* Raiz medida pelo leitor. flow-root impede que a margem do último filho
     escape e deixe a altura medida menor que a real. */
  #raiz { display: flow-root; padding: 16px 20px; }
  img { max-width: 100% !important; height: auto !important; }
  a { color: #2563eb; }
  table { max-width: 100%; }
  pre { white-space: pre-wrap; }
  blockquote { margin: 0.5em 0; padding-left: 12px; border-left: 3px solid #d0d7de; color: #57606a; }
`

function montarDocumento(corpo: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <base target="_blank">
    <style>${ESTILO_DO_DOCUMENTO}</style>
  </head>
  <body><div id="raiz">${corpo}</div></body>
</html>`
}

interface Props {
  /** Identifica a mensagem: zera "mostrar citado" e as imagens ao trocar. */
  emailId: string
  html: string | null
  texto: string | null
  /**
   * Cortar o histórico citado? Só faz sentido quando a conversa tem mais de uma
   * mensagem — numa mensagem avulsa, o "citado" pode ser o próprio conteúdo
   * (encaminhamento) e esconder seria perder informação.
   */
  cortarHistorico: boolean
}

/**
 * O CONTEÚDO de uma mensagem: HTML num iframe isolado, ou texto puro.
 *
 * Fica num cartão branco em qualquer tema (ver o comentário no `BlocoDeEmail`).
 */
export function CorpoDoEmail({ emailId, html, texto, cortarHistorico }: Props) {
  const [mostrarCitado, setMostrarCitado] = useState(false)
  useEffect(() => setMostrarCitado(false), [emailId])

  /* ——— Corte do histórico ——— */
  const corteHtml = useMemo(
    () => (cortarHistorico && html ? cortarHistoricoHtml(html) : null),
    [cortarHistorico, html],
  )
  const corteTexto = useMemo(
    () => (cortarHistorico && !html && texto ? cortarHistoricoTexto(texto) : null),
    [cortarHistorico, html, texto],
  )
  const temCitado = Boolean(corteHtml?.citado || corteTexto?.citado)

  const htmlExibido = html ? (!mostrarCitado && corteHtml?.citado ? corteHtml.principal : html) : null
  const textoExibido = !html && texto ? (!mostrarCitado && corteTexto?.citado ? corteTexto.principal : texto) : null

  /* ——— Imagens `cid:` ——— */
  const cids = useMemo(() => extrairCids(htmlExibido), [htmlExibido])
  const chaveDosCids = cids.join('|')
  const [imagens, setImagens] = useState<Map<string, string>>(() => new Map())
  /**
   * Endereços `blob:` já criados para ESTA mensagem. Acumula de propósito: ao
   * alternar "mostrar histórico citado" só as imagens novas são buscadas, e as
   * que já estavam na tela não piscam nem são revogadas debaixo do iframe.
   */
  const acumuladoRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const acumulado = acumuladoRef.current
    return () => {
      for (const url of acumulado.values()) URL.revokeObjectURL(url)
      acumulado.clear()
      setImagens(new Map())
    }
  }, [emailId])

  useEffect(() => {
    const faltam = cids.filter((cid) => !acumuladoRef.current.has(cid))
    if (faltam.length === 0) return
    let valido = true
    resolverImagensCid(emailId, faltam, () => valido).then((resolvidas) => {
      if (!valido) return resolvidas.liberar()
      for (const [cid, endereco] of resolvidas.enderecos) acumuladoRef.current.set(cid, endereco)
      setImagens(new Map(acumuladoRef.current))
    })
    return () => {
      valido = false
    }
    // `cids` entra pela chave textual: o array novo a cada render não pode disparar o efeito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailId, chaveDosCids])

  const documento = useMemo(() => {
    if (htmlExibido === null) return null
    const comImagens = substituirCids(sanitizarHtml(htmlExibido), imagens)
    return montarDocumento(esconderCidPendente(imagensSempreHttps(comImagens)))
  }, [htmlExibido, imagens])

  /* ——— Altura do iframe ——— */
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const desligarMedicaoRef = useRef<(() => void) | null>(null)

  const aoCarregarDocumento = useCallback(() => {
    const iframe = iframeRef.current
    const doc = iframe?.contentDocument
    if (!iframe || !doc) return

    // Cada recarga do documento (troca de conteúdo) refaz a medição do zero.
    desligarMedicaoRef.current?.()

    // Links: sempre em aba nova e sem entregar a janela do app (`noopener`).
    // Âncora interna (`#x`) fica no próprio documento, senão o `<base target>`
    // abriria uma aba em branco.
    doc.querySelectorAll('a[href]').forEach((a) => {
      const interno = (a.getAttribute('href') ?? '').startsWith('#')
      a.setAttribute('target', interno ? '_self' : '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    })

    const raiz = doc.getElementById('raiz') ?? doc.body
    /*
      Teto de medições por documento. Um e-mail que declara `min-height: 100vh`
      faz a raiz crescer junto com o iframe, e cada medição dispararia a próxima
      para sempre. É raro, mas travaria a aba; 300 sobra para o caso real (uma
      medição por imagem, algumas por redimensionamento).
    */
    let medicoes = 0
    const medir = () => {
      if (++medicoes > 300) return
      const largura = doc.documentElement
      // Barra horizontal (tabela larga) ocupa ~15px que a altura da raiz não inclui.
      const folgaDaBarra = largura.scrollWidth > largura.clientWidth + 1 ? 16 : 0
      const altura = Math.ceil(raiz.getBoundingClientRect().height) + folgaDaBarra
      iframe.style.height = `${Math.min(Math.max(altura, 24), 30000)}px`
    }
    medir()

    // Imagem que termina de carregar muda a altura sem avisar ninguém — por isso
    // o `load` é capturado do pai (o documento é do mesmo domínio). O
    // ResizeObserver cobre o resto (fonte que chega, largura que muda).
    const aoMudar = () => medir()
    doc.addEventListener('load', aoMudar, true)
    doc.addEventListener('error', aoMudar, true)
    const observador = new ResizeObserver(aoMudar)
    observador.observe(raiz)
    // Largura do PRÓPRIO iframe mudando (painel de pastas recolhido) refaz a
    // quebra das linhas. Observa-se o elemento do pai, que é garantido funcionar.
    observador.observe(iframe)
    // Rede de segurança caso algum navegador não entregue o observador entre documentos.
    const temporizadores = [200, 700, 1800, 4000].map((ms) => window.setTimeout(medir, ms))

    desligarMedicaoRef.current = () => {
      observador.disconnect()
      doc.removeEventListener('load', aoMudar, true)
      doc.removeEventListener('error', aoMudar, true)
      temporizadores.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  useEffect(() => () => desligarMedicaoRef.current?.(), [])

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-border/70 bg-white shadow-sm">
        {documento !== null ? (
          <iframe
            ref={iframeRef}
            srcDoc={documento}
            onLoad={aoCarregarDocumento}
            /* SEM `allow-scripts`: é o que impede o e-mail de executar código.
               `allow-same-origin` deixa o leitor medir a altura; os `popups`
               fazem os links (`target=_blank`) abrirem, já fora do sandbox. */
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            className="block h-24 w-full"
            title="Conteúdo do email"
          />
        ) : textoExibido ? (
          <div className="whitespace-pre-wrap break-words p-5 text-sm leading-relaxed text-neutral-900">
            {textoExibido}
          </div>
        ) : (
          <div className="p-5 text-sm italic text-neutral-500">(sem conteúdo)</div>
        )}
      </div>

      {temCitado && (
        <button
          type="button"
          onClick={() => setMostrarCitado((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronsUpDown className="h-3 w-3" />
          {mostrarCitado ? 'Ocultar histórico citado' : 'Mostrar histórico citado'}
        </button>
      )}
    </div>
  )
}
