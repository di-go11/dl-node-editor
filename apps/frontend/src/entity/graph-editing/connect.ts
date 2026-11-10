import { upstreamNodeIds } from '../model-graph/graph-queries'
import type { ModelGraph } from '../model-graph/model-graph'
import {
  appendInput,
  findNode,
  removeInputAt,
  setInput,
  setOutputs,
} from '../model-graph/model-graph'
import { arePortKindsCompatible, nodeOutput } from '../model-graph/port'
import type { PortKind } from '../model-graph/port'
import type { NodeCatalog } from '../node-catalog/catalog'
import { findNodeType } from '../node-catalog/catalog'
import type { InputPortDef, NodeTypeDef, OutputPortDef } from '../node-catalog/node-type'
import { inputPortDef, outputPortDef } from '../node-catalog/node-type'
import { resolveOutputKind } from '../validation/port-kind-resolution'

import type { ConnectionRef, SourceEndpoint, TargetEndpoint } from './endpoint'
import {
  GRAPH_INPUT_NODE,
  GRAPH_OUTPUT_NODE,
  isGraphInputNode,
  isGraphOutputNode,
  sourceToPortRef,
} from './endpoint'

/**
 * 接続の規則 - 「何と何をつないでよいか」と「つないだらグラフがどう変わるか」。
 *
 * ## なぜエンティティ層に置くのか
 *
 * つないでよいかは、層の意味(ポートの種類、複数つなげるか)から決まる
 * ドメインの規則であって、UI の都合ではない。React Flow の isValidConnection に
 * 直接書くと、ライブラリを替えたときに規則まで書き直すことになり、
 * 単体テストにも画面が要る。ここに置けば、React Flow 側はこの関数を呼ぶだけになる。
 *
 * ## 検証層(validation/)との分担
 *
 * ここで拒否するのは「つないだ瞬間に確実に誤りだと分かるもの」だけである。
 * 上流がまだつながっておらず Any の種類が決まらない場合などは、つなぐことを許し、
 * 判定は整合性チェックに任せる。編集の途中では情報が揃っていないのが普通であり、
 * 迷ったときに拒否すると、組み立てる順番を利用者に強制してしまうからである。
 */

export type ConnectionRejectCode =
  'unknown-node' | 'unknown-port' | 'self-loop' | 'input-to-output' | 'cycle' | 'kind-mismatch'

export type ConnectionCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ConnectionRejectCode; readonly reason: string }

const reject = (code: ConnectionRejectCode, reason: string): ConnectionCheck => ({
  ok: false,
  code,
  reason,
})

type ResolvedSource = { readonly def: NodeTypeDef; readonly port: OutputPortDef }
type ResolvedTarget = { readonly def: NodeTypeDef; readonly port: InputPortDef }

function resolveSource(
  graph: ModelGraph,
  catalog: NodeCatalog,
  source: SourceEndpoint,
): ResolvedSource | ConnectionCheck {
  const typeId = isGraphInputNode(source.node)
    ? GRAPH_INPUT_NODE
    : findNode(graph, source.node)?.spec.kind
  if (typeId === undefined) return reject('unknown-node', `ノード ${source.node} がありません。`)
  const def = findNodeType(catalog, typeId)
  if (def === undefined) return reject('unknown-node', `${typeId} という層の種類は知りません。`)
  const port = outputPortDef(def, source.port)
  if (port === undefined) {
    return reject('unknown-port', `${def.label} に出力ポート ${source.port} はありません。`)
  }
  return { def, port }
}

function resolveTarget(
  graph: ModelGraph,
  catalog: NodeCatalog,
  target: TargetEndpoint,
): ResolvedTarget | ConnectionCheck {
  const typeId = isGraphOutputNode(target.node)
    ? GRAPH_OUTPUT_NODE
    : findNode(graph, target.node)?.spec.kind
  if (typeId === undefined) return reject('unknown-node', `ノード ${target.node} がありません。`)
  const def = findNodeType(catalog, typeId)
  if (def === undefined) return reject('unknown-node', `${typeId} という層の種類は知りません。`)
  const port = inputPortDef(def, target.port)
  if (port === undefined) {
    return reject('unknown-port', `${def.label} に入力ポート ${target.port} はありません。`)
  }
  return { def, port }
}

const isCheck = (value: object): value is ConnectionCheck => 'ok' in value

/**
 * 出力側の実際の種類。Any なら上流をたどって解決する(1c の resolveOutputKind)。
 * 決まらなければ null を返し、呼び出し側は「拒否しない」と判断する。
 */
function actualSourceKind(
  graph: ModelGraph,
  catalog: NodeCatalog,
  source: SourceEndpoint,
): PortKind | null {
  const kind = resolveOutputKind(graph, catalog, sourceToPortRef(source))
  return kind === 'unknown' ? null : kind
}

/**
 * つないでよいかを判定する。
 *
 * 判定する順番は「端が存在するか → 自分自身・Input→Output → 閉路 → 種類」。
 * 安く確かめられて、理由が分かりやすいものから先に見る。
 *
 * 複数つなげないポートに既に接続があっても拒否しない。connect が置き換える
 * (つなぎ直すたびに先に古い線を消させるのは、手間なだけで得るものがない)。
 */
export function checkConnection(
  graph: ModelGraph,
  catalog: NodeCatalog,
  source: SourceEndpoint,
  target: TargetEndpoint,
): ConnectionCheck {
  const resolvedSource = resolveSource(graph, catalog, source)
  if (isCheck(resolvedSource)) return resolvedSource
  const resolvedTarget = resolveTarget(graph, catalog, target)
  if (isCheck(resolvedTarget)) return resolvedTarget

  if (source.node === target.node) {
    return reject('self-loop', 'ノードの出力を、同じノードの入力にはつなげません。')
  }

  if (isGraphInputNode(source.node) && isGraphOutputNode(target.node)) {
    // ModelGraph.outputs は NodeOutputRef しか持てない(グラフ入力をそのまま出力にはできない)
    return reject('input-to-output', 'Input を Output に直接つなぐことはできません。')
  }

  // 閉路: target が source の上流にあるなら、つなぐと source → target → … → source の輪になる
  if (!isGraphInputNode(source.node) && !isGraphOutputNode(target.node)) {
    if (upstreamNodeIds(graph, source.node).has(target.node)) {
      return reject(
        'cycle',
        `${target.node} は ${source.node} の上流にあるため、つなぐと閉路になります。`,
      )
    }
  }

  const sourceKind = actualSourceKind(graph, catalog, source) ?? resolvedSource.port.kind
  if (sourceKind !== 'any' && !arePortKindsCompatible(sourceKind, resolvedTarget.port.kind)) {
    return reject(
      'kind-mismatch',
      `${resolvedSource.def.label}.${source.port}(${sourceKind})は ` +
        `${resolvedTarget.def.label}.${target.port}(${resolvedTarget.port.kind})につなげません。`,
    )
  }

  return { ok: true }
}

export type ConnectResult =
  | { readonly ok: true; readonly graph: ModelGraph }
  | { readonly ok: false; readonly code: ConnectionRejectCode; readonly reason: string }

/**
 * つなぐ。判定(checkConnection)を通らなければ、グラフを変えずに理由を返す。
 *
 * 判定と変更を 1 つの関数にまとめているのは、「判定せずにつなぐ」経路を作らないためである。
 * 呼び出し側が判定を忘れても、規則に反するグラフはできない。
 *
 *   入力先が Output           → outputs を置き換える(Output は当面 1 つだけ)
 *   複数つなげるポート(Add)  → 末尾に足す(つないだ順を保つ。Concat ではチャンネルの順になる)
 *   それ以外                  → そのポートの接続を置き換える
 */
export function connect(
  graph: ModelGraph,
  catalog: NodeCatalog,
  source: SourceEndpoint,
  target: TargetEndpoint,
): ConnectResult {
  const check = checkConnection(graph, catalog, source, target)
  if (!check.ok) return check

  if (isGraphOutputNode(target.node)) {
    // checkConnection が Input → Output を拒否しているので、ここでの source はモデルのノード
    if (isGraphInputNode(source.node)) throw new Error('Input → Output は判定で拒否されるはず')
    return { ok: true, graph: setOutputs(graph, [nodeOutput(source.node, source.port)]) }
  }

  const targetNode = findNode(graph, target.node)
  const def = targetNode === undefined ? undefined : findNodeType(catalog, targetNode.spec.kind)
  const portDef = def === undefined ? undefined : inputPortDef(def, target.port)
  const ref = sourceToPortRef(source)

  return {
    ok: true,
    graph:
      portDef?.variadic === true
        ? appendInput(graph, target.node, target.port, ref)
        : setInput(graph, target.node, target.port, ref),
  }
}

/** 接続を 1 本外す */
export function disconnect(graph: ModelGraph, ref: ConnectionRef): ModelGraph {
  switch (ref.kind) {
    case 'input':
      return removeInputAt(graph, ref.nodeId, ref.index)
    case 'output':
      return setOutputs(
        graph,
        graph.outputs.filter((_output, index) => index !== ref.index),
      )
  }
}

/**
 * 接続をまとめて外す。
 *
 * 位置(index)で指しているので、1 本ずつ外すと後ろの位置がずれる。
 * 同じノードの中では index の大きい順に外せば、まだ外していない接続の位置は変わらない。
 */
export function disconnectAll(graph: ModelGraph, refs: readonly ConnectionRef[]): ModelGraph {
  const sorted = [...refs].sort((a, b) => b.index - a.index)
  return sorted.reduce(disconnect, graph)
}
