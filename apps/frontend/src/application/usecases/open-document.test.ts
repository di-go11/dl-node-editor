// @vitest-environment node
import { describe, expect, it } from 'vitest'

import exampleRaw from '../../../../backend/ai-engine/modelconfigs/test_segnet_dag.json?raw'
import { serializeDocument } from '../../entity/document/build'
import { emptyEditorDocument } from '../../entity/document/document'
import { GRAPH_INPUT_NODE, GRAPH_OUTPUT_NODE } from '../../entity/graph-editing/endpoint'
import { validSegnetGraph } from '../../entity/validation/test-fixtures'
import type { DocumentStorage, OpenFileResult } from '../ports/document-storage'

import { openDocument } from './open-document'

const storageReturning = (result: OpenFileResult): DocumentStorage => ({
  save: () => Promise.resolve({ ok: true }),
  open: () => Promise.resolve(result),
})

const opened = (name: string, text: string): OpenFileResult => ({
  kind: 'opened',
  file: { name, text },
})

describe('openDocument', () => {
  it('キャンセルと読み込みの失敗は、そのまま返す', async () => {
    expect(await openDocument({ storage: storageReturning({ kind: 'cancelled' }) })).toEqual({
      kind: 'cancelled',
    })
    expect(
      await openDocument({ storage: storageReturning({ kind: 'failed', message: '読めません' }) }),
    ).toEqual({ kind: 'failed', message: '読めません' })
  })

  it('保存ファイルを開く。座標がそろっていれば、そのまま使う', async () => {
    const document = {
      ...emptyEditorDocument('segnet'),
      graph: validSegnetGraph(),
      layout: {
        positions: new Map([
          [GRAPH_INPUT_NODE, { x: 0, y: 0 }],
          ['conv1', { x: 11, y: 22 }],
          ['relu1', { x: 1, y: 1 }],
          ['bn1', { x: 2, y: 2 }],
          ['pool1', { x: 3, y: 3 }],
          ['unpool1', { x: 4, y: 4 }],
          ['out_conv', { x: 5, y: 5 }],
          [GRAPH_OUTPUT_NODE, { x: 6, y: 6 }],
        ]),
        viewport: null,
      },
    }
    const text = serializeDocument(document, new Date(0))
    const result = await openDocument({ storage: storageReturning(opened('segnet.json', text)) })

    if (result.kind !== 'opened') throw new Error(result.kind)
    expect(result.source).toBe('document')
    expect(result.document.layout.positions.get('conv1')).toEqual({ x: 11, y: 22 })
  })

  it('C++ の設定ファイルを開き、座標を自動で補う', async () => {
    const result = await openDocument({
      storage: storageReturning(opened('test_segnet_dag.json', exampleRaw)),
    })
    if (result.kind !== 'opened') throw new Error(result.kind)
    expect(result.source).toBe('training-config')
    expect(result.document.layout.positions.size).toBe(8) // 6 ノード + Input + Output
  })

  it('不正なファイルは、ファイル名と「どこがおかしいか」を返す', async () => {
    const result = await openDocument({
      storage: storageReturning(opened('broken.json', '{"format": "model-editor-document"}')),
    })
    if (result.kind !== 'invalid') throw new Error(result.kind)
    expect(result.fileName).toBe('broken.json')
    expect(result.issues.length).toBeGreaterThan(0)
  })
})
