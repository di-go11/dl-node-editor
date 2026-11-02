import { inputsOfPort } from '../../model-graph/model-graph'
import { arePortKindsCompatible } from '../../model-graph/port'
import type { PortKind } from '../../model-graph/port'
import type { Issue } from '../issue'
import { issueError } from '../issue'
import { resolveOutputKind } from '../port-kind-resolution'
import type { ValidationRule } from '../validation-input'
import { nodeTypeOf } from '../validation-input'

const PORT_KIND_LABELS: Readonly<Record<PortKind, string>> = {
  feature: '特徴マップ',
  tokens: 'トークン列',
  indices: 'プーリングの位置情報',
  any: '任意',
}

/**
 * 入力ポートにつながっている本数を調べる(指示書 8 章)。
 *
 *   - つながっていない        … proto の「入力ポートにはちょうど 1 本つなぐ」に違反
 *   - 複数つなげないポートに 2 本以上
 *   - 複数つなげるポート(Add / Concat の x)が minCount に足りない
 *   - 定義にないポートにつながっている
 *
 * 本数の正本はカタログの InputPortDef(variadic / minCount)で、
 * これは NodePorts.hpp から転記したものである。
 */
export const validateInputArity: ValidationRule = (input) => {
  const issues: Issue[] = []

  for (const node of input.graph.nodes) {
    const def = nodeTypeOf(input.catalog, node)
    if (def === undefined) continue // node/unknown-type として報告済み

    for (const portDef of def.inputs) {
      const connections = inputsOfPort(node, portDef.name)

      if (connections.length === 0) {
        issues.push(
          issueError('port/not-connected', `入力ポート ${portDef.name} が未接続です。`, {
            nodeId: node.id,
            port: portDef.name,
          }),
        )
        continue
      }

      if (!portDef.variadic && connections.length > 1) {
        issues.push(
          issueError(
            'port/too-many-connections',
            `入力ポート ${portDef.name} につなげるのは 1 本までです(現在 ${connections.length} 本)。`,
            { nodeId: node.id, port: portDef.name },
          ),
        )
        continue
      }

      if (connections.length < portDef.minCount) {
        issues.push(
          issueError(
            'port/too-few-connections',
            `${def.label} の入力ポート ${portDef.name} には ${portDef.minCount} 本以上つなぐ必要があります(現在 ${connections.length} 本)。`,
            { nodeId: node.id, port: portDef.name },
          ),
        )
      }
    }

    // 定義にないポートへの接続。ノードの種類を差し替えたときに残ることがある
    const declared = new Set(def.inputs.map((portDef) => portDef.name))
    const reported = new Set<string>()
    for (const nodeInput of node.inputs) {
      if (declared.has(nodeInput.port) || reported.has(nodeInput.port)) continue
      reported.add(nodeInput.port)
      const available = def.inputs.map((portDef) => portDef.name).join(' / ')
      issues.push(
        issueError(
          'port/unknown-input',
          `${def.label} に入力ポート ${nodeInput.port} はありません` +
            (available === '' ? '。' : `(使えるのは ${available})。`),
          { nodeId: node.id, port: nodeInput.port },
        ),
      )
    }
  }

  return issues
}

/**
 * つないだポートの種類が合っているかを調べる(指示書 8 章)。
 *
 * 上流の Any は port-kind-resolution で具体的な種類に解決してから比べる。
 * 解決できない(unknown)ときは何も報告しない。未接続や知らない層といった
 * 「解決できない理由」は別のルールが報告しているためである。
 */
export const validatePortKinds: ValidationRule = (input) => {
  const issues: Issue[] = []

  for (const node of input.graph.nodes) {
    const def = nodeTypeOf(input.catalog, node)
    if (def === undefined) continue

    for (const nodeInput of node.inputs) {
      const portDef = def.inputs.find((candidate) => candidate.name === nodeInput.port)
      if (portDef === undefined) continue // port/unknown-input として報告済み

      const sourceKind = resolveOutputKind(input.graph, input.catalog, nodeInput.source)
      if (sourceKind === 'unknown') continue

      if (arePortKindsCompatible(sourceKind, portDef.kind)) continue

      issues.push(
        issueError(
          'port/kind-mismatch',
          `入力ポート ${portDef.name} は ${PORT_KIND_LABELS[portDef.kind]} を受け取りますが、` +
            `つながっているのは ${PORT_KIND_LABELS[sourceKind]} です。`,
          { nodeId: node.id, port: nodeInput.port },
        ),
      )
    }
  }

  return issues
}
