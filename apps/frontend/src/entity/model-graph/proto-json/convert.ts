import type { GraphNode, ModelGraph, NodeInput } from '../model-graph'
import { nodeId } from '../node-id'
import type { NodeSpec } from '../node-spec'
import { GRAPH_INPUT, nodeOutput } from '../port'
import type { NodeOutputRef, PortRef } from '../port'

import type {
  ModelGraphJson,
  NodeInputJson,
  NodeJson,
  NodeOutputRefJson,
  NodeSpecJson,
  PortRefJson,
} from './schema'

/**
 * JSON 表記 ⇄ エンティティの型 の双方向変換。
 *
 * 入力側(fromProtoJson)には **modelGraphJsonSchema を通した値を渡すこと。**
 * 検証済みを前提にしているため、ID が不正なら例外になる(プログラムの誤りとして扱う)。
 * 外部入力はまず safeParse し、失敗を Issue に変換してから呼ぶ。
 *
 * ## 正規化について
 *
 * グラフ入力は proto では「node_id が空」で表されるが、`{}` / `{"node_id": ""}` /
 * `{"node_id": "", "port": ""}` のどれも同じ意味になる。エンティティ側では
 * GRAPH_INPUT という 1 つの値にまとめ、書き出すときは常に `{}` にする。
 * 表現を 1 つに決めておかないと、往復のたびに差分が出て比較ができなくなる。
 */

function portRefFromJson(json: PortRefJson): PortRef {
  if (json.node_id === undefined || json.node_id === '') {
    return GRAPH_INPUT
  }
  return nodeOutput(nodeId(json.node_id), json.port ?? '')
}

function portRefToJson(ref: PortRef): PortRefJson {
  if (ref.kind === 'graph-input') return {}
  return { node_id: ref.nodeId, port: ref.port }
}

function nodeSpecFromJson(json: NodeSpecJson): NodeSpec {
  const entries = Object.entries(json)
  const entry = entries[0]
  if (entries.length !== 1 || entry === undefined) {
    throw new Error('spec は層の種類をちょうど 1 つだけ持つ必要があります')
  }
  const [kind, params] = entry
  // kind が既知の層であることは schema.ts の refine が保証している
  return { kind: kind as NodeSpec['kind'], params: { ...params } }
}

function nodeSpecToJson(spec: NodeSpec): NodeSpecJson {
  // 層の種類をキーにしたオブジェクト 1 つにする(proto の oneof の JSON 表記)
  return { [spec.kind]: { ...spec.params } }
}

function nodeInputFromJson(json: NodeInputJson): NodeInput {
  return { port: json.port, source: portRefFromJson(json.source) }
}

function nodeInputToJson(input: NodeInput): NodeInputJson {
  return { port: input.port, source: portRefToJson(input.source) }
}

function nodeFromJson(json: NodeJson): GraphNode {
  return {
    id: nodeId(json.id),
    spec: nodeSpecFromJson(json.spec),
    // 並び順をそのまま保つ。Concat はつないだ順にチャンネルが並ぶため、
    // inputs の順序は意味を持つ(model_graph.proto のコメントを参照)。
    inputs: json.inputs.map(nodeInputFromJson),
  }
}

function nodeToJson(node: GraphNode): NodeJson {
  return {
    id: node.id,
    spec: nodeSpecToJson(node.spec),
    inputs: node.inputs.map(nodeInputToJson),
  }
}

function nodeOutputRefFromJson(json: NodeOutputRefJson): NodeOutputRef {
  return nodeOutput(nodeId(json.node_id), json.port)
}

function nodeOutputRefToJson(ref: NodeOutputRef): NodeOutputRefJson {
  return { node_id: ref.nodeId, port: ref.port }
}

export function fromProtoJson(json: ModelGraphJson): ModelGraph {
  return {
    // nodes の並び順をそのまま保つ。重みの初期化と checkpoint の重みの対応が
    // この順序で決まるため(指示書 7.3)。
    nodes: json.nodes.map(nodeFromJson),
    outputs: json.outputs.map(nodeOutputRefFromJson),
  }
}

export function toProtoJson(graph: ModelGraph): ModelGraphJson {
  return {
    nodes: graph.nodes.map(nodeToJson),
    outputs: graph.outputs.map(nodeOutputRefToJson),
  }
}
