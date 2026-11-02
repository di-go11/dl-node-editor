import { GRAPH_INPUT_NODE, GRAPH_OUTPUT_NODE } from '../graph-editing/endpoint'
import { dependencyIdsOf, topologicalOrder } from '../model-graph/graph-queries'
import type { NodeId } from '../model-graph/node-id'

import type { EditorDocument, Position } from './document'

/**
 * 座標のないノードに、自動で座標を振る(読み込んだファイルに editor の項目がない場合など)。
 *
 * ## 並べ方:層状レイアウト(layered layout)
 *
 * DAG を左から右へ「段」に分けて並べる。ノードの段(深さ)は
 * 「Input から そのノードまでの、最も長い経路の辺の数」とする。
 *
 *   段 0      段 1      段 2      段 3       段 4
 *   [Input] → [conv1] → [relu1] → [bn1] →… → [Output]
 *                └──────────────→ [add1](深さは長いほうの経路で決まる)
 *
 * 最長経路を使うのは、どの線も必ず左から右へ向かうようにするためである。
 * 最短経路だと、合流するノード(Add や Concat)が上流の一部より左に来て、線が逆向きに走る。
 *
 * 同じ段の中では、nodes の並び順に上から積む。並び順は決定的なので、同じファイルを
 * 読めば毎回同じ配置になる。
 *
 * ## すでに座標のあるノードは動かさない
 *
 * 利用者が置いた位置を勝手に変えないため。すべてのノードに座標があれば、
 * 受け取った文書をそのまま(同じオブジェクトとして)返す。
 */

export const LAYOUT_COLUMN_GAP = 240
export const LAYOUT_ROW_GAP = 140

/** 各ノードの段(深さ)を求める。閉路があるときは並び順を段の代わりに使う */
function depthsOf(document: EditorDocument): ReadonlyMap<NodeId, number> {
  const { graph } = document
  const order = topologicalOrder(graph)
  const depths = new Map<NodeId, number>()

  if (order === null) {
    // 閉路のあるグラフ(読み込んだファイルの誤り)。段は決められないので、並び順に右へずらす。
    // 閉路そのものは検証(graph/cycle)がログに出す
    graph.nodes.forEach((node, index) => depths.set(node.id, index + 1))
    return depths
  }

  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const))
  for (const id of order) {
    const node = byId.get(id)
    if (node === undefined) continue
    // 上流の最も深いノードの次の段。上流がなければ(グラフ入力だけを受けるなら)段 1
    const upstream = dependencyIdsOf(node).map((dependency) => depths.get(dependency) ?? 0)
    depths.set(id, Math.max(0, ...upstream) + 1)
  }
  return depths
}

export function fillMissingPositions(document: EditorDocument): EditorDocument {
  const { graph, layout } = document
  const allIds = [GRAPH_INPUT_NODE, ...graph.nodes.map((node) => node.id), GRAPH_OUTPUT_NODE]
  if (allIds.every((id) => layout.positions.has(id))) return document

  const depths = depthsOf(document)
  const maxDepth = Math.max(0, ...depths.values())
  const columnOf = (id: string): number => {
    if (id === GRAPH_INPUT_NODE) return 0
    if (id === GRAPH_OUTPUT_NODE) return maxDepth + 1
    return depths.get(id as NodeId) ?? 1
  }

  // 段ごとに、上から何番目かを数える
  const rowsUsed = new Map<number, number>()
  const computed = new Map<string, Position>()
  for (const id of allIds) {
    const column = columnOf(id)
    const row = rowsUsed.get(column) ?? 0
    rowsUsed.set(column, row + 1)
    computed.set(id, { x: column * LAYOUT_COLUMN_GAP, y: row * LAYOUT_ROW_GAP })
  }

  // 既存の座標は残し(挿入順も保つ)、ないものだけを後ろに足す
  const positions = new Map(layout.positions)
  for (const id of allIds) {
    const position = computed.get(id)
    if (!positions.has(id) && position !== undefined) positions.set(id, position)
  }
  return { ...document, layout: { ...layout, positions } }
}
