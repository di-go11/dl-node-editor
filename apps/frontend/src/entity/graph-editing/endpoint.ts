import type { ModelGraph } from '../model-graph/model-graph'
import type { NodeId } from '../model-graph/node-id'
import { GRAPH_INPUT, nodeOutput } from '../model-graph/port'
import type { NodeOutputRef, PortRef } from '../model-graph/port'
import { graphInputType, graphOutputType } from '../node-catalog/entries/graph-io'

/**
 * 端点(エンドポイント) - エディタの上で「接続の端」になるもの。
 *
 * ## なぜこの型が必要か
 *
 * ドメインの ModelGraph には Input / Output のノードがない(proto に合わせているため)。
 *
 *   エディタの見た目                    ModelGraph での表し方
 *   [Input].y ──▶ [conv1].x            conv1.inputs = [{ port: 'x', source: GRAPH_INPUT }]
 *   [conv9].y ──▶ [Output].x           outputs = [{ nodeId: 'conv9', port: 'y' }]
 *
 * 一方、画面では Input / Output も普通のノードとして見せ、同じ操作でつなぎたい。
 * この差を UI のあちこちで if 文で吸収すると、同じ分岐が散らばる。そこで
 * 「Input / Output も含めて端を表す型」を 1 つ決め、ModelGraph との対応を
 * このモジュールに閉じ込める。
 *
 * 出力側(source)と入力側(target)で型を分けているのは、Input は出力側にしか、
 * Output は入力側にしかなれないことを型で表すためである。
 */

export const GRAPH_INPUT_NODE = graphInputType.typeId
export const GRAPH_OUTPUT_NODE = graphOutputType.typeId

/**
 * Input ノードの出力ポート名と、Output ノードの入力ポート名。
 * カタログ(graph-io.ts)の定義と一致していることは endpoint.test.ts で確かめている。
 */
export const GRAPH_INPUT_PORT = 'y'
export const GRAPH_OUTPUT_PORT = 'x'

/** エディタ上のノードの ID。モデルのノードか、Input / Output の予約 ID */
export type EditorNodeId = NodeId | typeof GRAPH_INPUT_NODE | typeof GRAPH_OUTPUT_NODE

/** 接続の出力側の端 */
export type SourceEndpoint = {
  readonly node: NodeId | typeof GRAPH_INPUT_NODE
  readonly port: string
}

/** 接続の入力側の端 */
export type TargetEndpoint = {
  readonly node: NodeId | typeof GRAPH_OUTPUT_NODE
  readonly port: string
}

export function isGraphInputNode(id: string): id is typeof GRAPH_INPUT_NODE {
  return id === GRAPH_INPUT_NODE
}

export function isGraphOutputNode(id: string): id is typeof GRAPH_OUTPUT_NODE {
  return id === GRAPH_OUTPUT_NODE
}

/** 出力側の端 → ModelGraph の PortRef(Input なら GRAPH_INPUT) */
export function sourceToPortRef(source: SourceEndpoint): PortRef {
  return isGraphInputNode(source.node) ? GRAPH_INPUT : nodeOutput(source.node, source.port)
}

/** ModelGraph の PortRef → 出力側の端(GRAPH_INPUT なら Input ノードの出力ポート) */
export function portRefToSource(ref: PortRef): SourceEndpoint {
  return ref.kind === 'graph-input'
    ? { node: GRAPH_INPUT_NODE, port: GRAPH_INPUT_PORT }
    : { node: ref.nodeId, port: ref.port }
}

/**
 * 接続 1 本を、ModelGraph の中の位置で指す。
 *
 * 接続を外すときに使う。端点の組では、Add に同じ出力を 2 本つないだ場合(x + x)に
 * どちらの 1 本かを区別できないため、位置(index)で指す。
 */
export type ConnectionRef =
  /** nodes の中の nodeId のノードの、inputs[index] */
  | { readonly kind: 'input'; readonly nodeId: NodeId; readonly index: number }
  /** outputs[index] */
  | { readonly kind: 'output'; readonly index: number }

export type EditorConnection = {
  readonly ref: ConnectionRef
  readonly source: SourceEndpoint
  readonly target: TargetEndpoint
}

/**
 * グラフの中のすべての接続を、エディタの言葉(端点の組)で列挙する。
 *
 * 並びは「nodes の順 → 各ノードの inputs の順 → outputs の順」で決定的である。
 * 描画のたびに順番が変わらないので、表示側で差分を比べやすい。
 */
export function connectionsOf(graph: ModelGraph): readonly EditorConnection[] {
  const fromInputs = graph.nodes.flatMap((node) =>
    node.inputs.map((input, index): EditorConnection => ({
      ref: { kind: 'input', nodeId: node.id, index },
      source: portRefToSource(input.source),
      target: { node: node.id, port: input.port },
    })),
  )
  const fromOutputs = graph.outputs.map((output: NodeOutputRef, index): EditorConnection => ({
    ref: { kind: 'output', index },
    source: { node: output.nodeId, port: output.port },
    target: { node: GRAPH_OUTPUT_NODE, port: GRAPH_OUTPUT_PORT },
  }))
  return [...fromInputs, ...fromOutputs]
}
