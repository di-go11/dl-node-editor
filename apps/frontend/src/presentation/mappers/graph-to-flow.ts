import type { Edge, Node } from '@xyflow/react'

import type { EditorDocument, Position } from '../../entity/document/document'
import type { EditorConnection, EditorNodeId } from '../../entity/graph-editing/endpoint'
import {
  GRAPH_INPUT_NODE,
  GRAPH_OUTPUT_NODE,
  connectionsOf,
  isGraphInputNode,
  isGraphOutputNode,
  sourceToPortRef,
} from '../../entity/graph-editing/endpoint'
import type { ConnectionRef } from '../../entity/graph-editing/endpoint'
import type { PortKind } from '../../entity/model-graph/port'
import type { NodeCatalog } from '../../entity/node-catalog/catalog'
import { findNodeType } from '../../entity/node-catalog/catalog'
import type { InputPortDef, NodeTypeDef, OutputPortDef } from '../../entity/node-catalog/node-type'
import { formatNodeSummary, isAvailableInContext } from '../../entity/node-catalog/node-type'
import type { Issue, Severity } from '../../entity/validation/issue'
import { resolveOutputKind } from '../../entity/validation/port-kind-resolution'
import type { EditorSelection } from '../stores/editor-store'

import { edgeIdsOf } from './flow-ids'

/**
 * ドメイン(EditorDocument)→ React Flow(Node[] / Edge[])の変換。
 *
 * ## なぜマッパーを挟むのか
 *
 * ドメインの型と React Flow の型を分けておけば(指示書 5.1)、React Flow を別の
 * ライブラリに替えても、書き直すのはこのファイルとキャンバスの部品だけで済む。
 * また、この関数は入力から出力を作るだけの純粋関数なので、画面を描かずに
 * 「どんなノードと線が描かれるか」をテストできる。
 *
 * ## 並び順
 *
 * Node[] は [Input, ...graph.nodes の順, Output] にする。React Flow は配列の順に
 * 描くので重なり順にしか影響しないが、ドメインの並び順をそのまま写しておくと、
 * 表示とモデルの対応を目で追いやすい。
 */

export const MODEL_NODE_TYPE = 'model'

/** カスタムノード(2b の ModelNode)が描画に使うデータ。表示に必要なものだけを渡す */
export type ModelNodeData = {
  readonly typeId: string
  readonly label: string
  /** ノード上の要約(例 '3→64, k3')。Input / Output は空 */
  readonly summary: string
  readonly inputs: readonly InputPortDef[]
  readonly outputs: readonly OutputPortDef[]
  readonly editorOnly: boolean
  /** カタログに定義がない(知らない層の種類) */
  readonly unknownType: boolean
  /** 今の条件(データ形式 / 手法)では使えない。フェーズ 3 で赤色表示に使う */
  readonly unavailable: boolean
  /** このノードに付いた問題のうち最も重いもの。なければ null */
  readonly issueSeverity: Severity | null
  readonly issueCount: number
}

export type ModelFlowNode = Node<ModelNodeData, typeof MODEL_NODE_TYPE>

export type ConnectionEdgeData = {
  /** この線を外すときに使う、ModelGraph の中の位置 */
  readonly ref: ConnectionRef
  /** 線を流れるデータの種類(線の色に使う)。決まらなければ 'unknown' */
  readonly kind: PortKind | 'unknown'
}

export type ConnectionFlowEdge = Edge<ConnectionEdgeData>

export type GraphToFlowInput = {
  readonly document: EditorDocument
  readonly catalog: NodeCatalog
  readonly selection: EditorSelection
  /** 検証の結果(ノードに問題の印を付けるのに使う)。後から計算できるので、ストアには持たない */
  readonly issues: readonly Issue[]
}

export type FlowElements = {
  readonly nodes: readonly ModelFlowNode[]
  readonly edges: readonly ConnectionFlowEdge[]
}

/** 座標が保存されていない Input / Output の置き場所 */
export const DEFAULT_GRAPH_IO_POSITIONS: Readonly<Record<string, Position>> = {
  [GRAPH_INPUT_NODE]: { x: 0, y: 0 },
  [GRAPH_OUTPUT_NODE]: { x: 900, y: 0 },
}

/**
 * 座標が保存されていないノードの仮の置き場所。
 * 重ならないよう、並び順に少しずつずらす。きちんとした自動配置はフェーズ 4 で作る。
 */
export function fallbackPosition(index: number): Position {
  return { x: 200 + index * 40, y: 160 + index * 40 }
}

type IssueSummary = { readonly severity: Severity; readonly count: number }

function summarizeIssues(issues: readonly Issue[]): ReadonlyMap<string, IssueSummary> {
  const byNode = new Map<string, IssueSummary>()
  for (const issue of issues) {
    if (issue.nodeId === undefined) continue
    const current = byNode.get(issue.nodeId)
    byNode.set(issue.nodeId, {
      severity: current?.severity === 'error' || issue.severity === 'error' ? 'error' : 'warning',
      count: (current?.count ?? 0) + 1,
    })
  }
  return byNode
}

function nodeData(
  def: NodeTypeDef | undefined,
  fallbackLabel: string,
  params: Parameters<typeof formatNodeSummary>[1],
  input: GraphToFlowInput,
  issue: IssueSummary | undefined,
): ModelNodeData {
  return {
    typeId: def?.typeId ?? fallbackLabel,
    label: def?.label ?? fallbackLabel,
    summary: def === undefined ? '' : formatNodeSummary(def, params),
    inputs: def?.inputs ?? [],
    outputs: def?.outputs ?? [],
    editorOnly: def?.editorOnly ?? false,
    unknownType: def === undefined,
    unavailable: def !== undefined && !isAvailableInContext(def, input.document.context),
    issueSeverity: issue?.severity ?? null,
    issueCount: issue?.count ?? 0,
  }
}

function toFlowNode(
  id: EditorNodeId,
  position: Position,
  data: ModelNodeData,
  selected: boolean,
): ModelFlowNode {
  const isGraphIo = isGraphInputNode(id) || isGraphOutputNode(id)
  return {
    id,
    type: MODEL_NODE_TYPE,
    position,
    data,
    selected,
    // Input / Output はグラフに必ず 1 つずつ要る。Delete キーで消せないようにする
    deletable: !isGraphIo,
  }
}

export function graphToFlow(input: GraphToFlowInput): FlowElements {
  const { document, catalog, selection } = input
  const { graph, layout } = document
  const issuesByNode = summarizeIssues(input.issues)
  const isSelected = (id: string): boolean => selection.nodeIds.includes(id as EditorNodeId)
  const positionOf = (id: string, fallback: Position): Position =>
    layout.positions.get(id) ?? fallback

  const graphIo = (id: typeof GRAPH_INPUT_NODE | typeof GRAPH_OUTPUT_NODE): ModelFlowNode =>
    toFlowNode(
      id,
      positionOf(id, DEFAULT_GRAPH_IO_POSITIONS[id] ?? { x: 0, y: 0 }),
      nodeData(findNodeType(catalog, id), id, {}, input, issuesByNode.get(id)),
      isSelected(id),
    )

  const modelNodes = graph.nodes.map((node, index) =>
    toFlowNode(
      node.id,
      positionOf(node.id, fallbackPosition(index)),
      nodeData(
        findNodeType(catalog, node.spec.kind),
        node.spec.kind,
        node.spec.params,
        input,
        issuesByNode.get(node.id),
      ),
      isSelected(node.id),
    ),
  )

  const nodes = [graphIo(GRAPH_INPUT_NODE), ...modelNodes, graphIo(GRAPH_OUTPUT_NODE)]

  // 存在しないノードを指す線(読み込んだファイルの誤りなど)は描かない。
  // React Flow は端のない線を警告付きで捨てるだけなので、ここで明示的に除く。
  // その誤り自体は検証(reference/missing-node)がログに出す。
  const existing = new Set(nodes.map((node) => node.id))
  const connections = connectionsOf(graph)
  const ids = edgeIdsOf(connections)
  const edges = connections
    .map((connection, index) => toFlowEdge(connection, ids[index] ?? '', input, selection))
    .filter((edge) => existing.has(edge.source) && existing.has(edge.target))

  return { nodes, edges }
}

function toFlowEdge(
  connection: EditorConnection,
  id: string,
  input: GraphToFlowInput,
  selection: EditorSelection,
): ConnectionFlowEdge {
  const { source, target, ref } = connection
  return {
    id,
    source: source.node,
    sourceHandle: source.port,
    target: target.node,
    targetHandle: target.port,
    selected: selection.edgeIds.includes(id),
    data: {
      ref,
      kind: resolveOutputKind(input.document.graph, input.catalog, sourceToPortRef(source)),
    },
  }
}
