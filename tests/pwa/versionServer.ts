import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readFile, readdir, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { generateSW } from 'workbox-build'
import { pwaOptions, APP_BASE } from '../../pwa.config'

/** Local two-release server. Never changes dist, the preview server or GitHub Pages. */
export async function versionServer() {
  const temp = await mkdtemp(join(tmpdir(), 'piano-pwa-'))
  const files = new Map<string, Buffer>()
  const collect = async (root: string, relative = '') => {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      const name = relative + entry.name
      if (entry.isDirectory()) await collect(root, name + '/')
      else files.set(name, await readFile(join(root, name)))
    }
  }
  await collect(resolve('dist'))
  const workers: Buffer[] = []
  for (const version of ['old', 'new']) {
    const folder = join(temp, version); await mkdir(folder)
    await generateSW({ ...pwaOptions.workbox, globDirectory: resolve('dist'), globIgnores: ['sw.js', 'workbox-*.js'], swDest: join(folder, 'sw.js'), additionalManifestEntries: [{ url: `${version}-release.txt`, revision: version }], mode: 'production' })
    workers.push(await readFile(join(folder, 'sw.js')))
    for (const file of await readdir(folder)) if (file.startsWith('workbox-')) files.set(file, await readFile(join(folder, file)))
    files.set(`${version}-release.txt`, Buffer.from(version))
  }
  let current = 0
  const server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname
    if (!path.startsWith(APP_BASE)) { response.writeHead(404).end(); return }
    const key = path.slice(APP_BASE.length) || 'index.html'
    const body = key === 'sw.js' ? workers[current] : files.get(key)
    if (!body) { response.writeHead(404).end(); return }
    const type = /\.(m?js)$/.test(key) ? 'text/javascript' : key.endsWith('.css') ? 'text/css' : key.endsWith('.html') ? 'text/html' : key.endsWith('.webmanifest') ? 'application/manifest+json' : key.endsWith('.png') ? 'image/png' : key.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(body)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}${APP_BASE}`,
    publish: () => { current = 1 },
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      // mkdtemp is an isolated test-owned directory; no user files are touched.
      if (dirname(resolve(temp)) !== resolve(tmpdir()) || !basename(temp).startsWith('piano-pwa-')) throw new Error('Unexpected temporary directory')
      await rm(temp, { recursive: true })
    },
  }
}
