/**
 * 学習の記録の画面で使う、ファイルの書き出し(ブラウザのダウンロード)。
 *
 * ダウンロードの手順は保存ファイル(infrastructure/file/browser-document-storage.ts)と同じ:
 * Blob を作り、一時的な URL を download 属性付きの <a> でクリックし、少し後に URL を解放する。
 */

/** 一時的な URL を解放するまでの待ち時間。すぐ解放すると、一部のブラウザでダウンロードが始まらない */
const REVOKE_DELAY_MS = 1000

export function downloadText(fileName: string, mimeType: string, text: string): void {
  downloadBlob(fileName, new Blob([text], { type: mimeType }))
}

export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}

/** ファイル名に使えない文字を _ にする(モデル名は英数字と - _ だが、念のため) */
export function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, '_')
}

/** 色を指定する属性。recharts は CSS 変数(var(--color-accent) など)で書いている */
const COLOR_ATTRIBUTES = ['stroke', 'fill', 'color', 'stop-color'] as const

const SVG_NS = 'http://www.w3.org/2000/svg'
const LEGEND_SELECTOR = '.recharts-legend-wrapper'

/**
 * グラフ本体の svg。recharts(3.x)は凡例の小さな印にも svg.recharts-surface を使い、凡例は DOM で
 * グラフ本体より前に来ることがある。最初の svg.recharts-surface を選ぶと凡例の印(16×16)を保存してしまうので、
 * 凡例の中の svg を除いて選ぶ
 */
function chartSurfaceOf(container: HTMLElement): SVGSVGElement | null {
  const surfaces = Array.from(container.querySelectorAll<SVGSVGElement>('svg.recharts-surface'))
  return surfaces.find((surface) => surface.closest(LEGEND_SELECTOR) === null) ?? null
}

/**
 * 凡例(HTML)の項目を、画面と同じ位置に svg の要素として描き足す。
 * 印は凡例の svg をそのまま写し、名前は <text> にする(色・大きさ・フォントは画面の計算済みの値)
 */
function appendLegend(svg: SVGSVGElement, source: SVGSVGElement, container: HTMLElement): void {
  const origin = source.getBoundingClientRect()
  const items = container.querySelectorAll(`${LEGEND_SELECTOR} .recharts-legend-item`)
  if (items.length === 0) return
  const group = document.createElementNS(SVG_NS, 'g')
  group.setAttribute('class', 'recharts-legend-export')
  for (const item of Array.from(items)) {
    const icon = item.querySelector('svg')
    if (icon !== null) {
      const rect = icon.getBoundingClientRect()
      const copy = icon.cloneNode(true) as SVGSVGElement
      copy.removeAttribute('style')
      copy.setAttribute('x', String(rect.left - origin.left))
      copy.setAttribute('y', String(rect.top - origin.top))
      group.append(copy)
    }
    const label = item.querySelector<HTMLElement>('.recharts-legend-item-text')
    if (label !== null) {
      const rect = label.getBoundingClientRect()
      const labelStyle = getComputedStyle(label)
      const text = document.createElementNS(SVG_NS, 'text')
      text.textContent = label.textContent
      text.setAttribute('x', String(rect.left - origin.left))
      // 文字の縦の中央に置く(HTML の行の箱と、svg の基準線の違いを吸収する)
      text.setAttribute('y', String(rect.top - origin.top + rect.height / 2))
      text.setAttribute('dominant-baseline', 'central')
      text.setAttribute('fill', labelStyle.color || 'currentColor')
      if (labelStyle.fontSize !== '') text.setAttribute('font-size', labelStyle.fontSize)
      if (labelStyle.fontFamily !== '') text.setAttribute('font-family', labelStyle.fontFamily)
      group.append(text)
    }
  }
  svg.append(group)
}

/** var(--name) / var(--name, 既定値) をページの値に置き換える */
function resolveCssVariables(value: string, style: CSSStyleDeclaration): string {
  return value.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g, (_, name: string, fallback?: string) => {
    const resolved = style.getPropertyValue(name).trim()
    return resolved !== '' ? resolved : (fallback?.trim() ?? '')
  })
}

/**
 * 画面に描いたグラフ(recharts の svg)を、単独で開ける SVG ファイルの文字列にする。
 *
 * 画面の svg をそのまま保存すると、次の理由で別のアプリでは見た目が変わる。ここで直す。
 *   - 色を CSS 変数で指定しているので、ページの外では色が付かない → ページの値に置き換える
 *   - 背景がない(ページの背景が透けている) → 背景の四角を足す
 *   - xmlns がないと、ブラウザ以外で SVG として読めないことがある → 付ける
 *   - 凡例(Legend)は svg の外の HTML なので、そのままでは線の名前が残らない → 画面の位置に描き足す
 * 文字はページのフォントで描かれているので、開く環境にそのフォントがなければ別のフォントになる。
 *
 * container の中にグラフ本体の svg がなければ null。
 */
export function chartSvgOf(container: HTMLElement, title: string): string | null {
  const source = chartSurfaceOf(container)
  if (source === null) return null

  const style = getComputedStyle(document.documentElement)
  const svg = source.cloneNode(true) as SVGSVGElement
  appendLegend(svg, source, container)
  for (const element of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
    for (const attribute of COLOR_ATTRIBUTES) {
      const value = element.getAttribute(attribute)
      if (value?.includes('var(') === true) {
        element.setAttribute(attribute, resolveCssVariables(value, style))
      }
    }
    const inline = element.getAttribute('style')
    if (inline?.includes('var(') === true) {
      element.setAttribute('style', resolveCssVariables(inline, style))
    }
  }

  const { width, height } = source.getBoundingClientRect()
  // 名前空間の宣言として付ける。setAttribute('xmlns') だと、XMLSerializer が自分で付ける xmlns と
  // 重なって同じ属性が 2 つになり、XML として読めない(PNG への変換で画像として読み込めない)ことがある
  svg.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns', SVG_NS)
  svg.setAttribute('width', String(Math.round(width)))
  svg.setAttribute('height', String(Math.round(height)))
  if (!svg.hasAttribute('viewBox')) {
    svg.setAttribute('viewBox', `0 0 ${Math.round(width)} ${Math.round(height)}`)
  }

  // 背景はページの背景色(ダークテーマでも文字が読める色の組み合わせのまま保存する)
  const background = getComputedStyle(document.body).backgroundColor
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  rect.setAttribute('width', '100%')
  rect.setAttribute('height', '100%')
  rect.setAttribute('fill', background === '' || background === 'rgba(0, 0, 0, 0)' ? '#ffffff' : background)
  svg.insertBefore(rect, svg.firstChild)

  const titleElement = document.createElementNS('http://www.w3.org/2000/svg', 'title')
  titleElement.textContent = title
  svg.insertBefore(titleElement, svg.firstChild)

  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}\n`
}

/** PNG の解像度の倍率。画面の大きさのままだと、スライドや論文に貼ったときに粗く見える */
const PNG_SCALE = 2

/**
 * chartSvgOf で作った SVG を PNG にする。SVG を画像として読み込み、canvas に描いて書き出す。
 *
 * SVG には背景の四角と、ページの値に置き換えた色が入っているので、PNG でも画面と同じ見た目になる。
 * 文字はこのブラウザのフォントで描かれる(SVG と違い、開く環境のフォントには左右されない)。
 * 読み込み・描画に失敗したら null。
 */
export function svgToPngBlob(svg: string, scale: number = PNG_SCALE): Promise<Blob | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext('2d')
      if (context === null) {
        resolve(null)
        return
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    }
    image.onerror = () => resolve(null)
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}
