import type { OverviewSize } from './OverviewGeometry'

/** Static copy of already engraved SVG pages. No second OSMD, cursor, live SVG
 * IDs, note highlighting or score parsing. Used only once per selected score. */
export function createScoreOverviewImage(host: HTMLElement): OverviewSize & { url: string } {
  const box = host.getBoundingClientRect()
  const width = Math.max(host.scrollWidth, box.width), height = Math.max(host.scrollHeight, box.height)
  const pages = [...host.querySelectorAll('svg')].filter(svg => !svg.parentElement?.closest('svg'))
  if (!pages.length || width <= 0 || height <= 0) throw new Error('No rendered score pages')
  const ns = 'http://www.w3.org/2000/svg'
  const image = document.createElementNS(ns, 'svg')
  image.setAttribute('width', String(width)); image.setAttribute('height', String(height))
  image.setAttribute('viewBox', `0 0 ${width} ${height}`)
  for (const page of pages) {
    const bounds = page.getBoundingClientRect(), copy = page.cloneNode(true) as SVGSVGElement
    copy.setAttribute('x', String(bounds.left - box.left)); copy.setAttribute('y', String(bounds.top - box.top))
    copy.setAttribute('width', String(bounds.width)); copy.setAttribute('height', String(bounds.height))
    // The image cannot receive events; omit any links/foreign DOM from imports.
    copy.querySelectorAll('script, foreignObject, image').forEach(node => node.remove())
    copy.querySelectorAll('[data-missing-note]').forEach(node => {
      node.removeAttribute('style'); node.querySelectorAll('[style]').forEach(child => child.removeAttribute('style'))
    })
    image.append(copy)
  }
  return { width, height, url: URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(image)], { type: 'image/svg+xml' })) }
}
