import type { NodeId } from './node-id'
import type { NodeSpec } from './node-spec'
import type { NodeOutputRef, PortRef } from './port'
import { portRefEquals } from './port'

/**
 * このノードの入力ポート port に、source が指す出力をつなぐ(proto の NodeInput)。
 *
 * 同じ port が複数回現れることがある(Add / Concat の 'x')。
 * **その並び順には意味がある** - Concat はつないだ順にチャンネルが並ぶため。
 */
export type NodeInput = {
  readonly port: string
  readonly source: PortRef
}

export type GraphNode = {
  readonly id: NodeId
  readonly spec: NodeSpec
  readonly inputs: readonly NodeInput[]
}

/**
 * モデル構造。proto の ModelGraph に対応する。
 *
 * ただしこの型は **契約より緩い**。proto の契約は「入力ポートにはちょうど 1 本つなぐ」
 * 「outputs はちょうど 1 つ」だが、編集中はつながっていないノードが当然あるため、
 * ここでは 0 本も空も表せるようにしている。
 * 「送れる状態か」は検証(validation/)が判定する責務であって、型の責務ではない。
 */
export type ModelGraph = {
  /**
   * **並び順に意味がある。** 重みの初期化と checkpoint の重みの対応はこの順で決まるため、
   * 移動・選択・再描画で順番を変えてはならない(指示書 7.3)。
   * 以下の操作関数はすべてこの順序を保つ。
   */
  readonly nodes: readonly GraphNode[]
  /** モデルの出力。グラフ入力は指定できないので NodeOutputRef に限定している */
  readonly outputs: readonly NodeOutputRef[]
}

export function emptyModelGraph(): ModelGraph {
  return { nodes: [], outputs: [] }
}

export function findNode(graph: ModelGraph, id: NodeId): GraphNode | undefined {
  return graph.nodes.find((node) => node.id === id)
}

export function hasNode(graph: ModelGraph, id: NodeId): boolean {
  return findNode(graph, id) !== undefined
}

/** 入力ポート port につながっている接続を、つないだ順に返す */
export function inputsOfPort(node: GraphNode, port: string): readonly NodeInput[] {
  return node.inputs.filter((input) => input.port === port)
}

/**
 * ノードを末尾に足す。
 *
 * ID の重複はここでは拒否しない。編集中の一時的な不整合も表せるようにし、
 * 判定は検証層に任せる(この型の設計方針と合わせている)。
 */
export function addNode(graph: ModelGraph, node: GraphNode): ModelGraph {
  return { ...graph, nodes: [...graph.nodes, node] }
}

/**
 * ノードを消す。そのノードを参照していた接続と出力も一緒に消す。
 *
 * 参照だけが残ると「存在しないノードを指す接続」になり、proto の制約に違反する。
 * 消し忘れを呼び出し側の責任にしないよう、この操作の中で閉じている。
 */
export function removeNode(graph: ModelGraph, id: NodeId): ModelGraph {
  const referencesRemoved = (ref: PortRef): boolean =>
    ref.kind === 'node-output' && ref.nodeId === id

  return {
    nodes: graph.nodes
      .filter((node) => node.id !== id)
      .map((node) => ({
        ...node,
        inputs: node.inputs.filter((input) => !referencesRemoved(input.source)),
      })),
    outputs: graph.outputs.filter((output) => !referencesRemoved(output)),
  }
}

/** ノードの ID を変える。そのノードを指していた参照もすべて書き換える */
export function renameNode(graph: ModelGraph, from: NodeId, to: NodeId): ModelGraph {
  const rename = <T extends PortRef>(ref: T): T =>
    ref.kind === 'node-output' && ref.nodeId === from ? { ...ref, nodeId: to } : ref

  return {
    nodes: graph.nodes.map((node) => ({
      ...node,
      id: node.id === from ? to : node.id,
      inputs: node.inputs.map((input) => ({ ...input, source: rename(input.source) })),
    })),
    outputs: graph.outputs.map(rename),
  }
}

/** ノードのパラメータ(NodeSpec)を差し替える */
export function replaceNodeSpec(graph: ModelGraph, id: NodeId, spec: NodeSpec): ModelGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === id ? { ...node, spec } : node)),
  }
}

/**
 * 入力ポート port の接続を 1 本だけにする(複数つなげないポート用)。
 * 既にあった接続は置き換えられる。port 以外の接続の並び順は保たれる。
 */
export function setInput(
  graph: ModelGraph,
  targetId: NodeId,
  port: string,
  source: PortRef,
): ModelGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.id !== targetId) return node
      const others = node.inputs.filter((input) => input.port !== port)
      return { ...node, inputs: [...others, { port, source }] }
    }),
  }
}

/**
 * 入力ポート port に接続を 1 本足す(Add / Concat のように複数つなげるポート用)。
 * **末尾に足す**ことで、つないだ順を保つ。
 */
export function appendInput(
  graph: ModelGraph,
  targetId: NodeId,
  port: string,
  source: PortRef,
): ModelGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === targetId ? { ...node, inputs: [...node.inputs, { port, source }] } : node,
    ),
  }
}

/**
 * 接続を外す。source を渡せばその 1 本だけ、省略すれば port 上のすべてを外す。
 */
export function removeInput(
  graph: ModelGraph,
  targetId: NodeId,
  port: string,
  source?: PortRef,
): ModelGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.id !== targetId) return node
      return {
        ...node,
        inputs: node.inputs.filter(
          (input) =>
            input.port !== port || (source !== undefined && !portRefEquals(input.source, source)),
        ),
      }
    }),
  }
}

/**
 * 接続を 1 本だけ外す。index は node.inputs の中での位置。
 *
 * removeInput(source 指定)では区別できない場合のためにある。Add に同じ出力を
 * 2 本つなぐ(x + x)と、2 本は source も port も同じになり、source で指定すると
 * 両方が消えてしまう。位置で指定すれば、画面で選んだ 1 本だけを外せる。
 * 範囲外の index なら何もしない。
 */
export function removeInputAt(graph: ModelGraph, targetId: NodeId, index: number): ModelGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === targetId
        ? { ...node, inputs: node.inputs.filter((_input, i) => i !== index) }
        : node,
    ),
  }
}

/** モデルの出力を差し替える(当面 1 つだけだが、型は複数を表せるままにしておく) */
export function setOutputs(graph: ModelGraph, outputs: readonly NodeOutputRef[]): ModelGraph {
  return { ...graph, outputs }
}
