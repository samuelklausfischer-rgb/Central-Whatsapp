import { useCallback, useEffect, useState } from 'react'
import {
  processarRateio,
  insertRateioExecucao,
  fetchRateioHistorico,
  type RateioEmpresa,
  type RateioResultado,
  type RateioHistoricoItem,
} from '@/services/rateio/rateio-service'

export function useRateioUpload() {
  const [enviando, setEnviando] = useState(false)
  const [status, setStatus] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<RateioResultado | null>(null)

  const processar = useCallback(async (arquivo: File, empresa: RateioEmpresa) => {
    setEnviando(true)
    setErro(null)
    setResultado(null)
    setStatus('Processando planilha, aguarde...')
    try {
      const json = await processarRateio(arquivo, empresa)
      setResultado(json)
      setStatus('Rateio gerado com sucesso.')

      // Histórico é secundário ao resultado — se a gravação falhar, o usuário já
      // tem o resumo e o download na tela; só avisamos no console.
      try {
        await insertRateioExecucao({
          empresa,
          arquivo_nome: arquivo.name,
          total_variavel: json.resumo.total_variavel,
          total_encargos: json.resumo.total_encargos,
          total_geral: json.resumo.total_geral,
          totais_taxa: json.resumo.totais_taxa,
          n_unidades: json.resumo.n_unidades,
          total_exames: json.resumo.total_exames,
          n_pendencias: (json.pendencias || []).length,
          pendencias: json.pendencias || [],
          resultado_xlsx_nome: json.arquivo?.nome,
          resultado_xlsx_base64: json.arquivo?.base64,
        })
      } catch (histErr) {
        console.error('Falha ao gravar histórico do rateio:', (histErr as Error).message)
      }

      return json
    } catch (err) {
      setErro((err as Error).message)
      setStatus('')
      throw err
    } finally {
      setEnviando(false)
    }
  }, [])

  return { processar, enviando, status, erro, resultado }
}

export function useRateioHistorico(empresa: RateioEmpresa) {
  const [historico, setHistorico] = useState<RateioHistoricoItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  // Permite re-buscar (ex.: após gerar um novo rateio) sem recarregar a página.
  const refetch = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchRateioHistorico(empresa)
      .then((data) => {
        if (!cancelled) setHistorico(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [empresa, tick])

  return { historico, loading, error, refetch }
}
