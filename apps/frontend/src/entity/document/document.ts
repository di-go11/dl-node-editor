import type { EditorContext } from '../editor-context/editor-context'
import { DEFAULT_EDITOR_CONTEXT } from '../editor-context/editor-context'
import type { ModelGraph } from '../model-graph/model-graph'
import { emptyModelGraph } from '../model-graph/model-graph'
import type { TrainingSettings } from '../training/training-settings'

/**
 * エディタの文書 - 保存ファイル 1 つぶんの内容(指示書 7 章)。
 *
 * ## 意味と見た目を分ける
 *
 *   graph    … モデルの意味。そのまま API に送れる(指示書 7.1)
 *   layout   … エディタの見た目(ノードの座標、表示範囲)。モデルの意味には影響しない
 *
 * 2 つを分けておくと、ノードを動かしただけで「モデルが変わった」扱いになることがない。
 * 学習設定画面の状態機械(指示書 4.5)も、graph と training の変化だけを見ればよくなる。
 *
 * ## 保存しないもの
 *
 * 整合性チェックの結果や選択状態のように、後から計算できるデータは持たない(指示書 7.2)。
 * 持つと「保存したときのチェック結果」と「今の内容」が食い違いうるためである。
 */

export type Position = {
  readonly x: number
  readonly y: number
}

/** キャンバスの表示範囲。React Flow の Viewport と同じ意味だが、型は独立させている */
export type Viewport = {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

export type EditorLayout = {
  /**
   * ノード ID → 座標。Input / Output の予約 ID(__input__ / __output__)も含む。
   *
   * Record ではなく Map にしているのは、キーが外部入力(ファイル)由来だからである。
   * 普通のオブジェクトを `positions[id]` で引くと、'constructor' や 'toString' のような
   * 名前が、プロトタイプ上のプロパティに当たってしまう(座標でないものが返る)。
   * Map ならキーはただの値として扱われる。
   * なお '__proto__' というキーは、読み込み時に Zod が取り除く(document.test.ts で確認)。
   */
  readonly positions: ReadonlyMap<string, Position>
  /** null なら保存されていない。表示側が全体が収まる範囲を自分で決める */
  readonly viewport: Viewport | null
}

export type DocumentMeta = {
  readonly name: string
  /** 最後に保存した日時(ISO 8601)。新規作成でまだ保存していなければ null */
  readonly savedAt: string | null
}

export type EditorDocument = {
  readonly meta: DocumentMeta
  readonly context: EditorContext
  readonly graph: ModelGraph
  readonly layout: EditorLayout
  /** 学習設定。まだ学習設定画面を開いていなければ null(保存ファイルでは省略される) */
  readonly training: TrainingSettings | null
}

/** 保存ファイルの種類を表す印。ほかの JSON ファイルを間違えて開いたことを見分ける */
export const DOCUMENT_FORMAT = 'model-editor-document'

/** 新規作成した直後の文書 */
export function emptyEditorDocument(name = 'untitled'): EditorDocument {
  return {
    meta: { name, savedAt: null },
    context: DEFAULT_EDITOR_CONTEXT,
    graph: emptyModelGraph(),
    layout: { positions: new Map(), viewport: null },
    training: null,
  }
}
