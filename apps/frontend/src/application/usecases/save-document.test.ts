// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { emptyEditorDocument } from '../../entity/document/document'
import { parseDocumentText } from '../../entity/document/parse'
import { validSegnetGraph } from '../../entity/validation/test-fixtures'
import type { DocumentStorage, SaveFileResult } from '../ports/document-storage'

import { documentFileName, saveDocument } from './save-document'

/** 保存された内容を記録するだけの、偽物の保存先 */
function fakeStorage(result: SaveFileResult = { ok: true }) {
  const saved: { fileName: string; text: string }[] = []
  const storage: DocumentStorage = {
    save: (fileName, text) => {
      saved.push({ fileName, text })
      return Promise.resolve(result)
    },
    open: () => Promise.resolve({ kind: 'cancelled' }),
  }
  return { storage, saved }
}

const NOW = new Date('2026-10-23T12:34:56.000Z')

describe('saveDocument', () => {
  it('保存ファイルの文字列を作り、<名前>.json として保存先に渡す', async () => {
    const { storage, saved } = fakeStorage()
    const document = { ...emptyEditorDocument('segnet'), graph: validSegnetGraph() }

    const result = await saveDocument({ storage, now: () => NOW }, document)

    expect(result).toEqual({
      ok: true,
      fileName: 'segnet.json',
      savedAt: '2026-10-23T12:34:56.000Z',
    })
    expect(saved).toHaveLength(1)
    // 保存した中身は、そのまま読み直せる正しい保存ファイルである
    const reparsed = parseDocumentText(saved[0]?.text ?? '')
    expect(reparsed.ok && reparsed.document.graph).toEqual(document.graph)
    expect(reparsed.ok && reparsed.document.meta.savedAt).toBe('2026-10-23T12:34:56.000Z')
  })

  it('保存先が失敗したら、理由をそのまま返す', async () => {
    const { storage } = fakeStorage({ ok: false, message: 'ディスクがいっぱいです' })
    const result = await saveDocument({ storage, now: () => NOW }, emptyEditorDocument())
    expect(result).toEqual({ ok: false, message: 'ディスクがいっぱいです' })
  })
})

describe('documentFileName', () => {
  it.each([
    ['segnet', 'segnet.json'],
    ['  unet  ', 'unet.json'],
    ['a/b:c*d?', 'a_b_c_d_.json'],
    ['画像分類', '画像分類.json'],
    ['', 'untitled.json'],
  ])('%j → %j', (name, expected) => {
    expect(documentFileName(name)).toBe(expected)
  })
})
