// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { emptyEditorDocument } from '../../entity/document/document'
import type { EditorDocument } from '../../entity/document/document'
import {
  GRAPH_INPUT_NODE,
  GRAPH_INPUT_PORT,
  GRAPH_OUTPUT_NODE,
  GRAPH_OUTPUT_PORT,
} from '../../entity/graph-editing/endpoint'
import { findNode } from '../../entity/model-graph/model-graph'
import { nodeId } from '../../entity/model-graph/node-id'
import { GRAPH_INPUT, nodeOutput } from '../../entity/model-graph/port'
import { defaultNodeCatalog } from '../../entity/node-catalog/entries'
import { validSegnetGraph } from '../../entity/validation/test-fixtures'

import { MAX_LOG_MESSAGES, createEditorStore, isDocumentDirty } from './editor-store'

/**
 * ストアのテスト。Zustand の vanilla ストアは React なしで動くので、Node 上で
 * 「操作 → 状態」を直接確かめられる。規則そのもの(つないでよいか等)は
 * エンティティ層でテスト済みなので、ここではストアが正しく結果を入れ替えるかを見る。
 */

const newStore = (initialDocument?: EditorDocument) =>
  createEditorStore(
    initialDocument === undefined
      ? { catalog: defaultNodeCatalog }
      : { catalog: defaultNodeCatalog, initialDocument },
  )

describe('addNode', () => {
  it('ノードを末尾に足し、座標を記録し、選択状態にする', () => {
    const store = newStore()
    const id = store.getState().addNode('conv2d', { x: 10, y: 20 })

    const { document, selection } = store.getState()
    expect(id).toBe('conv2d_1')
    expect(document.graph.nodes.map((node) => node.id)).toEqual(['conv2d_1'])
    expect(document.layout.positions.get('conv2d_1')).toEqual({ x: 10, y: 20 })
    expect(selection.nodeIds).toEqual(['conv2d_1'])
  })

  it('エディタ専用の種類や知らない種類は置けない', () => {
    const store = newStore()
    expect(store.getState().addNode(GRAPH_INPUT_NODE, { x: 0, y: 0 })).toBeNull()
    expect(store.getState().addNode('transformer_block', { x: 0, y: 0 })).toBeNull()
    expect(store.getState().document.graph.nodes).toEqual([])
  })

  it('前の状態のオブジェクトを書き換えない(イミュータブルな更新)', () => {
    const store = newStore()
    const before = store.getState().document
    store.getState().addNode('conv2d', { x: 0, y: 0 })
    expect(before.graph.nodes).toEqual([])
    expect(before.layout.positions.size).toBe(0)
  })
})

describe('moveNode', () => {
  it('座標だけを変え、グラフ(モデルの意味)は同じオブジェクトのまま', () => {
    const store = newStore({ ...emptyEditorDocument(), graph: validSegnetGraph() })
    const graphBefore = store.getState().document.graph
    store.getState().moveNode(nodeId('conv1'), { x: 5, y: 6 })
    expect(store.getState().document.layout.positions.get('conv1')).toEqual({ x: 5, y: 6 })
    // 見た目の変更がモデルの意味を変えないこと(指示書 7.1)。フェーズ 5 の
    // 「変更したら再チェック」は graph の同一性で判定できる
    expect(store.getState().document.graph).toBe(graphBefore)
  })

  it('Input / Output も動かせる', () => {
    const store = newStore()
    store.getState().moveNode(GRAPH_OUTPUT_NODE, { x: 700, y: 50 })
    expect(store.getState().document.layout.positions.get(GRAPH_OUTPUT_NODE)).toEqual({
      x: 700,
      y: 50,
    })
  })
})

describe('removeNodes', () => {
  it('ノードと、その座標と、つながっていた線を消す', () => {
    const store = newStore({ ...emptyEditorDocument(), graph: validSegnetGraph() })
    store.getState().moveNode(nodeId('bn1'), { x: 1, y: 1 })
    store.getState().removeNodes([nodeId('bn1')])

    const { graph, layout } = store.getState().document
    expect(findNode(graph, nodeId('bn1'))).toBeUndefined()
    expect(layout.positions.has('bn1')).toBe(false)
    // bn1 を参照していた pool1 の入力も消える(removeNode の規則)
    expect(findNode(graph, nodeId('pool1'))?.inputs).toEqual([])
  })

  it('Input / Output は消さない', () => {
    const store = newStore()
    const before = store.getState().document
    store.getState().removeNodes([GRAPH_INPUT_NODE, GRAPH_OUTPUT_NODE])
    expect(store.getState().document).toBe(before)
  })

  it('消したノードを選択から外す', () => {
    const store = newStore({ ...emptyEditorDocument(), graph: validSegnetGraph() })
    store.getState().setSelection({ nodeIds: [nodeId('bn1'), nodeId('pool1')], edgeIds: [] })
    store.getState().removeNodes([nodeId('bn1')])
    expect(store.getState().selection.nodeIds).toEqual(['pool1'])
  })
})

describe('connect / disconnect', () => {
  it('Input → ノード → Output をつなぐ', () => {
    const store = newStore()
    const id = store.getState().addNode('conv2d', { x: 0, y: 0 })
    if (id === null) throw new Error('置けませんでした')

    expect(
      store
        .getState()
        .connect({ node: GRAPH_INPUT_NODE, port: GRAPH_INPUT_PORT }, { node: id, port: 'x' }),
    ).toEqual({ ok: true })
    expect(
      store
        .getState()
        .connect({ node: id, port: 'y' }, { node: GRAPH_OUTPUT_NODE, port: GRAPH_OUTPUT_PORT }),
    ).toEqual({ ok: true })

    const { graph } = store.getState().document
    expect(findNode(graph, id)?.inputs).toEqual([{ port: 'x', source: GRAPH_INPUT }])
    expect(graph.outputs).toEqual([nodeOutput(id, 'y')])
  })

  it('規則に反する接続は、状態を変えずに理由を返す', () => {
    const store = newStore()
    const id = store.getState().addNode('conv2d', { x: 0, y: 0 })
    if (id === null) throw new Error('置けませんでした')
    const before = store.getState().document

    const result = store.getState().connect({ node: id, port: 'y' }, { node: id, port: 'x' })
    expect(result).toMatchObject({ ok: false, code: 'self-loop' })
    expect(store.getState().document).toBe(before)
  })

  it('線を外す', () => {
    const store = newStore({ ...emptyEditorDocument(), graph: validSegnetGraph() })
    store.getState().disconnect([{ kind: 'input', nodeId: nodeId('relu1'), index: 0 }])
    expect(findNode(store.getState().document.graph, nodeId('relu1'))?.inputs).toEqual([])
  })
})

describe('updateParams', () => {
  it('指定したパラメータだけを書き換える', () => {
    const store = newStore({ ...emptyEditorDocument(), graph: validSegnetGraph() })
    store.getState().updateParams(nodeId('conv1'), { out_channels: 32 })
    expect(findNode(store.getState().document.graph, nodeId('conv1'))?.spec.params).toMatchObject({
      in_channels: 3,
      out_channels: 32,
    })
  })

  it('存在しないノードなら何もしない', () => {
    const store = newStore()
    const before = store.getState().document
    store.getState().updateParams(nodeId('ghost'), { out_channels: 32 })
    expect(store.getState().document).toBe(before)
  })
})

describe('deleteElements', () => {
  it('線を先に外してからノードを消す(位置で指す線が、ノードの削除でずれないように)', () => {
    // relu1 を消すと、bn1 の入力(relu1 から)も消える。同時に、別の線 pool1→unpool1.indices
    // (unpool1 の inputs[1])も選んで消す。ノードを先に消しても unpool1 の位置は変わらないが、
    // 線 → ノードの順なら、どの組み合わせでも同じ時点の状態から正しく処理できる
    const store = newStore({ ...emptyEditorDocument(), graph: validSegnetGraph() })
    store
      .getState()
      .deleteElements([nodeId('relu1')], [{ kind: 'input', nodeId: nodeId('unpool1'), index: 1 }])

    const { graph } = store.getState().document
    expect(findNode(graph, nodeId('relu1'))).toBeUndefined()
    expect(findNode(graph, nodeId('bn1'))?.inputs).toEqual([])
    expect(findNode(graph, nodeId('unpool1'))?.inputs.map((input) => input.port)).toEqual(['x'])
  })
})

describe('renameNode', () => {
  it('ID と、座標・選択状態のキーをまとめて付け替える', () => {
    const store = newStore({ ...emptyEditorDocument(), graph: validSegnetGraph() })
    store.getState().moveNode(nodeId('conv1'), { x: 1, y: 2 })
    store.getState().moveNode(nodeId('bn1'), { x: 3, y: 4 })
    store.getState().setSelection({ nodeIds: [nodeId('conv1')], edgeIds: [] })

    const result = store.getState().renameNode(nodeId('conv1'), 'enc1')
    expect(result.ok).toBe(true)

    const { document, selection } = store.getState()
    expect(findNode(document.graph, nodeId('enc1'))).toBeDefined()
    // relu1 の入力も新しい ID を指す(線が切れない)
    expect(findNode(document.graph, nodeId('relu1'))?.inputs[0]?.source).toEqual(
      nodeOutput(nodeId('enc1'), 'y'),
    )
    // 座標の表は挿入順を保つ
    expect([...document.layout.positions.keys()]).toEqual(['enc1', 'bn1'])
    expect(selection.nodeIds).toEqual(['enc1'])
  })

  it('使えない ID なら状態を変えずに理由を返す', () => {
    const store = newStore({ ...emptyEditorDocument(), graph: validSegnetGraph() })
    const before = store.getState().document
    const result = store.getState().renameNode(nodeId('conv1'), 'bn1')
    expect(result.ok).toBe(false)
    expect(store.getState().document).toBe(before)
  })
})

describe('setContext', () => {
  it('条件を切り替えても、置いたノードは消さない(指示書 4.3)', () => {
    const store = newStore({ ...emptyEditorDocument(), graph: validSegnetGraph() })
    const graphBefore = store.getState().document.graph
    store.getState().setContext({ dataDim: '1d', method: 'cnn' })
    expect(store.getState().document.context).toEqual({ dataDim: '1d', method: 'cnn' })
    expect(store.getState().document.graph).toBe(graphBefore)
  })
})

describe('replaceDocument', () => {
  it('文書を入れ替え、選択を解除する', () => {
    const store = newStore()
    store.getState().addNode('conv2d', { x: 0, y: 0 })
    const next = { ...emptyEditorDocument('loaded'), graph: validSegnetGraph() }
    store.getState().replaceDocument(next)
    expect(store.getState().document).toBe(next)
    expect(store.getState().selection).toEqual({ nodeIds: [], edgeIds: [] })
  })
})

describe('ストアは作るたびに独立している', () => {
  it('一方の変更が他方に漏れない', () => {
    const a = newStore()
    const b = newStore()
    a.getState().addNode('conv2d', { x: 0, y: 0 })
    expect(b.getState().document.graph.nodes).toEqual([])
  })
})

describe('保存の記録と未保存の判定', () => {
  it('作った直後と、保存した直後は未保存ではない', () => {
    const store = newStore()
    expect(isDocumentDirty(store.getState())).toBe(false)
    store.getState().addNode('conv2d', { x: 0, y: 0 })
    expect(isDocumentDirty(store.getState())).toBe(true)
    store.getState().markSaved(store.getState().document, '2026-10-23T00:00:00.000Z')
    expect(isDocumentDirty(store.getState())).toBe(false)
    expect(store.getState().document.meta.savedAt).toBe('2026-10-23T00:00:00.000Z')
  })

  it('保存の途中で編集した分は、未保存のまま残る', () => {
    const store = newStore()
    const savedDocument = store.getState().document // この時点の内容を保存し始めた
    store.getState().addNode('conv2d', { x: 0, y: 0 }) // 保存の完了前に編集した
    store.getState().markSaved(savedDocument, '2026-10-23T00:00:00.000Z')
    expect(isDocumentDirty(store.getState())).toBe(true)
  })

  it('表示範囲の変更だけでは未保存にしない(スクロールのたびに確認が出ないように)', () => {
    const store = newStore()
    store.getState().setViewport({ x: 10, y: 10, zoom: 2 })
    expect(isDocumentDirty(store.getState())).toBe(false)
  })

  it('名前・条件・座標の変更は未保存になる', () => {
    const changes = [
      (s: ReturnType<typeof newStore>) => s.getState().setDocumentName('other'),
      (s: ReturnType<typeof newStore>) => s.getState().setContext({ dataDim: '1d', method: 'cnn' }),
      (s: ReturnType<typeof newStore>) => s.getState().moveNode(GRAPH_INPUT_NODE, { x: 9, y: 9 }),
    ]
    for (const change of changes) {
      const store = newStore()
      change(store)
      expect(isDocumentDirty(store.getState())).toBe(true)
    }
  })

  it('文書を入れ替えると保存済みとみなし、作り直しの番号を進める', () => {
    const store = newStore()
    store.getState().addNode('conv2d', { x: 0, y: 0 })
    store.getState().replaceDocument(emptyEditorDocument('loaded'))
    expect(isDocumentDirty(store.getState())).toBe(false)
    expect(store.getState().documentRevision).toBe(1)
  })
})

describe('操作の結果のメッセージ', () => {
  it('番号を振って追加し、消せる', () => {
    const store = newStore()
    store.getState().addMessages([
      { level: 'info', text: 'a' },
      { level: 'error', text: 'b' },
    ])
    expect(store.getState().messages.map((m) => [m.id, m.text])).toEqual([
      [1, 'a'],
      [2, 'b'],
    ])
    store.getState().clearMessages()
    expect(store.getState().messages).toEqual([])
  })

  it('上限を超えたら古いものから捨てる', () => {
    const store = newStore()
    store
      .getState()
      .addMessages(
        Array.from({ length: MAX_LOG_MESSAGES + 5 }, (_, i) => ({ level: 'info', text: `${i}` })),
      )
    expect(store.getState().messages).toHaveLength(MAX_LOG_MESSAGES)
    expect(store.getState().messages[0]?.text).toBe('5')
  })
})

describe('学習設定', () => {
  it('ensureTrainingSettings は、なければ既定値で作り、モデル名を文書の名前から取る', () => {
    const store = newStore(emptyEditorDocument('segnet'))
    store.getState().ensureTrainingSettings()
    expect(store.getState().document.training?.modelName).toBe('segnet')
  })

  it('文書の名前がモデル名に使えない文字を含むなら、既定のモデル名にする', () => {
    const store = newStore(emptyEditorDocument('画像 分類'))
    store.getState().ensureTrainingSettings()
    expect(store.getState().document.training?.modelName).toBe('model')
  })

  it('すでにあれば何もしない(同じオブジェクトのまま)', () => {
    const store = newStore(emptyEditorDocument('a'))
    store.getState().ensureTrainingSettings()
    const before = store.getState().document
    store.getState().ensureTrainingSettings()
    expect(store.getState().document).toBe(before)
  })

  it('updateTraining で書き換える。学習設定がなければ何もしない', () => {
    const store = newStore()
    const before = store.getState().document
    store.getState().updateTraining((s) => ({ ...s, epoch: 5 }))
    expect(store.getState().document).toBe(before)

    store.getState().ensureTrainingSettings()
    store.getState().updateTraining((s) => ({ ...s, epoch: 5 }))
    expect(store.getState().document.training?.epoch).toBe(5)
  })
})

describe('focusNode', () => {
  it('ノードを選択し、中央に表示する要求を出す。処理したら消せる', () => {
    const store = newStore({ ...emptyEditorDocument(), graph: validSegnetGraph() })
    store.getState().focusNode(nodeId('bn1'))
    expect(store.getState().selection).toEqual({ nodeIds: ['bn1'], edgeIds: [] })
    expect(store.getState().focusRequest).toEqual({ nodeId: 'bn1' })
    store.getState().clearFocusRequest()
    expect(store.getState().focusRequest).toBeNull()
  })
})

describe('文書の入れ替えと実行の状態', () => {
  it('別の文書を読み込んだら、チェックの結果を持ち越さない', () => {
    const store = newStore()
    store
      .getState()
      .setRunState({ kind: 'editing', lastResult: { ok: false, issues: [] }, lastTarget: null })
    store.getState().replaceDocument(emptyEditorDocument('other'))
    expect(store.getState().runState).toEqual({
      kind: 'editing',
      lastResult: null,
      lastTarget: null,
    })
  })

  it('学習中なら、その状態は残す(サーバーでは学習が続いているため)', () => {
    const store = newStore()
    store.getState().setRunState({ kind: 'running', jobId: 'job-1' })
    store.getState().replaceDocument(emptyEditorDocument('other'))
    expect(store.getState().runState).toEqual({ kind: 'running', jobId: 'job-1' })
  })
})
