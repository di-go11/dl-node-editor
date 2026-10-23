import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
} from '@xyflow/react'
import type {
  Connection,
  Dimensions,
  Edge,
  EdgeChange,
  NodeChange,
  OnDelete,
  Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DragEvent } from 'react'

import { checkConnection } from '../../../entity/graph-editing/connect'
import type { ConnectionRef, EditorNodeId } from '../../../entity/graph-editing/endpoint'
import type { Issue } from '../../../entity/validation/issue'
import {
  endpointsOfConnection,
  interpretEdgeChanges,
  interpretNodeChanges,
  toEditorNodeId,
  withMeasurements,
} from '../../mappers/flow-changes'
import { MODEL_NODE_TYPE, graphToFlow } from '../../mappers/graph-to-flow'
import type { ConnectionFlowEdge, ModelFlowNode } from '../../mappers/graph-to-flow'
import { useEditorStore, useEditorStoreApi } from '../../stores/editor-store-context'

import styles from './Canvas.module.css'
import { ModelNode } from './ModelNode'
import { getDraggedNodeType, isNodeDrag } from './node-drag'

/**
 * ノードエディタのキャンバス(React Flow を **制御モード** で使う)。
 *
 *   ストア(正本) ──graphToFlow──▶ nodes / edges ──▶ <ReactFlow>
 *        ▲                                               │ 利用者の操作
 *        └──── ストアの操作 ◀── interpret*Changes ◀───────┘(変更の配列)
 *
 * React Flow は自分では状態を持たず、表示と「操作があった」という通知だけを受け持つ。
 * ノードの並び順・接続の規則・ID の採番は、すべてストア(とその先のエンティティ層)が決める。
 *
 * React Flow でしか分からない「ノードの測定済みの大きさ」だけは、この部品の中の
 * state に持つ(ドメインの情報ではないので、ストアには入れない)。
 */

// nodeTypes は描画のたびに作り直してはならない(React Flow が毎回全ノードを作り直す)。
// そのためコンポーネントの外に置く
const NODE_TYPES = { [MODEL_NODE_TYPE]: ModelNode }

const EDGE_COLORS: Readonly<Record<string, string>> = {
  feature: 'var(--port-feature)',
  tokens: 'var(--port-tokens)',
  indices: 'var(--port-indices)',
  any: 'var(--port-any)',
  unknown: 'var(--port-any)',
}

export type EditorCanvasProps = {
  /** 検証の結果(ノードに問題の数を出す)。EditorPage が計算してログと共有する */
  readonly issues: readonly Issue[]
}

export function EditorCanvas({ issues }: EditorCanvasProps) {
  const store = useEditorStoreApi()
  const document = useEditorStore((state) => state.document)
  const catalog = useEditorStore((state) => state.catalog)
  const selection = useEditorStore((state) => state.selection)
  const focusRequest = useEditorStore((state) => state.focusRequest)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const nodesInitialized = useNodesInitialized()

  const [measured, setMeasured] = useState<ReadonlyMap<string, Dimensions>>(() => new Map())
  // 表示範囲の初期値は、開いた瞬間の文書から 1 度だけ決める。保存されていなければ全体が収まるようにする
  const [initialViewport] = useState(() => document.layout.viewport)

  const elements = useMemo(
    () => graphToFlow({ document, catalog, selection, issues }),
    [document, catalog, selection, issues],
  )
  const nodes = useMemo(
    () => withMeasurements(elements.nodes, measured),
    [elements.nodes, measured],
  )
  const edges = useMemo(
    () =>
      elements.edges.map((edge): ConnectionFlowEdge => ({
        ...edge,
        // 線の色を、流れるデータの種類(ポートの色)にそろえる
        style: { stroke: EDGE_COLORS[edge.data?.kind ?? 'unknown'], strokeWidth: 2 },
      })),
    [elements.edges],
  )

  /**
   * ログのクリックで出された「このノードを中央に表示して」という要求を処理する。
   *
   * ノードの大きさを測り終えるまでは、どこが中央か分からない(fitView が効かない)。
   * 学習設定画面から移ってきた直後はキャンバスを作ったばかりなので、
   * useNodesInitialized で測り終えるのを待ってから処理する。
   */
  useEffect(() => {
    if (focusRequest === null || !nodesInitialized) return
    void fitView({ nodes: [{ id: focusRequest.nodeId }], duration: 300, maxZoom: 1.2 })
    store.getState().clearFocusRequest()
  }, [focusRequest, nodesInitialized, fitView, store])

  const onNodesChange = useCallback(
    (changes: NodeChange<ModelFlowNode>[]) => {
      const state = store.getState()
      const effects = interpretNodeChanges(changes, state.selection)
      for (const move of effects.moves) state.moveNode(move.id, move.position)
      if (effects.selection !== null) state.setSelection(effects.selection)
      if (effects.measurements.length > 0) {
        setMeasured((previous) => {
          const next = new Map(previous)
          for (const { id, dimensions } of effects.measurements) next.set(id, dimensions)
          return next
        })
      }
    },
    [store],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<ConnectionFlowEdge>[]) => {
      const state = store.getState()
      const next = interpretEdgeChanges(changes, state.selection)
      if (next !== null) state.setSelection(next)
    },
    [store],
  )

  /**
   * 線を引いている最中に、つないでよいかを判定する。false を返すと、React Flow は
   * そのポートに落とせない表示にする。判定そのものはエンティティ層の checkConnection。
   */
  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const endpoints = endpointsOfConnection({
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? null,
        targetHandle: connection.targetHandle ?? null,
      })
      if (endpoints === null) return false
      const { document: current, catalog: currentCatalog } = store.getState()
      return checkConnection(current.graph, currentCatalog, endpoints.source, endpoints.target).ok
    },
    [store],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      const endpoints = endpointsOfConnection(connection)
      if (endpoints !== null) store.getState().connect(endpoints.source, endpoints.target)
    },
    [store],
  )

  /** Delete キーなどでの削除。ノードと線を、同じ時点の状態からまとめて消す */
  const onDelete: OnDelete<ModelFlowNode, ConnectionFlowEdge> = useCallback(
    ({ nodes: deletedNodes, edges: deletedEdges }) => {
      const nodeIds = deletedNodes
        .map((node) => toEditorNodeId(node.id))
        .filter((id): id is EditorNodeId => id !== null)
      const refs = deletedEdges
        .map((edge) => edge.data?.ref)
        .filter((ref): ref is ConnectionRef => ref !== undefined)
      store.getState().deleteElements(nodeIds, refs)
    },
    [store],
  )

  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      store.getState().setViewport(viewport)
    },
    [store],
  )

  const onDragOver = useCallback((event: DragEvent) => {
    if (!isNodeDrag(event.dataTransfer)) return
    // preventDefault しないと、ブラウザは「ここには落とせない」と判断して drop を起こさない
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback(
    (event: DragEvent) => {
      const typeId = getDraggedNodeType(event.dataTransfer)
      if (typeId === null) return
      event.preventDefault()
      // 画面上の座標(ピクセル)を、ズームとパンを考慮したキャンバス上の座標に直す
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      store.getState().addNode(typeId, position)
    },
    [store, screenToFlowPosition],
  )

  return (
    <div className={styles.canvas} onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow<ModelFlowNode, ConnectionFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onDelete={onDelete}
        onMoveEnd={onMoveEnd}
        deleteKeyCode={['Backspace', 'Delete']}
        {...(initialViewport === null ? { fitView: true } : { defaultViewport: initialViewport })}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  )
}
