/**
 * As três marcas do grupo e os dados que entram na assinatura por padrão.
 *
 * Só METADADOS moram aqui. Logo, versão em negativo, esfera e painel são
 * imagens em base64 e vivem em `public/assinaturas/assets.json`, carregado sob
 * demanda por `assets.ts` — ver o comentário lá sobre por que precisam
 * continuar em base64.
 */

export type ChaveMarca = 'prn-diagnosticos' | 'medimagem' | 'prn-locacao'

export interface Marca {
  /** Como a marca aparece no seletor. */
  rotulo: string
  /** Como a marca aparece na própria assinatura, ao lado do cargo. */
  nome: string
  /**
   * Proporção largura/altura do logotipo. A altura é sempre derivada
   * (`largura / rz`) para o logo nunca distorcer, seja qual for o conceito.
   */
  rz: number
  site: string
  siteUrl: string
  endereco: string
  telefone: string
  /** Domínio usado para sugerir `nome.sobrenome@...`. */
  emailDom: string
}

export const MARCAS: Record<ChaveMarca, Marca> = {
  'prn-diagnosticos': {
    rotulo: 'PRN Diagnósticos',
    nome: 'PRN Diagnósticos',
    rz: 2.332179930795848,
    site: 'prndiagnosticos.com.br',
    siteUrl: 'https://prndiagnosticos.com.br',
    endereco: 'R. Xavier Arp, s/n — Boa Vista, Joinville/SC',
    telefone: '47 99137-8313',
    emailDom: 'prndiagnosticos.com.br',
  },
  medimagem: {
    rotulo: 'MedImagem',
    nome: 'MedImagem',
    rz: 3.7904761904761903,
    site: 'clinicamedimagem.com',
    siteUrl: 'https://www.clinicamedimagem.com',
    endereco: 'Av. Santa Catarina, 1211 — Tabuleiro, Camboriú/SC',
    telefone: '47 99112-0419',
    emailDom: 'clinicamedimagem.com',
  },
  'prn-locacao': {
    rotulo: 'PRN Locação',
    nome: 'PRN Locação e Gestão',
    rz: 2.332179930795848,
    site: '',
    siteUrl: '',
    endereco: '',
    telefone: '47 99112-0419',
    emailDom: 'hotmail.com',
  },
}

export const CHAVES_MARCA = Object.keys(MARCAS) as ChaveMarca[]

/** Apelidos aceitos na aba de lote, onde a marca é digitada à mão. */
export const APELIDOS_MARCA: Record<string, ChaveMarca> = {
  prn: 'prn-diagnosticos',
  diagnosticos: 'prn-diagnosticos',
  med: 'medimagem',
  medimagem: 'medimagem',
  locacao: 'prn-locacao',
}

export type ChaveConceito = 'vidro' | 'aurora' | 'varredura' | 'editorial' | 'noturno'

export const CONCEITOS: { chave: ChaveConceito; rotulo: string; descricao: string }[] = [
  { chave: 'vidro', rotulo: 'Vidro', descricao: 'Painel translúcido sobre gradiente noturno — o escolhido' },
  { chave: 'aurora', rotulo: 'Aurora', descricao: 'Cartão com painel de gradiente e a marca em negativo' },
  { chave: 'varredura', rotulo: 'Varredura', descricao: 'Faixa de exame com a esfera no centro dos anéis' },
  { chave: 'editorial', rotulo: 'Editorial', descricao: 'Nome em corpo grande, dados em três colunas' },
  { chave: 'noturno', rotulo: 'Noturno', descricao: 'Bloco escuro inteiro, tipografia invertida' },
]
