import type { Connection, Dimensions, EdgeChange, NodeChange, XYPosition } from '@xyflow/react'

import type {
  EditorNodeId,
  SourceEndpoint,
  TargetEndpoint,
} from '../../entity/graph-editing/endpoint'
import {
  GRAPH_INPUT_NODE,
  GRAPH_OUTPUT_NODE,
  isGraphInputNode,
  isGraphOutputNode,
} from '../../entity/graph-editing/endpoint'
import { parseNodeId } from '../../entity/model-graph/node-id'
import type { EditorSelection } from '../stores/editor-store'

import type { ModelFlowNode } from './graph-to-flow'

/**
 * React Flow → ドメイン の向きの変換(graph-to-flow.ts の逆向き)。
 *
 * 制御モードの React Flow は、利用者の操作を「変更(change)の配列」として知らせてくる
 * (ノードが動いた、選択された、大きさが測れた …)。この配列を、ストアの操作に
 * 読み替えるのがこのモジュールである。
 *
 * コンポーネントの中に直接書かず純粋関数にしているのは、画面を描かなくても
 * 「この変更が来たら、こう読み替える」をテストできるようにするためである。
 *
 * 削除('remove')はここでは扱わない。ノードの削除には線の削除が伴い、両方を
 * 同じ時点の状態から処理する必要があるので、React Flow の onDelete でまとめて受ける
 * (ストアの deleteElements を参照)。
 */

export type NodeChangeEffects = {
  /** ドメインに書き込む座標の変更 */
  readonly moves: readonly { readonly id: EditorNodeId; readonly position: XYPosition }[]
  /** 選択の変更。変更がなければ null */
  readonly selection: EditorSelection | null
  /** React Flow が測ったノードの大きさ。表示だけの情報なので、ストアには入れない */
  readonly measurements: readonly { readonly id: string; readonly dimensions: Dimensions }[]
}

/** React Flow のノード ID(文字列)を、エディタのノード ID として読む */
export function toEditorNodeId(id: string): EditorNodeId | null {
  if (isGraphInputNode(id)) return GRAPH_INPUT_NODE
  if (isGraphOutputNode(id)) return GRAPH_OUTPUT_NODE
  return parseNodeId(id)
}

function applySelectChanges<T extends string>(
  current: readonly T[],
  changes: readonly { readonly id: T; readonly selected: boolean }[],
): readonly T[] {
  const next = new Set(current)
  for (const change of changes) {
    if (change.selected) next.add(change.id)
    else next.delete(change.id)
  }
  return [...next]
}

export function interpretNodeChanges(
  changes: readonly NodeChange<ModelFlowNode>[],
  selection: EditorSelection,
): NodeChangeEffects {
  const moves: { id: EditorNodeId; position: XYPosition }[] = []
  const selects: { id: EditorNodeId; selected: boolean }[] = []
  const measurements: { id: string; dimensions: Dimensions }[] = []

  for (const change of changes) {
    switch (change.type) {
      case 'position': {
        const id = toEditorNodeId(change.id)
        // ドラッグの終わりには position のない変更が来る。そのときは何も書かない
        if (id !== null && change.position !== undefined) {
          moves.push({ id, position: change.position })
        }
        break
      }
      case 'select': {
        const id = toEditorNodeId(change.id)
        if (id !== null) selects.push({ id, selected: change.selected })
        break
      }
      case 'dimensions':
        if (change.dimensions !== undefined) {
          measurements.push({ id: change.id, dimensions: change.dimensions })
        }
        break
      // 'remove' は onDelete で、'add' / 'replace' はこのエディタでは起きない(ノードはストア経由で足す)
      default:
        break
    }
  }

  return {
    moves,
    selection:
      selects.length === 0
        ? null
        : { ...selection, nodeIds: applySelectChanges(selection.nodeIds, selects) },
    measurements,
  }
}

/** 線の変更から、新しい選択状態を作る。選択の変更がなければ null */
export function interpretEdgeChanges(
  changes: readonly EdgeChange[],
  selection: EditorSelection,
): EditorSelection | null {
  const selects = changes.flatMap((change) =>
    change.type === 'select' ? [{ id: change.id, selected: change.selected }] : [],
  )
  if (selects.length === 0) return null
  return { ...selection, edgeIds: applySelectChanges(selection.edgeIds, selects) }
}

/**
 * React Flow の Connection(線を引き終えたときの情報)を、端点の組にする。
 *
 * Connection のノード ID とハンドル ID はただの文字列なので、型の上では何でもありうる。
 * Output を出力側に、Input を入力側に使っているなど、端点になれない組なら null を返す。
 */
export function endpointsOfConnection(
  connection: Connection,
): { readonly source: SourceEndpoint; readonly target: TargetEndpoint } | null {
  const { sourceHandle, targetHandle } = connection
  if (sourceHandle === null || targetHandle === null) return null

  const sourceNode = toEditorNodeId(connection.source)
  const targetNode = toEditorNodeId(connection.target)
  if (sourceNode === null || targetNode === null) return null
  if (isGraphOutputNode(sourceNode) || isGraphInputNode(targetNode)) return null

  return {
    source: { node: sourceNode, port: sourceHandle },
    target: { node: targetNode, port: targetHandle },
  }
}

/**
 * マッパーの出力に、React Flow が測ったノードの大きさを書き戻す。
 *
 * 制御モードでは、渡したノードに measured がないと React Flow は「まだ測っていない」と
 * みなし、描画のたびに測り直す(@xyflow/system の adoptUserNodes)。大きさはドメインの
 * 情報ではないのでストアには入れず、キャンバスの部品が持つこの表から補う。
 */
export function withMeasurements(
  nodes: readonly ModelFlowNode[],
  measured: ReadonlyMap<string, Dimensions>,
): ModelFlowNode[] {
  return nodes.map((node) => {
    const dimensions = measured.get(node.id)
    return dimensions === undefined ? node : { ...node, measured: dimensions }
  })
}
