/**
 * エディタの文脈 - ヘッダで選ぶ「データ形式」と「特徴抽出手法」の組み合わせ。
 *
 * この 2 つは、サイドバーに出すノードの絞り込み(指示書 4.3)と、
 * 置いたノードが今の条件で使えるかの検証(指示書 8 章)の両方から参照される。
 * どちらかの下に置くと一方が他方に依存することになり、依存の向きが歪むため、
 * 独立したモジュールにしてある。
 */

/** データ形式。2D がメイン。1D は近日実装予定(指示書 4.3) */
export const DATA_DIMS = ['1d', '2d'] as const

export type DataDim = (typeof DATA_DIMS)[number]

/**
 * 特徴抽出手法。
 *
 * 今の実装は CNN だけだが、NodePorts.hpp に Transformer 系の層の定義が既にあり、
 * 後から追加することが決まっている。そのため列挙値としては最初から持たせ、
 * 「使えるかどうか」は available で表す(型を後から広げるより、
 * 選択肢のメタ情報を変えるだけで済むようにするため)。
 */
export const FEATURE_METHODS = ['cnn', 'transformer'] as const

export type FeatureMethod = (typeof FEATURE_METHODS)[number]

export type EditorContext = {
  readonly dataDim: DataDim
  readonly method: FeatureMethod
}

/**
 * ヘッダの選択肢 1 件。
 *
 * 「未実装だが選択肢としては見せる」をコードの分岐ではなくデータで表している。
 * UI 側に「1d のときだけ特別なメッセージを出す」と書くと、2 つ目の未実装項目が
 * 出たときに同じ分岐が増える。note を持たせておけば UI は一様に扱える。
 */
export type ContextOption<T extends string> = {
  readonly value: T
  readonly label: string
  readonly available: boolean
  readonly note?: string
}

export const DATA_DIM_OPTIONS: readonly ContextOption<DataDim>[] = [
  { value: '2d', label: '2D', available: true },
  { value: '1d', label: '1D', available: false, note: '1D 用のノードは近日実装予定です' },
]

export const FEATURE_METHOD_OPTIONS: readonly ContextOption<FeatureMethod>[] = [
  { value: 'cnn', label: 'CNN', available: true },
  {
    value: 'transformer',
    label: 'Transformer',
    available: false,
    note: 'Transformer 用のノードは近日実装予定です',
  },
]

/** 起動時の条件。2D / CNN がメインの構成(指示書 4.3) */
export const DEFAULT_EDITOR_CONTEXT: EditorContext = { dataDim: '2d', method: 'cnn' }

/**
 * 条件のすべての組み合わせ。
 *
 * 列挙値から作っているので、DataDim や FeatureMethod を増やしても自動で追従する。
 * Input / Output のようにどの条件でも使えるノードの contexts に使う。
 */
export const ALL_EDITOR_CONTEXTS: readonly EditorContext[] = DATA_DIMS.flatMap((dataDim) =>
  FEATURE_METHODS.map((method) => ({ dataDim, method })),
)

export function editorContextEquals(a: EditorContext, b: EditorContext): boolean {
  return a.dataDim === b.dataDim && a.method === b.method
}

export function dataDimOption(value: DataDim): ContextOption<DataDim> {
  const option = DATA_DIM_OPTIONS.find((candidate) => candidate.value === value)
  if (option === undefined) throw new Error(`知らないデータ形式です: ${value}`)
  return option
}

export function featureMethodOption(value: FeatureMethod): ContextOption<FeatureMethod> {
  const option = FEATURE_METHOD_OPTIONS.find((candidate) => candidate.value === value)
  if (option === undefined) throw new Error(`知らない特徴抽出手法です: ${value}`)
  return option
}

/** '2D / CNN' のような表示用の文字列(ログやプロパティパネルで使う) */
export function formatEditorContext(context: EditorContext): string {
  return `${dataDimOption(context.dataDim).label} / ${featureMethodOption(context.method).label}`
}

/** 未実装の選択を含んでいるか(含んでいればサイドバーに注意書きを出す) */
export function unavailableNotesOf(context: EditorContext): readonly string[] {
  const notes: string[] = []
  const dim = dataDimOption(context.dataDim)
  if (!dim.available && dim.note !== undefined) notes.push(dim.note)
  const method = featureMethodOption(context.method)
  if (!method.available && method.note !== undefined) notes.push(method.note)
  return notes
}
