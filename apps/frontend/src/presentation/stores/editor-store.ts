import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'

import type { EditorDocument, Position, Viewport } from '../../entity/document/document'
import type { RunState } from '../../application/run-state/run-state'
import { INITIAL_RUN_STATE } from '../../application/run-state/run-state'
import type { EditorContext } from '../../entity/editor-context/editor-context'
import { emptyEditorDocument } from '../../entity/document/document'
import type { ConnectionCheck } from '../../entity/graph-editing/connect'
import { connect, disconnectAll } from '../../entity/graph-editing/connect'
import { createNode } from '../../entity/graph-editing/create-node'
import type { RenameResult } from '../../entity/graph-editing/rename'
import { checkNodeIdInput } from '../../entity/graph-editing/rename'
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
import type { TrainingSettings } from '../../entity/training/training-settings'
import {
  MODEL_NAME_PATTERN,
  defaultTrainingSettings,
} from '../../entity/training/training-settings'
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

/**
 * ログの「操作の結果」の 1 行(保存しました、読み込めませんでした …)。
 *
 * 検証の Issue とは別の型にしている。Issue は「今のグラフの問題」で、グラフが変われば
 * 計算し直されて消える。こちらは「過去に起きた出来事」で、利用者が消すまで残る。
 */
export type LogMessage = {
  readonly id: number
  readonly level: 'info' | 'warning' | 'error'
  readonly text: string
}

/** 残しておく操作の結果の最大件数(古いものから捨てる) */
export const MAX_LOG_MESSAGES = 100

/**
 * 最後に保存した(または読み込んだ)時点の、文書の中身への参照。
 *
 * 文書はイミュータブルに更新している(変更のたびに新しいオブジェクトを作る)ので、
 * 「保存した時点のオブジェクトと今のオブジェクトが同じか」を比べるだけで、
 * 中身を深く比べなくても変更の有無が分かる。
 *
 * 表示範囲(viewport)は比べない。画面をスクロールしただけで「未保存」になると、
 * 確認のダイアログが頻繁に出て、本当に大事な警告が無視されるようになるためである。
 */
export type SavedSnapshot = {
  readonly name: string
  readonly context: EditorDocument['context']
  readonly graph: EditorDocument['graph']
  readonly positions: EditorDocument['layout']['positions']
  readonly training: EditorDocument['training']
}

export function snapshotOf(document: EditorDocument): SavedSnapshot {
  return {
    name: document.meta.name,
    context: document.context,
    graph: document.graph,
    positions: document.layout.positions,
    training: document.training,
  }
}

/** 保存していない変更があるか */
export function isDocumentDirty(state: Pick<EditorState, 'document' | 'savedSnapshot'>): boolean {
  const current = snapshotOf(state.document)
  const saved = state.savedSnapshot
  return (
    current.name !== saved.name ||
    current.context !== saved.context ||
    current.graph !== saved.graph ||
    current.positions !== saved.positions ||
    current.training !== saved.training
  )
}

export type EditorState = {
  readonly catalog: NodeCatalog
  readonly document: EditorDocument
  readonly selection: EditorSelection
  readonly savedSnapshot: SavedSnapshot
  /**
   * 文書を丸ごと入れ替えた回数。キャンバスの key に使い、読み込んだら作り直させる
   * (表示範囲を、読み込んだ文書の値で開き直すため)。
   */
  readonly documentRevision: number
  readonly messages: readonly LogMessage[]
  /** 学習の実行までの状態機械(application/run-state)。遷移の規則はそちらにある */
  readonly runState: RunState
  /**
   * 「このノードを画面の中央に表示して」という要求(ログのクリック)。
   * キャンバスが処理したら clearFocusRequest で消す。学習設定画面からエディタに移った直後の
   * ように、キャンバスがまだない時点で出された要求も、ここに残しておけば後で処理できる。
   */
  readonly focusRequest: { readonly nodeId: EditorNodeId } | null
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
  /**
   * ノードの ID を付け替える(入力は検証前の文字列)。使えない ID なら状態を変えずに理由を返す。
   * 接続・出力・座標・選択状態の ID もまとめて書き換える。
   */
  readonly renameNode: (from: NodeId, input: string) => RenameResult
  readonly setSelection: (selection: EditorSelection) => void
  /** ヘッダのデータ形式・特徴抽出手法を切り替える。置いたノードは消さない(指示書 4.3) */
  readonly setContext: (context: EditorContext) => void
  readonly setViewport: (viewport: Viewport) => void
  /** 文書を丸ごと入れ替える(読み込み・新規作成)。入れ替えた直後は「保存済み」とみなす */
  readonly replaceDocument: (document: EditorDocument) => void
  /** 文書の名前(保存ファイルの meta.name とファイル名に使う) */
  readonly setDocumentName: (name: string) => void
  /**
   * 保存できたことを記録する(保存日時を入れ、未保存の印を消す)。
   *
   * 「保存した文書」を引数で受け取る。保存は非同期なので、保存の途中に利用者が
   * 編集を続けることがありうる。今の文書を保存済みとみなすと、その編集が
   * 保存されていないのに「未保存」の印が消えてしまう。
   */
  readonly markSaved: (savedDocument: EditorDocument, savedAt: string) => void
  readonly addMessages: (messages: readonly Omit<LogMessage, 'id'>[]) => void
  readonly clearMessages: () => void
  /** 学習設定がまだなければ、既定値で作る(学習設定画面を開いたとき) */
  readonly ensureTrainingSettings: () => void
  /** 学習設定を書き換える。学習設定がまだなければ何もしない */
  readonly updateTraining: (update: (settings: TrainingSettings) => TrainingSettings) => void
  readonly setRunState: (runState: RunState) => void
  /** ノードを選択し、画面の中央に表示するよう要求する */
  readonly focusNode: (id: EditorNodeId) => void
  readonly clearFocusRequest: () => void
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

    const initialDocument = options.initialDocument ?? emptyEditorDocument()
    let nextMessageId = 1

    return {
      catalog: options.catalog,
      document: initialDocument,
      selection: EMPTY_SELECTION,
      savedSnapshot: snapshotOf(initialDocument),
      documentRevision: 0,
      messages: [],
      runState: INITIAL_RUN_STATE,
      focusRequest: null,

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

      renameNode: (from, input) => {
        const { document, selection } = get()
        const result = checkNodeIdInput(document.graph, from, input)
        if (!result.ok || result.id === from) return result

        const to = result.id
        // 座標の表は挿入順を保ったまま、キーだけを差し替える(保存ファイルの差分を小さくするため)
        const positions = new Map(
          [...document.layout.positions].map(([id, position]) => [id === from ? to : id, position]),
        )
        set({
          document: { ...document, graph: result.graph, layout: { ...document.layout, positions } },
          selection: {
            ...selection,
            nodeIds: selection.nodeIds.map((id) => (id === from ? to : id)),
          },
        })
        return result
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
        set((state) => ({
          document,
          selection: EMPTY_SELECTION,
          savedSnapshot: snapshotOf(document),
          documentRevision: state.documentRevision + 1,
          // 別の文書のチェック結果を持ち越さない(学習中なら、その状態は残す)
          runState: state.runState.kind === 'running' ? state.runState : INITIAL_RUN_STATE,
          focusRequest: null,
        }))
      },

      setDocumentName: (name) => {
        updateDocument((document) => ({ ...document, meta: { ...document.meta, name } }))
      },

      markSaved: (savedDocument, savedAt) => {
        const { document } = get()
        set({
          document: { ...document, meta: { ...document.meta, savedAt } },
          savedSnapshot: snapshotOf(savedDocument),
        })
      },

      addMessages: (messages) => {
        if (messages.length === 0) return
        const added = messages.map((message) => ({ ...message, id: nextMessageId++ }))
        set((state) => ({ messages: [...state.messages, ...added].slice(-MAX_LOG_MESSAGES) }))
      },

      clearMessages: () => {
        set({ messages: [] })
      },

      ensureTrainingSettings: () => {
        updateDocument((document) => {
          if (document.training !== null) return document
          // モデル名は文書の名前から取る。checkpoint のファイル名に使えない文字を含むなら既定値のまま
          const defaults = defaultTrainingSettings()
          const name = document.meta.name
          const modelName = MODEL_NAME_PATTERN.test(name) ? name : defaults.modelName
          return { ...document, training: { ...defaults, modelName } }
        })
      },

      updateTraining: (update) => {
        updateDocument((document) =>
          document.training === null
            ? document
            : { ...document, training: update(document.training) },
        )
      },

      setRunState: (runState) => {
        set({ runState })
      },

      focusNode: (id) => {
        set({ selection: { nodeIds: [id], edgeIds: [] }, focusRequest: { nodeId: id } })
      },

      clearFocusRequest: () => {
        set({ focusRequest: null })
      },
    }
  })
}
