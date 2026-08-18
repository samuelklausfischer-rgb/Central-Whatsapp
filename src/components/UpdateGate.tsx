import { useEffect, useRef, useState } from 'react'
import { AuthShell } from '@/components/auth/AuthShell'
import { UpdatePanel } from '@/components/UpdatePanel'
import { useUpdater } from '@/hooks/use-updater'

/**
 * Tela de atualização exibida ANTES do login (só no Electron).
 * Ao abrir o app: checa update; se houver, baixa mostrando progresso e EXIGE
 * instalar antes de liberar o login. Sem update / offline / erro → libera.
 *
 * Piso de 5s: mesmo que a checagem responda em milissegundos, o painel de
 * "Verificando…" fica visível por pelo menos 5s (pedido explícito — evita um
 * pisca-pisca de splash para quem tem update já em dia). Isso é só um atraso
 * de UI: não atrasa a checagem real nem o download, que seguem seu curso.
 */
export function UpdateGate({ children }: { children: React.ReactNode }) {
  const { isElectron, status, version, checkForUpdates, installUpdate } = useUpdater()
  const [released, setReleased] = useState(!isElectron)
  const [pisoCumprido, setPisoCumprido] = useState(false)
  const [resolvido, setResolvido] = useState(false)
  const [progressoDaVerificacao, setProgressoDaVerificacao] = useState(0)
  const startedRef = useRef(false)
  const statusRef = useRef(status)
  statusRef.current = status

  // Dispara a checagem imediatamente ao montar (não espera os 4s do main).
  useEffect(() => {
    if (!isElectron || startedRef.current) return
    startedRef.current = true
    checkForUpdates()
  }, [isElectron, checkForUpdates])

  // Piso de 5s: um tick alimenta o anel de progresso (0→100 ao longo de 5s) e
  // um timeout separado marca `pisoCumprido`. Os dois nascem juntos no mount
  // e são limpos no unmount — não há setInterval órfão sobrevivendo à troca
  // de tela.
  useEffect(() => {
    if (!isElectron) return
    const inicio = Date.now()
    const tick = setInterval(() => {
      const decorrido = Date.now() - inicio
      setProgressoDaVerificacao(Math.min(100, (decorrido / 5000) * 100))
    }, 50)
    const piso = setTimeout(() => {
      setPisoCumprido(true)
      setProgressoDaVerificacao(100)
    }, 5000)
    return () => {
      clearInterval(tick)
      clearTimeout(piso)
    }
  }, [isElectron])

  // Latch de "a checagem terminou e não há update para instalar". Precisa ser
  // um latch, e não uma leitura de `status` ao vivo, porque o `useUpdater`
  // devolve o status para `idle` 4s depois de resolver (use-updater.ts:31-33).
  // Esse reset era inofensivo enquanto a tela liberava na hora; com o piso de
  // 5s ele passa a atropelar: uma checagem que responde em menos de 1s viraria
  // `idle` de novo ANTES do piso, a liberação não encontraria mais
  // `up-to-date`, e a tela só cairia na rede de segurança de 10s — dez
  // segundos de "Verificando…" em toda abertura de app já atualizado com rede
  // rápida. Uma vez resolvido, fica resolvido.
  useEffect(() => {
    if (status.type === 'up-to-date' || status.type === 'error') setResolvido(true)
  }, [status])

  // Libera quando a checagem resolveu sem update (ou o updater falhou — não dá
  // pra travar por infra quebrada) E o piso de 5s já passou. Qual das duas
  // condições chega por último não importa: as duas estão nas deps.
  useEffect(() => {
    if (released) return
    if (pisoCumprido && resolvido) setReleased(true)
  }, [released, pisoCumprido, resolvido])

  // Rede de segurança: se ficar preso em idle/checking (offline/sem resposta),
  // libera após 10s — mas NÃO libera se um update já está em andamento.
  // 10s > piso de 5s, então não há conflito entre as duas liberações.
  useEffect(() => {
    if (!isElectron) return
    const t = setTimeout(() => {
      const s = statusRef.current.type
      if (s !== 'available' && s !== 'downloading' && s !== 'ready') setReleased(true)
    }, 10000)
    return () => clearTimeout(t)
  }, [isElectron])

  return (
    <>
      {/*
        `children` fica montado SEMPRE, inclusive durante o splash — é o que faz
        o piso de 5s ser tempo aproveitado em vez de tempo somado. O AuthProvider
        está aí dentro: montado junto, ele resolve a sessão persistida do Supabase
        durante os 5 segundos, e quem já está logado cai no dashboard no instante
        em que o piso termina. A versão anterior fazia `if (released) return
        children`, então o bootstrap da sessão só COMEÇAVA depois do splash sair —
        os 5s viravam 6-7s até o app ficar usável.

        `inert` enquanto o splash está visível: sem ele o app de baixo continua
        alcançável por Tab e por leitor de tela mesmo coberto pelo overlay, e o
        usuário conseguiria digitar num formulário que não está vendo. O atributo
        resolve foco, clique e árvore de acessibilidade de uma vez (React 19 passa
        o boolean direto, e o Chromium do Electron 42 suporta nativamente).
      */}
      {/* `contents` para este wrapper não gerar caixa e o layout do app ficar
          idêntico ao de antes (havia cadeias de `h-full` contando com o pai
          original). O `inert` continua valendo para a subárvore mesmo assim. */}
      <div className="contents" inert={!released}>
        {children}
      </div>

      {!released && (
        // AuthShell sozinho usa `min-h-screen` (pensado para ocupar a página).
        // Aqui ele é um overlay por cima do app já montado, então o contêiner
        // externo precisa do `fixed inset-0 z-50` que a tela antiga já tinha.
        <div className="fixed inset-0 z-50">
          <AuthShell>
            <UpdatePanel
              status={status}
              version={version}
              progressoDaVerificacao={progressoDaVerificacao}
              onInstall={installUpdate}
            />
          </AuthShell>
        </div>
      )}
    </>
  )
}
