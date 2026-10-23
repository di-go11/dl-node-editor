import type { ModelGraph } from '../model-graph/model-graph'
import { hasNode, renameNode } from '../model-graph/model-graph'
import type { NodeId } from '../model-graph/node-id'
import { isReservedNodeId, isValidNodeIdFormat, parseNodeId } from '../model-graph/node-id'

/**
 * ノード ID の付け替え(プロパティパネルの ID 欄)。
 *
 * 入力されたのはただの文字列なので、proto の制約(空でない・英数字と - _ だけ・重複しない)と
 * 予約 ID を確かめてから付け替える。理由を返すので、入力欄の横にそのまま出せる。
 *
 * 付け替えは model-graph.ts の renameNode が、そのノードを指していた接続と出力まで
 * 書き換える。ID を手で変えたせいで線が切れる、ということは起きない。
 */

export type RenameResult =
  | { readonly ok: true; readonly graph: ModelGraph; readonly id: NodeId }
  | { readonly ok: false; readonly reason: string }

export function checkNodeIdInput(graph: ModelGraph, from: NodeId, input: string): RenameResult {
  const raw = input.trim()
  if (raw === '') return { ok: false, reason: 'ID を入力してください。' }
  if (isReservedNodeId(raw)) {
    return { ok: false, reason: `${raw} はエディタ専用に予約されています。` }
  }
  if (!isValidNodeIdFormat(raw)) {
    return { ok: false, reason: 'ID に使えるのは英数字と - _ だけです。' }
  }
  const id = parseNodeId(raw)
  if (id === null) return { ok: false, reason: 'この ID は使えません。' }
  // 同じ ID のまま確定するのは、何もしない操作として許す
  if (id === from) return { ok: true, graph, id }
  if (hasNode(graph, id)) return { ok: false, reason: `${id} は別のノードが使っています。` }
  return { ok: true, graph: renameNode(graph, from, id), id }
}
