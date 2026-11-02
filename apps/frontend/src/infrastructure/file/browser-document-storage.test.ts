import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import { createBrowserDocumentStorage } from './browser-document-storage'

/**
 * ブラウザの API(Blob、URL.createObjectURL、<a download>、<input type="file">)を
 * 使う実装のテスト。jsdom にない API(createObjectURL)と、実際には開けない
 * ファイル選択のダイアログは、テストの間だけ差し替える。
 */

describe('save(ダウンロード)', () => {
  let created: Blob[]
  let clicked: HTMLAnchorElement[]
  let revoke: Mock<(url: string) => void>

  beforeEach(() => {
    vi.useFakeTimers()
    created = []
    clicked = []
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob)
      return 'blob:fake-url'
    })
    revoke = vi.fn<(url: string) => void>()
    URL.revokeObjectURL = revoke
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('中身を Blob にし、ファイル名を付けた <a download> をクリックする', async () => {
    const result = await createBrowserDocumentStorage().save('segnet.json', '{"a":1}')

    expect(result).toEqual({ ok: true })
    expect(clicked).toHaveLength(1)
    expect(clicked[0]?.download).toBe('segnet.json')
    expect(clicked[0]?.href).toBe('blob:fake-url')
    expect(await created[0]?.text()).toBe('{"a":1}')
    // クリックに使った <a> はページに残さない
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('少し待ってから一時的な URL を解放する', async () => {
    await createBrowserDocumentStorage().save('x.json', '{}')
    expect(revoke).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:fake-url')
  })
})

describe('open(アップロード)', () => {
  let opened: HTMLInputElement[]

  beforeEach(() => {
    opened = []
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      opened.push(this)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** 利用者がファイルを選んだことにする */
  function choose(input: HTMLInputElement | undefined, files: File[]): void {
    if (input === undefined) throw new Error('ファイル選択が開かれていません')
    Object.defineProperty(input, 'files', { value: files })
    input.dispatchEvent(new Event('change'))
  }

  it('JSON のファイルを選ばせ、中身を読む', async () => {
    const promise = createBrowserDocumentStorage().open()
    expect(opened[0]?.type).toBe('file')
    expect(opened[0]?.accept).toContain('.json')

    choose(opened[0], [new File(['{"b":2}'], 'model.json', { type: 'application/json' })])
    expect(await promise).toEqual({
      kind: 'opened',
      file: { name: 'model.json', text: '{"b":2}' },
    })
  })

  it('ダイアログを閉じたらキャンセル', async () => {
    const promise = createBrowserDocumentStorage().open()
    opened[0]?.dispatchEvent(new Event('cancel'))
    expect(await promise).toEqual({ kind: 'cancelled' })
  })

  it('大きすぎるファイルは読まない', async () => {
    const promise = createBrowserDocumentStorage({ maxBytes: 4 }).open()
    choose(opened[0], [new File(['12345'], 'big.json')])
    const result = await promise
    expect(result.kind).toBe('failed')
  })
})
