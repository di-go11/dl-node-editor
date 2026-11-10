import { danglingSources, findCycle, graphInputConsumers } from '../../model-graph/graph-queries'
import { findNode } from '../../model-graph/model-graph'
import type { NodeId } from '../../model-graph/node-id'
import { findNodeType } from '../../node-catalog/catalog'
import { outputPortDef } from '../../node-catalog/node-type'
import type { Issue, IssueLocation } from '../issue'
import { issueError } from '../issue'
import type { ValidationRule } from '../validation-input'

/**
 * ノード ID の重複を調べる。
 *
 * 形式(英数字と - _ だけ、空でない)と予約 ID の除外は検査していない。
 * NodeId 型は parseNodeId / nodeId を通らないと作れないため、
 * **GraphNode.id が存在する時点で形式は保証されている**(node-id.ts を参照)。
 * 型で保証されていることを実行時に再検査しても、死んだコードが増えるだけである。
 *
 * 一方、重複はグラフ単位でしか判定できないので、ここで調べる必要がある。
 */
export const validateNodeIds: ValidationRule = (input) => {
  const issues: Issue[] = []
  const seen = new Set<string>()
  for (const node of input.graph.nodes) {
    if (seen.has(node.id)) {
      issues.push(
        issueError('node-id/duplicate', `ノード ID が重複しています: ${node.id}`, {
          nodeId: node.id,
        }),
      )
    }
    seen.add(node.id)
  }
  return issues
}

/**
 * グラフの入口と出口を調べる(指示書 8 章「ノードが 1 つ以上ある。Input と Output がある」)。
 *
 * ドメインの型には Input / Output ノードがないため、次のように言い換えている。
 *   Input がある   = グラフ入力につながっているノードが 1 つ以上ある
 *   Output がある  = outputs がちょうど 1 つある
 */
export const validateGraphIo: ValidationRule = (input) => {
  const issues: Issue[] = []
  const { graph } = input

  if (graph.nodes.length === 0) {
    issues.push(issueError('graph/no-nodes', 'ノードが 1 つもありません。'))
    // ノードがないなら入口も出口もないのは当然なので、ここで打ち切る
    return issues
  }

  if (graphInputConsumers(graph).length === 0) {
    issues.push(
      issueError(
        'graph/no-input',
        'Input がどのノードにもつながっていません。入力を受け取るノードが必要です。',
      ),
    )
  }

  if (graph.outputs.length === 0) {
    issues.push(
      issueError('graph/no-output', 'Output に何もつながっていません。モデルの出力が必要です。'),
    )
  } else if (graph.outputs.length > 1) {
    issues.push(
      issueError(
        'graph/multiple-outputs',
        `モデルの出力は当面 1 つだけです(現在 ${graph.outputs.length} 個)。`,
      ),
    )
  }

  return issues
}

/**
 * 閉路がないこと(DAG であること)を調べる。
 *
 * 閉路があると実行順が決められない。findCycle は閉路を構成するノードを
 * 依存をたどった順に返すので、メッセージにそのまま経路を出して原因を追いやすくする。
 */
export const validateAcyclic: ValidationRule = (input) => {
  const cycle = findCycle(input.graph)
  if (cycle === null) return []
  return [
    issueError('graph/cycle', `接続が循環しています: ${cycle.join(' → ')}`, {
      nodeId: cycle[0],
    }),
  ]
}

/**
 * 参照先が実在するかを調べる。
 *
 *   - 存在しないノードを指していないか
 *   - 指しているポートが、そのノードの種類に実在する出力ポートか
 *
 * 後者は、IndexedPooling を Pooling2D に差し替えたときなどに起こる
 * (indices 出力がなくなるのに、下流の Unpooling がまだ指している)。
 */
export const validateReferences: ValidationRule = (input) => {
  const issues: Issue[] = []
  const { graph, catalog } = input

  for (const dangling of danglingSources(graph)) {
    issues.push(
      issueError(
        'reference/missing-node',
        `存在しないノード ${dangling.missingNodeId} につながっています。`,
        { nodeId: dangling.nodeId, port: dangling.port },
      ),
    )
  }

  const checkOutputPort = (
    sourceNodeId: NodeId,
    sourcePort: string,
    location: IssueLocation,
  ): void => {
    const sourceNode = findNode(graph, sourceNodeId)
    if (sourceNode === undefined) return // missing-node として既に報告済み
    const def = findNodeType(catalog, sourceNode.spec.kind)
    if (def === undefined) return // unknown-type として既に報告済み
    if (outputPortDef(def, sourcePort) !== undefined) return
    const available = def.outputs.map((port) => port.name).join(' / ')
    issues.push(
      issueError(
        'reference/unknown-port',
        `${sourceNodeId} に出力ポート ${sourcePort} はありません` +
          (available === '' ? '。' : `(使えるのは ${available})。`),
        location,
      ),
    )
  }

  for (const node of graph.nodes) {
    for (const nodeInput of node.inputs) {
      if (nodeInput.source.kind !== 'node-output') continue
      checkOutputPort(nodeInput.source.nodeId, nodeInput.source.port, {
        nodeId: node.id,
        port: nodeInput.port,
      })
    }
  }

  for (const output of graph.outputs) {
    if (findNode(graph, output.nodeId) === undefined) {
      issues.push(
        issueError(
          'reference/missing-node',
          `モデルの出力が、存在しないノード ${output.nodeId} を指しています。`,
        ),
      )
      continue
    }
    checkOutputPort(output.nodeId, output.port, { nodeId: output.nodeId, port: output.port })
  }

  return issues
}
