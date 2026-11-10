// @vitest-environment node
import { describe, expect, it } from 'vitest'

import exampleRaw from '../../../../backend/ai-engine/modelconfigs/test_segnet_dag.json?raw'
import type { ModelGraph } from '../model-graph/model-graph'
import { startTrainingRequestJsonSchema } from '../training/proto-json/schema'
import { fromStartTrainingRequestJson } from '../training/proto-json/convert'
import { validSegnetGraph } from '../validation/test-fixtures'

import { buildDocumentJson, serializeDocument } from './build'
import type { EditorDocument } from './document'
import { DOCUMENT_FORMAT, emptyEditorDocument } from './document'
import type { RawDocument } from './migrate'
import { parseDocument, parseDocumentText } from './parse'

const SAVED_AT = new Date('2026-10-22T10:00:00.000Z')

/** test_segnet_dag.json からモデル構造と学習設定を取り出す */
function segnetExample(): ReturnType<typeof fromStartTrainingRequestJson> {
  return fromStartTrainingRequestJson(startTrainingRequestJsonSchema.parse(JSON.parse(exampleRaw)))
}

/** 座標・表示範囲・学習設定のすべてを持つ文書 */
function fullDocument(): EditorDocument {
  const { graph, settings } = segnetExample()
  return {
    meta: { name: 'segnet', savedAt: SAVED_AT.toISOString() },
    context: { dataDim: '2d', method: 'cnn' },
    graph,
    layout: {
      positions: new Map([
        ['__input__', { x: 0, y: 80 }],
        ['conv1', { x: 120, y: 80 }],
        ['relu1', { x: 240, y: 80.5 }],
        ['__output__', { x: 900, y: 80 }],
      ]),
      viewport: { x: -10, y: 20, zoom: 1.25 },
    },
    training: settings,
  }
}

/** 保存して、読み込み直す */
function roundTrip(document: EditorDocument): EditorDocument {
  const result = parseDocumentText(serializeDocument(document, SAVED_AT))
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2))
  return result.document
}

const codesOf = (result: ReturnType<typeof parseDocument>): readonly string[] =>
  result.ok ? [] : result.issues.map((issue) => issue.code)

describe('保存と読み込みの往復(フェーズ4の完了条件の先取り)', () => {
  it('座標・表示範囲・学習設定を含めて元に戻る', () => {
    const document = fullDocument()
    expect(roundTrip(document)).toEqual(document)
  })

  it('ノードの並び順を保つ(重みの初期化と checkpoint の対応が並び順で決まるため)', () => {
    // わざとトポロジカル順(依存の順)ではない並びにする。並べ替えが入れば必ず崩れる
    const { graph } = segnetExample()
    const shuffled: ModelGraph = { ...graph, nodes: [...graph.nodes].reverse() }
    const document = { ...fullDocument(), graph: shuffled }

    const ids = roundTrip(document).graph.nodes.map((node) => node.id)
    expect(ids).toEqual(shuffled.nodes.map((node) => node.id))
  })

  it('inputs の並び順を保つ(Concat はつないだ順にチャンネルが並ぶため)', () => {
    const { graph } = segnetExample()
    const unpool = roundTrip({ ...fullDocument(), graph }).graph.nodes.find(
      (node) => node.id === 'unpool1',
    )
    expect(unpool?.inputs.map((input) => input.port)).toEqual(['x', 'indices'])
  })

  it('座標の並び順も保つ(保存し直すたびにファイルの差分が出ないように)', () => {
    const document = fullDocument()
    expect([...roundTrip(document).layout.positions.keys()]).toEqual([
      ...document.layout.positions.keys(),
    ])
  })

  it('保存し直しても、ファイルの中身は 1 文字も変わらない', () => {
    const first = serializeDocument(fullDocument(), SAVED_AT)
    expect(serializeDocument(roundTrip(fullDocument()), SAVED_AT)).toBe(first)
  })

  it('学習設定が未設定なら training のキーを省き、読み込むと null に戻る', () => {
    const document = { ...fullDocument(), training: null }
    expect(Object.hasOwn(buildDocumentJson(document, SAVED_AT), 'training')).toBe(false)
    expect(roundTrip(document).training).toBeNull()
  })

  it('表示範囲が未保存(null)なら viewport を省き、読み込むと null に戻る', () => {
    const document: EditorDocument = {
      ...fullDocument(),
      layout: { ...fullDocument().layout, viewport: null },
    }
    expect(roundTrip(document).layout.viewport).toBeNull()
  })

  it('新規作成の文書も往復できる', () => {
    const document = emptyEditorDocument('new-model')
    const restored = roundTrip(document)
    expect(restored).toEqual({
      ...document,
      // 保存した時刻だけは、保存したときに決まる
      meta: { name: 'new-model', savedAt: SAVED_AT.toISOString() },
    })
  })
})

describe('buildDocumentJson', () => {
  it('model.model_graph は proto の JSON 表記そのもの(そのまま API に送れる)', () => {
    const json = buildDocumentJson(fullDocument(), SAVED_AT)
    const example = JSON.parse(exampleRaw) as { model_graph: unknown }
    expect(json.model.model_graph).toEqual(example.model_graph)
  })

  it('形式の印・版・保存日時を書く', () => {
    const json = buildDocumentJson(fullDocument(), SAVED_AT)
    expect(json).toMatchObject({
      format: DOCUMENT_FORMAT,
      version: 1,
      meta: { name: 'segnet', saved_at: '2026-10-22T10:00:00.000Z' },
      context: { data_dim: '2d', method: 'cnn' },
    })
  })
})

describe('parseDocument - 寛容に読むもの', () => {
  const minimal = (): Record<string, unknown> => ({
    format: DOCUMENT_FORMAT,
    version: 1,
    meta: { name: 'minimal' },
    context: { data_dim: '2d', method: 'cnn' },
    model: { model_graph: { nodes: [], outputs: [] } },
  })

  it('editor(見た目)がなくても読める。座標は空、表示範囲は null になる', () => {
    const result = parseDocument(minimal())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.layout.positions.size).toBe(0)
    expect(result.document.layout.viewport).toBeNull()
    expect(result.document.meta.savedAt).toBeNull()
  })

  it('今の条件で使えないノードがあっても読める(赤色表示は検証層の仕事)', () => {
    const json = buildDocumentJson(
      { ...fullDocument(), context: { dataDim: '1d', method: 'cnn' } },
      SAVED_AT,
    )
    const result = parseDocument(json)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.document.context).toEqual({ dataDim: '1d', method: 'cnn' })
  })

  it('値の制約を破ったパラメータがあっても読める(kernel_size = 0)', () => {
    const graph = validSegnetGraph()
    const [first, ...rest] = graph.nodes
    if (first === undefined) throw new Error('ノードがありません')
    const broken: ModelGraph = {
      ...graph,
      nodes: [{ ...first, spec: { ...first.spec, params: { kernel_size: 0 } } }, ...rest],
    }
    const result = parseDocument(buildDocumentJson({ ...fullDocument(), graph: broken }, SAVED_AT))
    expect(result.ok).toBe(true)
  })

  it('グラフにない ID の座標が混ざっていても読める', () => {
    const json = {
      ...minimal(),
      editor: { positions: { ghost: { x: 1, y: 2 } } },
    }
    expect(parseDocument(json).ok).toBe(true)
  })
})

describe('parseDocument - 拒否するもの', () => {
  it('JSON として読めなければ invalid-json', () => {
    const result = parseDocumentText('{ "format": ')
    expect(codesOf(result)).toEqual(['document/invalid-json'])
  })

  it('別の JSON(test_segnet_dag.json そのもの)は not-a-document', () => {
    expect(codesOf(parseDocumentText(exampleRaw))).toEqual(['document/not-a-document'])
  })

  it('配列や null は not-a-document', () => {
    expect(codesOf(parseDocument([]))).toEqual(['document/not-a-document'])
    expect(codesOf(parseDocument(null))).toEqual(['document/not-a-document'])
  })

  it('新しい版のファイルは読まない(知らない項目を黙って捨てないため)', () => {
    const json = { ...buildDocumentJson(fullDocument(), SAVED_AT), version: 2 }
    const result = parseDocument(json)
    expect(codesOf(result)).toEqual(['document/unsupported-version'])
    if (!result.ok) expect(result.issues[0]?.message).toContain('version 2')
  })

  it('version が数でなければ unsupported-version', () => {
    const json = { ...buildDocumentJson(fullDocument(), SAVED_AT), version: '1' }
    expect(codesOf(parseDocument(json))).toEqual(['document/unsupported-version'])
  })

  it('構造の誤りは、場所をパスで示す', () => {
    const json = buildDocumentJson(fullDocument(), SAVED_AT)
    const broken = {
      ...json,
      model: {
        model_graph: {
          ...json.model.model_graph,
          nodes: json.model.model_graph.nodes.map((node, index) =>
            index === 2 ? { ...node, id: 'bn 1' } : node,
          ),
        },
      },
    }
    const result = parseDocument(broken)
    expect(codesOf(result)).toEqual(['document/invalid-structure'])
    if (!result.ok) {
      expect(result.issues[0]?.field).toBe('model.model_graph.nodes[2].id')
      // スキーマに書いた日本語のメッセージがそのまま出る
      expect(result.issues[0]?.message).toContain('英数字と - _ だけ')
    }
  })

  it('問題は全件を報告する', () => {
    const json = buildDocumentJson(fullDocument(), SAVED_AT)
    const broken = {
      ...json,
      context: { data_dim: '3d', method: 'cnn' },
      editor: { positions: {}, viewport: { x: 0, y: 0, zoom: 0 } },
    }
    const result = parseDocument(broken)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.field)).toEqual([
        'context.data_dim',
        'editor.viewport.zoom',
      ])
    }
  })

  it('Zod の既定のメッセージも日本語になる', () => {
    const { meta: _omitted, ...withoutMeta } = buildDocumentJson(fullDocument(), SAVED_AT)
    const result = parseDocument(withoutMeta)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues[0]?.field).toBe('meta')
      expect(result.issues[0]?.message).toMatch(/^meta: 無効な入力/)
    }
  })

  it('学習設定の構造の誤りも報告する', () => {
    const json = buildDocumentJson(fullDocument(), SAVED_AT)
    const broken = { ...json, training: { ...json.training, optimizer: { adam: {}, sgd: {} } } }
    const result = parseDocument(broken)
    expect(codesOf(result)).toEqual(['document/invalid-structure'])
    if (!result.ok) expect(result.issues[0]?.field).toBe('training.optimizer')
  })

  it('座標のキーに使えない文字があれば拒否する', () => {
    const json = buildDocumentJson(fullDocument(), SAVED_AT)
    const broken = { ...json, editor: { positions: { 'a b': { x: 0, y: 0 } } } }
    expect(codesOf(parseDocument(broken))).toEqual(['document/invalid-structure'])
  })

  it('__proto__ をキーにした座標は取り込まない(プロトタイプ汚染を起こさない)', () => {
    // JSON.parse は "__proto__" を普通のキーとして作る。これを素朴に obj[key] = value と
    // 書き写すと、Object.prototype が書き換わり、すべてのオブジェクトに影響が及ぶ
    const text = serializeDocument(fullDocument(), SAVED_AT).replace(
      '"positions": {',
      '"positions": { "__proto__": { "x": 1, "y": 2 },',
    )
    const result = parseDocumentText(text)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.document.layout.positions.has('__proto__')).toBe(false)
    expect(Object.hasOwn(Object.prototype, 'x')).toBe(false)
  })
})

describe('版の移行の仕組み(架空の版 0 で確かめる)', () => {
  // 版 0 では、名前が meta ではなくトップレベルの title にあったとする
  const migrateV0toV1 = (document: RawDocument): RawDocument => {
    const { title, ...rest } = document
    return { ...rest, meta: { name: title } }
  }

  const v0Document = (): Record<string, unknown> => {
    const { meta: _meta, ...rest } = buildDocumentJson(fullDocument(), SAVED_AT)
    return { ...rest, version: 0, title: 'old-segnet' }
  }

  it('古い版を最新版に変換してから読む', () => {
    const result = parseDocument(v0Document(), { migrations: { 0: migrateV0toV1 } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.document.meta.name).toBe('old-segnet')
  })

  it('変換の手段がない版は unsupported-version', () => {
    expect(codesOf(parseDocument(v0Document(), { migrations: {} }))).toEqual([
      'document/unsupported-version',
    ])
  })

  it('変換が version を書き換え忘れても、連鎖は正しく進む', () => {
    // migrateV0toV1 は version に触れていない(rest の version: 0 がそのまま残る)
    const result = parseDocument(v0Document(), { migrations: { 0: migrateV0toV1 } })
    expect(result.ok).toBe(true)
  })
})
