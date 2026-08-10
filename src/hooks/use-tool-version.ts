import { useEffect, useRef, useState } from 'react'

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000

interface UseToolVersionOptions {
  /** URL do app publicado (a mesma que monta o iframe). */
  baseUrl: string
  /** Intervalo entre checagens depois da inicial. Default: 5 minutos. */
  intervalMs?: number
}

/**
 * Detecta troca de versão do app embutido, consultando `<origin>/version.json`
 * no mount e depois em intervalo.
 *
 * DEGRADAÇÃO SILENCIOSA é requisito, não detalhe: a ferramenta externa pode
 * ainda não servir esse arquivo (mudança combinada, mas pendente, em OUTRO
 * repositório). 404, erro de rede, CORS e JSON inválido são tratados do mesmo
 * jeito — o recurso simplesmente fica desligado, sem banner, sem toast e sem
 * poluir o console a cada ciclo. Nada aqui pode piorar o estado atual do
 * ToolFrame.
 *
 * A primeira versão respondida vira a REFERÊNCIA (não necessariamente "a
 * versão rodando no iframe agora" — o iframe pode ter carregado um instante
 * antes do deploy novo subir; a diferença se resolve sozinha no próximo ciclo
 * de qualquer forma, e o pior caso é um aviso a mais, nunca a menos).
 */
export function useToolVersion({ baseUrl, intervalMs = DEFAULT_INTERVAL_MS }: UseToolVersionOptions) {
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)

  // Refs, não state: mudam a cada checagem e não devem re-disparar o efeito
  // nem re-renderizar o componente sozinhos — só `updateVersion` renderiza.
  const referenceRef = useRef<string | null>(null)
  const dismissedRef = useRef<string | null>(null)

  useEffect(() => {
    // Troca de baseUrl (config/ambiente mudou) reseta tudo — a referência
    // antiga não diz nada sobre o app novo.
    referenceRef.current = null
    dismissedRef.current = null
    setUpdateVersion(null)

    const trimmed = baseUrl.trim()
    if (!trimmed) return

    let versionUrl: string
    try {
      // Raiz da origem, não relativo ao path da baseUrl: `buildEmbedUrl` já
      // mostra que a env pode trazer path e query próprios (ex.: `/relatorios
      // ?tenant=prn`), e resolver 'version.json' contra isso com URL relativa
      // apagaria o último segmento do path em vez de ficar na raiz. Contrato
      // combinado com o outro time é sempre `<origin>/version.json`.
      versionUrl = `${new URL(trimmed).origin}/version.json`
    } catch {
      return
    }

    let cancelled = false

    /**
     * Desiste depois de N falhas seguidas — e isto é o que torna a "degradação
     * silenciosa" verdadeira de fato.
     *
     * O `try/catch` abaixo captura a exceção do `fetch`, mas NÃO impede o
     * navegador de escrever o erro de CORS/rede no console: esse log é do
     * próprio navegador, anterior ao JavaScript, e nenhum código consegue
     * suprimi-lo. Sem este limite, um app que ainda não serve `version.json`
     * (o caso de hoje — a mudança no outro repositório está pendente) geraria
     * um erro vermelho no console e uma requisição falha na aba de rede a cada
     * ciclo, para sempre, em toda sessão. Três tentativas bastam para
     * distinguir indisponibilidade real de uma oscilação de rede.
     *
     * O custo de desistir: se a ferramenta externa passar a servir o arquivo
     * com a aba já aberta, a detecção só volta no próximo carregamento da
     * página. É barato perto de poluir o console de todo mundo — e some assim
     * que o `version.json` existir na primeira checagem.
     */
    const MAX_FALHAS_SEGUIDAS = 3
    let falhasSeguidas = 0
    let id = 0

    const desistir = () => {
      if (id) window.clearInterval(id)
      id = 0
    }

    const check = async () => {
      // Aba em segundo plano: não faz sentido gastar a checagem.
      if (document.hidden) return
      try {
        const resp = await fetch(versionUrl, { cache: 'no-store' })
        if (!resp.ok) {
          // Inclui 404: a ferramenta ainda não serve o arquivo.
          if (++falhasSeguidas >= MAX_FALHAS_SEGUIDAS) desistir()
          return
        }
        const data = await resp.json().catch(() => null)
        const version = typeof data?.version === 'string' && data.version.trim() ? data.version.trim() : null
        if (!version) {
          // Respondeu, mas sem contrato: conta como falha para não ficar
          // consultando eternamente um endpoint que devolve outra coisa.
          if (++falhasSeguidas >= MAX_FALHAS_SEGUIDAS) desistir()
          return
        }
        if (cancelled) return
        falhasSeguidas = 0

        if (referenceRef.current === null) {
          referenceRef.current = version
          return
        }
        if (version === referenceRef.current) return
        if (version === dismissedRef.current) return // já dispensada — não insiste na mesma
        setUpdateVersion(version)
      } catch {
        // Rede, CORS, DNS: sem log próprio — ver o comentário do topo.
        if (++falhasSeguidas >= MAX_FALHAS_SEGUIDAS) desistir()
      }
    }

    check()
    id = window.setInterval(check, intervalMs)
    return () => {
      cancelled = true
      desistir()
    }
  }, [baseUrl, intervalMs])

  /** O usuário dispensou a faixa: não reaparecer para ESTA versão. */
  const dismiss = () => {
    if (updateVersion) dismissedRef.current = updateVersion
    setUpdateVersion(null)
  }

  /** O iframe recarregou nessa versão: ela vira a nova referência. */
  const applied = (version: string) => {
    referenceRef.current = version
    dismissedRef.current = null
    setUpdateVersion(null)
  }

  return { updateVersion, dismiss, applied }
}
