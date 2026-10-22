import type { GraphNode, ModelGraph } from './model-graph'
import type { NodeId } from './node-id'
import type { PortRef } from './port'

/**
 * グラフに対する純粋な問い合わせ。
 *
 * ここにはカタログ(ノード定義)を持ち込まない。トポロジー(つながり方)だけを扱い、
 * 「層の種類ごとにポートが何本あるか」といった知識は検証層で合わせる。
 * 責務を分けておくと、グラフ構造のアルゴリズムをノード定義とは独立にテストできる。
 */

/** このノードが直接依存しているノードの ID を、重複なく接続順に返す */
export function dependencyIdsOf(node: GraphNode): readonly NodeId[] {
  const ids: NodeId[] = []
  for (const input of node.inputs) {
    if (input.source.kind !== 'node-output') continue
    if (ids.includes(input.source.nodeId)) continue
    ids.push(input.source.nodeId)
  }
  return ids
}

/** 入力ポート port につながっている最初の接続元(つながっていなければ undefined) */
export function sourceOfPort(node: GraphNode, port: string): PortRef | undefined {
  return node.inputs.find((input) => input.port === port)?.source
}

/** グラフ入力(画像)を受け取っているノードの ID */
export function graphInputConsumers(graph: ModelGraph): readonly NodeId[] {
  return graph.nodes
    .filter((node) => node.inputs.some((input) => input.source.kind === 'graph-input'))
    .map((node) => node.id)
}

/**
 * 存在しないノードを指している接続を列挙する。
 * ノードを消すときは removeNode が参照も消すので通常は空だが、
 * 外部から読み込んだファイルでは起こりうる。
 */
export function danglingSources(
  graph: ModelGraph,
): readonly { nodeId: NodeId; port: string; missingNodeId: NodeId }[] {
  const existing = new Set(graph.nodes.map((node) => node.id))
  const result: { nodeId: NodeId; port: string; missingNodeId: NodeId }[] = []
  for (const node of graph.nodes) {
    for (const input of node.inputs) {
      if (input.source.kind !== 'node-output') continue
      if (existing.has(input.source.nodeId)) continue
      result.push({ nodeId: node.id, port: input.port, missingNodeId: input.source.nodeId })
    }
  }
  return result
}

/**
 * 閉路を 1 つ探す。見つからなければ null。
 *
 * 深さ優先探索で、探索中(visiting)のノードに再び到達したら閉路である。
 * 返すのは閉路を構成するノードを、依存をたどった順(下流 → 上流)に並べたもので、
 * 最後の要素は最初の要素と同じ ID になる(閉じていることを示すため)。
 *
 * 存在しないノードへの参照はここでは無視する。別の問題として danglingSources が報告する。
 * 1 つの検査が複数の問題を兼ねると、原因と結果が混ざって読みにくくなるためである。
 */
export function findCycle(graph: ModelGraph): readonly NodeId[] | null {
  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const))
  const state = new Map<NodeId, 'visiting' | 'done'>()
  const path: NodeId[] = []

  const visit = (id: NodeId): readonly NodeId[] | null => {
    const current = state.get(id)
    if (current === 'done') return null
    if (current === 'visiting') {
      const start = path.indexOf(id)
      return [...path.slice(start), id]
    }

    const node = byId.get(id)
    if (node === undefined) return null

    state.set(id, 'visiting')
    path.push(id)
    for (const dependency of dependencyIdsOf(node)) {
      const cycle = visit(dependency)
      if (cycle !== null) return cycle
    }
    path.pop()
    state.set(id, 'done')
    return null
  }

  for (const node of graph.nodes) {
    const cycle = visit(node.id)
    if (cycle !== null) return cycle
  }
  return null
}

/**
 * 実行順(上流から下流へ)を返す。閉路があれば null。
 *
 * nodes の並び順を走査の基準にしているので、結果は常に同じになる(決定的である)。
 * 同じグラフなのに実行順が実行ごとに変わると、デバッグのときに再現できなくなる。
 *
 * なお **nodes の並び順そのものは変えない**。proto の nodes の順序は重みの初期化と
 * checkpoint の対応を決めるため(指示書 7.3)、実行順に並べ替えてはならない。
 * この関数は「実行順の問い合わせ」であって、並べ替えではない。
 */
export function topologicalOrder(graph: ModelGraph): readonly NodeId[] | null {
  const existing = new Set(graph.nodes.map((node) => node.id))
  const emitted = new Set<NodeId>()
  const order: NodeId[] = []

  let progressed = true
  while (progressed && order.length < graph.nodes.length) {
    progressed = false
    for (const node of graph.nodes) {
      if (emitted.has(node.id)) continue
      const ready = dependencyIdsOf(node)
        .filter((id) => existing.has(id))
        .every((id) => emitted.has(id))
      if (!ready) continue
      emitted.add(node.id)
      order.push(node.id)
      progressed = true
    }
  }

  return order.length === graph.nodes.length ? order : null
}

/** id より上流にあるノードの ID を、すべて(推移的に)返す */
export function upstreamNodeIds(graph: ModelGraph, id: NodeId): ReadonlySet<NodeId> {
  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const))
  const visited = new Set<NodeId>()

  const walk = (current: NodeId): void => {
    const node = byId.get(current)
    if (node === undefined) return
    for (const dependency of dependencyIdsOf(node)) {
      if (visited.has(dependency)) continue
      visited.add(dependency)
      walk(dependency)
    }
  }

  walk(id)
  return visited
}
