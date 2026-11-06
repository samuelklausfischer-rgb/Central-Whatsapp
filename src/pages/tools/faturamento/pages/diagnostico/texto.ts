export { nomeExibicao } from '../../lib/format'
export const semAcentoMin = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
