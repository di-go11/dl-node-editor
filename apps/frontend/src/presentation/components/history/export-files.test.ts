import { afterEach, describe, expect, it, vi } from 'vitest'

import { chartSvgOf, svgToPngBlob } from './export-files'

/*
 * jsdom は画像を読み込まず、canvas も描けない。svgToPngBlob の手順(SVG を画像として読み、
 * 倍率をかけた canvas に描いて PNG にする)を、偽物の Image と canvas で確かめる。
 */

type FakeImageOptions = { readonly fail?: boolean }

function stubImage({ fail = false }: FakeImageOptions = {}) {
  const sources: string[] = []
  class FakeImage {
    width = 400
    height = 300
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(value: string) {
      sources.push(value)
      queueMicrotask(() => (fail ? this.onerror?.() : this.onload?.()))
    }
  }
  vi.stubGlobal('Image', FakeImage)
  return sources
}

function stubCanvas(context: Partial<CanvasRenderingContext2D> | null) {
  const png = new Blob(['png'], { type: 'image/png' })
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback, type?: string) => {
      callback(type === 'image/png' ? png : null)
    }),
  }
  const createElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
    tag === 'canvas' ? (canvas as unknown as HTMLCanvasElement) : createElement(tag),
  )
  return { canvas, png }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('svgToPngBlob', () => {
  it('SVG を 2 倍の大きさの canvas に描き、PNG にする', async () => {
    const sources = stubImage()
    const drawImage = vi.fn()
    const { canvas, png } = stubCanvas({ drawImage })

    const result = await svgToPngBlob(
      '<svg xmlns="http://www.w3.org/2000/svg"><text>loss の推移</text></svg>',
    )

    expect(result).toBe(png)
    expect([canvas.width, canvas.height]).toEqual([800, 600])
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 600)
    // 日本語を含む SVG も data URL として読める形にする
    expect(sources[0]).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(decodeURIComponent(sources[0]!.split(',')[1]!)).toContain('loss の推移')
  })

  it('SVG を読み込めなければ null', async () => {
    stubImage({ fail: true })
    stubCanvas({ drawImage: vi.fn() })
    expect(await svgToPngBlob('<svg/>')).toBeNull()
  })

  it('canvas に描けなければ null', async () => {
    stubImage()
    stubCanvas(null)
    expect(await svgToPngBlob('<svg/>')).toBeNull()
  })
})

describe('chartSvgOf', () => {
  /**
   * recharts 3 の loss のグラフと同じ並び: 凡例(印も svg.recharts-surface)がグラフ本体より前にある。
   * 以前は最初の svg.recharts-surface(凡例の印)を保存していたため、点のような小さな画像になった
   */
  function lossChartDom(): HTMLElement {
    const container = document.createElement('div')
    container.innerHTML = `
      <div class="recharts-wrapper">
        <div class="recharts-legend-wrapper">
          <ul>
            <li class="recharts-legend-item">
              <svg class="recharts-surface" width="14" height="14" style="display: inline-block">
                <path class="legend-icon" stroke="var(--color-accent)" d="M0,7h14" />
              </svg>
              <span class="recharts-legend-item-text" style="color: rgb(37, 99, 235)">train_loss</span>
            </li>
          </ul>
        </div>
        <svg class="recharts-surface" width="600" height="280">
          <path class="recharts-curve recharts-line-curve" stroke="var(--color-accent)" d="M0,0L10,10" />
        </svg>
      </div>`
    document.body.append(container)
    return container
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('凡例の印ではなく、グラフ本体の svg を保存する', () => {
    const svg = chartSvgOf(lossChartDom(), 'segnet の loss')
    expect(svg).toContain('recharts-line-curve')
    expect(svg).toContain('<title>segnet の loss</title>')
  })

  it('XML として読める(xmlns が重ならない)', () => {
    const svg = chartSvgOf(lossChartDom(), 'segnet の loss') ?? ''
    expect(svg.match(/xmlns="/g)).toHaveLength(1)
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    expect(doc.querySelector('parsererror')).toBeNull()
  })

  it('凡例の名前と印を svg の中に描き足す(HTML の凡例はファイルに残らないため)', () => {
    const svg = chartSvgOf(lossChartDom(), 'segnet の loss') ?? ''
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const legend = doc.querySelector('.recharts-legend-export')
    expect(legend?.querySelector('text')?.textContent).toBe('train_loss')
    expect(legend?.querySelector('text')?.getAttribute('fill')).toBe('rgb(37, 99, 235)')
    expect(legend?.querySelector('.legend-icon')).not.toBeNull()
  })

  it('グラフ本体がなく凡例だけなら null(描く前は保存できない)', () => {
    const container = lossChartDom()
    container.querySelector('.recharts-wrapper > svg')?.remove()
    expect(chartSvgOf(container, 'segnet の loss')).toBeNull()
  })
})
