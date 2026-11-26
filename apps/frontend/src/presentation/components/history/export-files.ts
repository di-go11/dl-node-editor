/**
 * 学習の記録の画面で使う、ファイルの書き出し(ブラウザのダウンロード)。
 *
 * ダウンロードの手順は保存ファイル(infrastructure/file/browser-document-storage.ts)と同じ:
 * Blob を作り、一時的な URL を download 属性付きの <a> でクリックし、少し後に URL を解放する。
 */

/** 一時的な URL を解放するまでの待ち時間。すぐ解放すると、一部のブラウザでダウンロードが始まらない */
const REVOKE_DELAY_MS = 1000

export function downloadText(fileName: string, mimeType: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }))
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
 * 文字はページのフォントで描かれているので、開く環境にそのフォントがなければ別のフォントになる。
 *
 * container の中に svg がなければ null。
 */
export function chartSvgOf(container: HTMLElement, title: string): string | null {
  // recharts は凡例(Legend)にも小さな svg を使うので、グラフ本体(recharts-surface)を選ぶ
  const source =
    container.querySelector<SVGSVGElement>('svg.recharts-surface') ??
    container.querySelector<SVGSVGElement>('svg')
  if (source === null) return null

  const style = getComputedStyle(document.documentElement)
  const svg = source.cloneNode(true) as SVGSVGElement
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
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
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
