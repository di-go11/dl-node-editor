import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { useCallback, useMemo, useRef } from 'react'

import { validateModelGraph } from '../../entity/validation/validate-model-graph'
import { EditorCanvas } from '../components/canvas/EditorCanvas'
import { Header } from '../components/header/Header'
import { LogPanel } from '../components/log/LogPanel'
import { PropertyPanel } from '../components/property-panel/PropertyPanel'
import { ResizablePanel } from '../components/property-panel/ResizablePanel'
import { Sidebar } from '../components/sidebar/Sidebar'
import { useEditorStore } from '../stores/editor-store-context'

import styles from './EditorPage.module.css'

/**
 * ノードエディタ画面(起動時に表示する画面。指示書 4.2)。
 *
 *   ┌────────────────── ヘッダ ──────────────────┐
 *   │ サイドバー │   キャンバス   │ プロパティパネル │
 *   ├────────────────── ログ ────────────────────┤
 *
 * この部品の仕事は「配置」と「検証結果の配布」だけである。
 *
 * 検証(validateModelGraph)はここで 1 回だけ計算し、キャンバス(ノードの問題の印)・
 * プロパティパネル・ログに同じ結果を渡す。結果はストアに保存しない(後から計算できるデータは持たない)。
 * useMemo の依存は graph / context / catalog だけなので、ノードを動かしただけ
 * (layout の変更)では再計算されない。
 */
export function EditorPage() {
  // useReactFlow(座標の変換)を、キャンバスの外にあるサイドバーのクリックでも使うため、
  // Provider をページ全体に広げる
  return (
    <ReactFlowProvider>
      <EditorPageContent />
    </ReactFlowProvider>
  )
}

function EditorPageContent() {
  const graph = useEditorStore((state) => state.document.graph)
  const context = useEditorStore((state) => state.document.context)
  const catalog = useEditorStore((state) => state.catalog)
  const addNode = useEditorStore((state) => state.addNode)
  const messages = useEditorStore((state) => state.messages)
  const clearMessages = useEditorStore((state) => state.clearMessages)
  const documentRevision = useEditorStore((state) => state.documentRevision)
  const nodeCount = graph.nodes.length

  const issues = useMemo(
    () => validateModelGraph({ graph, context, catalog }).issues,
    [graph, context, catalog],
  )

  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()

  /** サイドバーのクリックで、キャンバスの見えている範囲の中央付近にノードを置く */
  const addNodeAtCenter = useCallback(
    (typeId: string) => {
      const rect = canvasAreaRef.current?.getBoundingClientRect()
      const center =
        rect === undefined
          ? { x: 0, y: 0 }
          : screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      // 続けて置いたときに完全に重ならないよう、少しずつずらす
      const offset = (nodeCount % 5) * 24
      addNode(typeId, { x: center.x + offset, y: center.y + offset })
    },
    [addNode, nodeCount, screenToFlowPosition],
  )

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Header />
      </div>
      <div className={styles.sidebar}>
        <Sidebar onActivate={addNodeAtCenter} />
      </div>
      <main className={styles.canvas} ref={canvasAreaRef} aria-label="ノードエディタ">
        {/* 文書を読み込んだら key が変わり、キャンバスを作り直す(表示範囲を開き直すため) */}
        <EditorCanvas key={documentRevision} issues={issues} />
      </main>
      <div className={styles.inspector}>
        <ResizablePanel label="プロパティパネル">
          <PropertyPanel issues={issues} />
        </ResizablePanel>
      </div>
      <div className={styles.log}>
        <LogPanel issues={issues} messages={messages} onClearMessages={clearMessages} />
      </div>
    </div>
  )
}
