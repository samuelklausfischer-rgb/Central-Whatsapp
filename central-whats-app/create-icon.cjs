/**
 * Copia public/logo.png para central-whats-app/icon.png
 * electron-builder converte PNG → ICO automaticamente no Windows
 */
const fs = require('fs')
const path = require('path')

const src = path.join(__dirname, '../public/logo.png')
const out = path.join(__dirname, 'icon.png')
fs.copyFileSync(src, out)
console.log(`icon.png copiado de logo.png → ${out}`)
