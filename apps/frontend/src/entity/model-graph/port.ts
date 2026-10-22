import type { NodeId } from './node-id'

/**
 * ポートの種類(PortKinds.hpp の PortKind に対応)。
 *
 *   feature  特徴マップ (N, C, H, W)
 *   tokens   トークン列 (N, L, D)。Transformer 系で使う
 *   indices  Pooling が出す最大値の位置。Unpooling にだけつなげる
 *   any      入力の種類に合わせる(Activation, Dropout, Add, Concat など)
 *
 * エディタではこの種類ごとにポートの色を変える(指示書 4.2)。
 */
export const PORT_KINDS = ['feature', 'tokens', 'indices', 'any'] as const

export type PortKind = (typeof PORT_KINDS)[number]

/**
 * ノードの出力ポート 1 つを指す参照。
 */
export type NodeOutputRef = {
  readonly kind: 'node-output'
  readonly nodeId: NodeId
  readonly port: string
}

/**
 * グラフ入力(モデルに入ってくる画像)を指す参照。
 *
 * proto では「node_id が空文字なら グラフ入力」という表し方だが、エンティティ層では
 * 別の種類として明示する。「空文字という特別な値」を使うと、うっかり素の文字列比較を
 * 書いたときに静かに壊れる。判別可能合併にすれば、分岐の書き忘れを型が教えてくれる。
 */
export type GraphInputRef = {
  readonly kind: 'graph-input'
}

export type PortRef = GraphInputRef | NodeOutputRef

export const GRAPH_INPUT: GraphInputRef = { kind: 'graph-input' }

export function nodeOutput(id: NodeId, port: string): NodeOutputRef {
  return { kind: 'node-output', nodeId: id, port }
}

export function isGraphInput(ref: PortRef): ref is GraphInputRef {
  return ref.kind === 'graph-input'
}

export function isNodeOutput(ref: PortRef): ref is NodeOutputRef {
  return ref.kind === 'node-output'
}

export function portRefEquals(a: PortRef, b: PortRef): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'graph-input' || b.kind === 'graph-input') return true
  return a.nodeId === b.nodeId && a.port === b.port
}

/**
 * 出力ポートの種類と入力ポートの種類をつなげるかを判定する(指示書 8 章)。
 *
 *   - indices は indices どうししかつなげない。
 *     Pooling が出す「位置」は特徴マップとは意味が違い、Unpooling 以外では使えないため。
 *   - any はそれ以外のどれにでも合わせられる(NodePorts.hpp のコメントより、
 *     any が意味するのは「feature にも tokens にも使える」であって indices は含まない)。
 *
 * ここは 2 つの種類だけを見る局所的な判定である。any が実際にどの種類になるかは
 * 上流をたどって決まるため、その解決は検証層(カタログを参照できる層)で行う。
 */
export function arePortKindsCompatible(source: PortKind, target: PortKind): boolean {
  if (source === 'indices' || target === 'indices') {
    return source === target
  }
  return source === target || source === 'any' || target === 'any'
}
