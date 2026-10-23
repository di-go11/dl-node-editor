import type { GraphNode, ModelGraph } from '../model-graph/model-graph'
import { nextNodeId, RESERVED_NODE_IDS } from '../model-graph/node-id'
import type { NodeTypeDef } from '../node-catalog/node-type'
import { defaultParamsOf } from '../param/param-def'

/**
 * カタログの定義から、新しいノードを作る(サイドバーからドロップしたとき)。
 *
 *   - ID は '<層の種類>_<番号>'(例 conv2d_1)で、まだ使われていない最小の番号にする(指示書 7.4)
 *   - パラメータはカタログの既定値で埋める
 *   - 接続はまだない
 *
 * エディタ専用の種類(Input / Output)は作れない。グラフにそれぞれ 1 つだけ
 * 存在するノードであり、サイドバーにも出さない(placeableNodeTypes が除いている)。
 * それでも渡されたらプログラムの誤りなので、例外にする。
 */
export function createNode(def: NodeTypeDef, graph: ModelGraph): GraphNode {
  if (def.editorOnly) {
    throw new Error(`${def.label} はエディタ専用のノードなので、新しく作れません`)
  }
  // 予約 ID も「使用済み」に含める。接頭辞が '__input' のような種類はないが、
  // 採番の規則として予約 ID と衝突しないことを保証しておく
  const existing = [...graph.nodes.map((node) => node.id), ...RESERVED_NODE_IDS]
  return {
    id: nextNodeId(def.typeId, existing),
    spec: { kind: def.typeId, params: defaultParamsOf(def.params) },
    inputs: [],
  }
}
