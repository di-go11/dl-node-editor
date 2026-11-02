// @vitest-environment node
import { describe, expect, it } from 'vitest'

import exampleRaw from '../../../../backend/ai-engine/modelconfigs/test_segnet_dag.json?raw'
import { DEFAULT_EDITOR_CONTEXT } from '../../entity/editor-context/editor-context'
import type { SourceEndpoint, TargetEndpoint } from '../../entity/graph-editing/endpoint'
import {
  GRAPH_OUTPUT_NODE,
  GRAPH_OUTPUT_PORT,
  portRefToSource,
} from '../../entity/graph-editing/endpoint'
import type { ModelGraph } from '../../entity/model-graph/model-graph'
import { renameNode } from '../../entity/model-graph/model-graph'
import type { NodeId } from '../../entity/model-graph/node-id'
import { nodeId } from '../../entity/model-graph/node-id'
import { fromProtoJson, toProtoJson } from '../../entity/model-graph/proto-json/convert'
import { modelGraphJsonSchema } from '../../entity/model-graph/proto-json/schema'
import { defaultNodeCatalog } from '../../entity/node-catalog/entries'
import { validateModelGraph } from '../../entity/validation/validate-model-graph'

import { createEditorStore } from './editor-store'

/**
 * フェーズ 2 の完了条件「手で SegNet と同等のグラフを組み立てられる」の自動版。
 *
 * 画面の操作(ドロップ・線を引く・パラメータを入力する)は、すべてストアの操作
 * (addNode / connect / updateParams)になる。そこで test_segnet_dag.json を
 * 「利用者が行う操作の列」に読み替えてストアに流し込み、出来上がったグラフが
 * 元のファイルと同じになることを確かめる。
 *
 * 画面そのもの(D&D や線を引く操作)が正しくストアを呼ぶかは、2b のテストと
 * ブラウザでの確認で担保する。
 */

function exampleGraph(): ModelGraph {
  const example = JSON.parse(exampleRaw) as { model_graph: unknown }
  return fromProtoJson(modelGraphJsonSchema.parse(example.model_graph))
}

describe('ストアの操作だけで test_segnet_dag.json のグラフを組み立てる', () => {
  it('組み立てたグラフが、ID を除いて元のファイルと一致し、検証も通る', () => {
    const target = exampleGraph()
    const store = createEditorStore({ catalog: defaultNodeCatalog })
    const actions = store.getState()

    // 1. サイドバーからノードを置き、プロパティパネルでパラメータを入れる
    const idMap = new Map<NodeId, NodeId>() // ファイルの ID → エディタが振った ID
    target.nodes.forEach((node, index) => {
      const id = actions.addNode(node.spec.kind, { x: index * 200, y: 0 })
      if (id === null) throw new Error(`${node.spec.kind} を置けませんでした`)
      actions.updateParams(id, node.spec.params)
      idMap.set(node.id, id)
    })
    const editorId = (id: NodeId): NodeId => {
      const mapped = idMap.get(id)
      if (mapped === undefined) throw new Error(`${id} がありません`)
      return mapped
    }

    // 2. 線を引く(ファイルの inputs の順に。Concat などでは順番が意味を持つ)
    for (const node of target.nodes) {
      for (const input of node.inputs) {
        const fileSource = portRefToSource(input.source)
        const source: SourceEndpoint =
          input.source.kind === 'graph-input'
            ? fileSource
            : { node: editorId(input.source.nodeId), port: fileSource.port }
        const dst: TargetEndpoint = { node: editorId(node.id), port: input.port }
        expect(store.getState().connect(source, dst)).toEqual({ ok: true })
      }
    }
    for (const output of target.outputs) {
      const result = store
        .getState()
        .connect(
          { node: editorId(output.nodeId), port: output.port },
          { node: GRAPH_OUTPUT_NODE, port: GRAPH_OUTPUT_PORT },
        )
      expect(result).toEqual({ ok: true })
    }

    const built = store.getState().document.graph

    // 3. 検証を通る(学習を始められる状態になっている)
    const validation = validateModelGraph({
      graph: built,
      context: DEFAULT_EDITOR_CONTEXT,
      catalog: defaultNodeCatalog,
    })
    expect(validation.issues.filter((issue) => issue.severity === 'error')).toEqual([])

    // 4. ID をファイルと同じ名前に付け替えると、proto JSON が元のファイルと完全に一致する
    //    (ID の付け替えは 2c のプロパティパネルで行う操作。ここでは関数を直接使う)
    const renamed = [...idMap].reduce(
      (graph, [fileId, id]) => renameNode(graph, id, nodeId(fileId)),
      built,
    )
    expect(toProtoJson(renamed)).toEqual(toProtoJson(target))
  })
})
