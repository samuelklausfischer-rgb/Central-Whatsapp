/**
 * A "versão clicável": a assinatura como texto de verdade, em tabela HTML.
 *
 * Troca fidelidade por função. O telefone, o e-mail e o site viram links e o
 * texto pode ser selecionado e lido por leitor de tela — em compensação some a
 * sombra do cartão e a Poppins, porque o Outlook não carrega fonte externa e
 * ignora boa parte do CSS. O painel da esquerda vira uma imagem pronta
 * (`painelVidro`) justamente porque gradiente com clip não sobrevive lá.
 *
 * Layout em `<table>` com estilos repetidos em atributo e em `style` de
 * propósito: é o formato que o Outlook do Windows entende.
 */

import { esc, itensDe, legendaDe, marcaDe, type DadosAssinatura } from './comuns'
import type { AssetsAssinatura } from './assets'

/** Pilha de fontes seguras: nada de webfont, o Outlook não busca. */
const FE = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

export function htmlClicavel(d: DadosAssinatura, a: AssetsAssinatura): string {
  const m = marcaDe(d)
  const img = a.imagens[d.marca]
  const ICB = a.icones.escuro

  const linhas = itensDe(d, m)
    .map(([k, txt, href]) => {
      const cor = k === 'pin' ? '#AFCCF6' : '#E4EDFA'
      const c = href
        ? `<a href="${href}" style="color:${cor};text-decoration:none;">${esc(txt)}</a>`
        : esc(txt)
      return `<tr><td valign="middle" style="padding:0 11px 6px 0;line-height:0;font-size:0;">
      <img src="${ICB[k]}" width="13" height="13" alt=""
        style="display:block;width:13px;height:13px;border:0;"></td>
      <td valign="middle" style="padding:0 0 6px 0;font-family:${FE};font-size:13px;
        line-height:17px;color:${cor};">${c}</td></tr>`
    })
    .join('')

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"
   bgcolor="#031545" style="border-collapse:collapse;background:#031545;border-radius:18px;
   overflow:hidden;">
 <tr>
  <td width="218" valign="top" bgcolor="#01143C"
      style="width:218px;background:#01143C;line-height:0;font-size:0;">
   <img src="${img.painelVidro}" width="218" height="186" alt="${esc(m.nome)}"
     style="display:block;width:218px;height:186px;border:0;"></td>
  <td valign="middle" bgcolor="#031545" style="padding:22px 28px;background:#031545;">
   <div style="font-family:${FE};font-size:19px;line-height:24px;font-weight:600;
     color:#FFFFFF;letter-spacing:-.3px;">${esc(d.nome)}</div>
   <div style="font-family:${FE};font-size:10px;line-height:14px;color:#AFCCF6;
     letter-spacing:1.5px;padding:6px 0 11px;">${esc(legendaDe(d, m))}</div>
   <table role="presentation" cellpadding="0" cellspacing="0" border="0"
     style="border-collapse:collapse;margin-bottom:12px;"><tr>
     <td width="20" height="2" bgcolor="#5E9BF0"
       style="width:20px;height:2px;line-height:2px;font-size:0;">&nbsp;</td>
     <td width="14" height="2" bgcolor="#C8194B"
       style="width:14px;height:2px;line-height:2px;font-size:0;">&nbsp;</td>
   </tr></table>
   <table role="presentation" cellpadding="0" cellspacing="0" border="0"
     style="border-collapse:collapse;">${linhas}</table></td>
 </tr></table>`
}

/** A assinatura como imagem — o que "Copiar assinatura" põe no e-mail. */
export function htmlDaImagem(dataUrl: string, largura: number, d: DadosAssinatura, nomeMarca: string): string {
  return `<img src="${dataUrl}" width="${largura}" alt="${esc(d.nome)} — ${esc(nomeMarca)}"
    style="display:block;width:${largura}px;max-width:100%;border:0;">`
}
