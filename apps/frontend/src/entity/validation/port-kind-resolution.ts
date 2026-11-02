import { findNode } from '../model-graph/model-graph'
import type { ModelGraph } from '../model-graph/model-graph'
import type { NodeId } from '../model-graph/node-id'
import type { PortKind, PortRef } from '../model-graph/port'
import type { NodeCatalog } from '../node-catalog/catalog'
import { findNodeType } from '../node-catalog/catalog'
import { inputPortDef, outputPortDef } from '../node-catalog/node-type'

/**
 * ポートの種類が Any のとき、実際にどの種類になるかを上流から決める。
 *
 * ## なぜ解決が必要か
 *
 * Activation / Add / Concat のポートは種類が Any である(NodePorts.hpp)。
 * これは「特徴マップにもトークン列にも使える」という意味で、実際の種類は
 * 入力に何がつながったかで決まる。
 *
 *   [IndexedPooling].indices ──▶ [Activation].x(Any)──▶ [Activation].y(Any)
 *
 * この Activation の出力を Conv2D につなげてよいかは、局所的な種類の比較では
 * 判定できない。Any 対 Feature は互換と見なされてしまうためである。
 * 上流をたどって Any を具体的な種類に解決してから比べる必要がある。
 *
 * ## 'unknown' を返す場合
 *
 * つながっていない、知らない層、閉路があるなど、決められない場合は 'unknown' を返す。
 * 呼び出し側(port-kinds のルール)は unknown のときは何も報告しない。
 * 決められない理由は別のルールが報告しており、同じ原因で Issue を重ねないためである。
 */
export type ResolvedPortKind = PortKind | 'unknown'

export function resolveOutputKind(
  graph: ModelGraph,
  catalog: NodeCatalog,
  ref: PortRef,
): ResolvedPortKind {
  return resolve(graph, catalog, ref, new Set())
}

function resolve(
  graph: ModelGraph,
  catalog: NodeCatalog,
  ref: PortRef,
  visiting: Set<NodeId>,
): ResolvedPortKind {
  // グラフ入力は画像、つまり特徴マップとして入ってくる
  if (ref.kind === 'graph-input') return 'feature'

  const node = findNode(graph, ref.nodeId)
  if (node === undefined) return 'unknown'

  const def = findNodeType(catalog, node.spec.kind)
  if (def === undefined) return 'unknown'

  const output = outputPortDef(def, ref.port)
  if (output === undefined) return 'unknown'
  if (output.kind !== 'any') return output.kind

  // ここから先は Any の解決。閉路に入ったら決められない
  if (visiting.has(node.id)) return 'unknown'
  visiting.add(node.id)
  try {
    for (const input of node.inputs) {
      const inputDef = inputPortDef(def, input.port)
      // Any 以外の入力ポート(Unpooling の indices など)は出力の種類を決めない
      if (inputDef === undefined || inputDef.kind !== 'any') continue
      const resolved = resolve(graph, catalog, input.source, visiting)
      if (resolved !== 'unknown') return resolved
    }
    return 'unknown'
  } finally {
    // 探索から抜けるときに外す。ダイヤモンド型の分岐で同じノードを
    // 別経路からたどるとき、閉路と誤判定しないようにするため。
    visiting.delete(node.id)
  }
}
