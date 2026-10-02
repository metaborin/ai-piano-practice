import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/** Ship PDF.js fonts/CMaps/codecs locally under Vite's base, with no CDN requests. */
export function pdfAssets(): Plugin {
  const assets = new Map<string, { data: Buffer; mime: string }>()
  for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
    const directory = new URL(`./node_modules/pdfjs-dist/${folder}/`, import.meta.url)
    for (const file of readdirSync(fileURLToPath(directory))) {
      assets.set(`pdfjs/${folder}/${file}`, { data: readFileSync(new URL(file, directory)),
        mime: file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' })
    }
  }
  return {
    name: 'local-pdf-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? '').split('?')[0]
        const path = pathname.startsWith(server.config.base) ? pathname.slice(server.config.base.length) : pathname.replace(/^\//, '')
        const file = assets.get(path)
        if (!file) return next()
        response.setHeader('Content-Type', file.mime); response.end(file.data)
      })
    },
    generateBundle() { for (const [fileName, file] of assets) this.emitFile({ type: 'asset', fileName, source: file.data }) },
  }
}
