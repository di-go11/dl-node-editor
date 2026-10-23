import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'

import type { EditorDocument, Position, Viewport } from '../../entity/document/document'
import type { EditorContext } from '../../entity/editor-context/editor-context'
import { emptyEditorDocument } from '../../entity/document/document'
import type { ConnectionCheck } from '../../entity/graph-editing/connect'
import { connect, disconnectAll } from '../../entity/graph-editing/connect'
import { createNode } from '../../entity/graph-editing/create-node'
import type {
  ConnectionRef,
  EditorNodeId,
  SourceEndpoint,
  TargetEndpoint,
} from '../../entity/graph-editing/endpoint'
import { isGraphInputNode, isGraphOutputNode } from '../../entity/graph-editing/endpoint'
import {
  addNode,
  findNode,
  removeNode,
  replaceNodeSpec,
} from '../../entity/model-graph/model-graph'
import type { NodeId } from '../../entity/model-graph/node-id'
import type { ParamValues } from '../../entity/model-graph/node-spec'
import { withParams } from '../../entity/model-graph/node-spec'
import type { NodeCatalog } from '../../entity/node-catalog/catalog'
import { findNodeType } from '../../entity/node-catalog/catalog'

/**
 * エディタの状態(Zustand のストア)。
 *
 * ## 正本はドメインの EditorDocument
 *
 * React Flow の Node[] / Edge[] はここには持たない。描画のたびに
 * mappers/graph-to-flow.ts が document から導く(制御モード)。
 * ノードの並び順は重みの対応を決めるので(指示書 7.3)、並び順の正本を
 * ライブラリに渡さず、ドメインの関数だけが並びを変えられるようにしている。
 *
 * ## このストアは薄い
 *
 * 操作(アクション)は、エンティティ層の純粋関数(connect、createNode、removeNode …)を
 * 呼んで結果を入れ替えるだけにしている。規則はエンティティ層にあるので、
 * ストアを Redux や別のライブラリに替えても規則は書き直さずに済む。
 *
 * ## createStore で作り、Context で配る
 *
 * モジュールの最上位で 1 つだけ作るのではなく、createEditorStore で毎回作る。
 * テストごとに新しいストアを作れる(テスト同士が状態を共有しない)ことと、
 * カタログを外から渡せる(依存性注入)ことのためである。
 * React からは presentation/app の Context 経由で使う。
 */

/** 選択状態。保存しない(後から計算できず、モデルの意味でもない一時的な状態) */
export type EditorSelection = {
  readonly nodeIds: readonly EditorNodeId[]
  /** React Flow の Edge の ID(mappers/flow-ids.ts が作る) */
  readonly edgeIds: readonly string[]
}

export const EMPTY_SELECTION: EditorSelection = { nodeIds: [], edgeIds: [] }

export type EditorState = {
  readonly catalog: NodeCatalog
  readonly document: EditorDocument
  readonly selection: EditorSelection
}

/**
 * 操作の型は、メソッド構文ではなく関数型のプロパティで書く。
 * `const addNode = useEditorStore((s) => s.addNode)` のように取り出して単独で呼ぶので、
 * this に依存しないことを型で表しておく(ESLint の unbound-method が検査する)。
 */
export type EditorActions = {
  /**
   * サイドバーからドロップしたノードを置く。置いたノードを選択状態にする。
   * 知らない種類・エディタ専用の種類なら何もせず null を返す。
   */
  readonly addNode: (typeId: string, position: Position) => NodeId | null
  readonly moveNode: (id: EditorNodeId, position: Position) => void
  /** ノードを消す(Input / Output は消せないので無視する) */
  readonly removeNodes: (ids: readonly EditorNodeId[]) => void
  /** つなぐ。規則に反すればグラフを変えず、理由を返す */
  readonly connect: (source: SourceEndpoint, target: TargetEndpoint) => ConnectionCheck
  readonly disconnect: (refs: readonly ConnectionRef[]) => void
  /**
   * ノードと線をまとめて消す(Delete キー)。
   *
   * React Flow はノードを消すとき、つながっている線の削除も同時に知らせてくる。
   * 線は ModelGraph の中の位置(ConnectionRef)で指しているので、先にノードを消すと
   * 位置がずれて別の線を外してしまう。1 つの操作の中で「線 → ノード」の順に処理し、
   * 両方を同じ時点の状態から計算する。
   */
  readonly deleteElements: (
    nodeIds: readonly EditorNodeId[],
    connections: readonly ConnectionRef[],
  ) => void
  readonly updateParams: (id: NodeId, patch: ParamValues) => void
  readonly setSelection: (selection: EditorSelection) => void
  /** ヘッダのデータ形式・特徴抽出手法を切り替える。置いたノードは消さない(指示書 4.3) */
  readonly setContext: (context: EditorContext) => void
  readonly setViewport: (viewport: Viewport) => void
  /** 文書を丸ごと入れ替える(読み込み・新規作成。フェーズ 4 で使う) */
  readonly replaceDocument: (document: EditorDocument) => void
}

export type EditorStoreState = EditorState & EditorActions

export type EditorStore = StoreApi<EditorStoreState>

export type EditorStoreOptions = {
  readonly catalog: NodeCatalog
  readonly initialDocument?: EditorDocument
}

export function createEditorStore(options: EditorStoreOptions): EditorStore {
  return createStore<EditorStoreState>()((set, get) => {
    /** document の一部だけを書き換える */
    const updateDocument = (update: (document: EditorDocument) => EditorDocument): void => {
      set((state) => ({ document: update(state.document) }))
    }

    return {
      catalog: options.catalog,
      document: options.initialDocument ?? emptyEditorDocument(),
      selection: EMPTY_SELECTION,

      addNode: (typeId, position) => {
        const { catalog, document } = get()
        const def = findNodeType(catalog, typeId)
        if (def === undefined || def.editorOnly) return null

        const node = createNode(def, document.graph)
        const positions = new Map(document.layout.positions).set(node.id, position)
        set({
          document: {
            ...document,
            graph: addNode(document.graph, node),
            layout: { ...document.layout, positions },
          },
          selection: { nodeIds: [node.id], edgeIds: [] },
        })
        return node.id
      },

      moveNode: (id, position) => {
        updateDocument((document) => ({
          ...document,
          layout: {
            ...document.layout,
            positions: new Map(document.layout.positions).set(id, position),
          },
        }))
      },

      removeNodes: (ids) => {
        const removable = ids.filter(
          (id): id is NodeId => !isGraphInputNode(id) && !isGraphOutputNode(id),
        )
        if (removable.length === 0) return

        const { document, selection } = get()
        const positions = new Map(document.layout.positions)
        let graph = document.graph
        for (const id of removable) {
          graph = removeNode(graph, id)
          positions.delete(id)
        }
        set({
          document: { ...document, graph, layout: { ...document.layout, positions } },
          // 消したノードと、それにつながっていた線は選択から外す
          selection: {
            nodeIds: selection.nodeIds.filter((id) => !removable.includes(id as NodeId)),
            edgeIds: [],
          },
        })
      },

      connect: (source, target) => {
        const { catalog, document } = get()
        const result = connect(document.graph, catalog, source, target)
        if (!result.ok) return result
        set({ document: { ...document, graph: result.graph } })
        return { ok: true }
      },

      disconnect: (refs) => {
        if (refs.length === 0) return
        const { document, selection } = get()
        set({
          document: { ...document, graph: disconnectAll(document.graph, refs) },
          selection: { ...selection, edgeIds: [] },
        })
      },

      deleteElements: (nodeIds, connections) => {
        get().disconnect(connections)
        get().removeNodes(nodeIds)
      },

      updateParams: (id, patch) => {
        updateDocument((document) => {
          const node = findNode(document.graph, id)
          if (node === undefined) return document
          return {
            ...document,
            graph: replaceNodeSpec(document.graph, id, withParams(node.spec, patch)),
          }
        })
      },

      setSelection: (selection) => {
        set({ selection })
      },

      setContext: (context) => {
        updateDocument((document) => ({ ...document, context }))
      },

      setViewport: (viewport) => {
        updateDocument((document) => ({ ...document, layout: { ...document.layout, viewport } }))
      },

      replaceDocument: (document) => {
        set({ document, selection: EMPTY_SELECTION })
      },
    }
  })
}
