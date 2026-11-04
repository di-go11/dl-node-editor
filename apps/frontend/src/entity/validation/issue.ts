import type { NodeId } from '../model-graph/node-id'

/**
 * 検証で見つかった問題。
 *
 * モデル構造・学習設定のチェックの結果を、ログパネルが同じ型として並べて扱えるようにする。
 *
 * テストが日本語のメッセージ文に依存すると、言い回しを直すたびにテストが壊れる。
 * 安定した識別子で検査できるようにするために持たせている。
 */

export type Severity = 'error' | 'warning'

/**
 * 問題の種類。文字列リテラルの合併にしているので、綴り間違いがコンパイル時に分かり、
 * 「どんな問題がありうるか」の一覧にもなる。
 */
export type IssueCode =
  // ノードの種類
  | 'node/unknown-type'
  | 'node/unavailable-in-context'
  // ノード ID
  | 'node-id/duplicate'
  // グラフ全体
  | 'graph/no-nodes'
  | 'graph/no-input'
  | 'graph/no-output'
  | 'graph/multiple-outputs'
  | 'graph/cycle'
  // 参照
  | 'reference/missing-node'
  | 'reference/unknown-port'
  // 接続の本数
  | 'port/not-connected'
  | 'port/too-few-connections'
  | 'port/too-many-connections'
  | 'port/unknown-input'
  // ポートの種類
  | 'port/kind-mismatch'
  // パラメータ
  | 'param/missing'
  | 'param/unknown'
  | 'param/invalid'
  // 形状
  | 'channel/mismatch'
  // 学習設定(指示書 8 章 (2))
  | 'training/required'
  | 'training/invalid-format'
  | 'training/out-of-range'
  | 'training/unknown-device'
  | 'training/param-missing'
  | 'training/param-unknown'
  | 'training/param-invalid'
  | 'training/task-unavailable'
  | 'training/loss-task-mismatch'
  | 'training/output-activation'
  // サーバーでの整合性チェック(POST /trainings/validate)
  | 'training/model-name-used'
  | 'training/server-check-failed'
  // 保存ファイル(指示書 7 章)
  | 'document/invalid-json'
  | 'document/not-a-document'
  | 'document/unsupported-version'
  | 'document/invalid-structure'

export type IssueLocation = {
  /** 該当するノード(グラフ全体の問題なら省略)。ログのクリックでフォーカスするのに使う */
  readonly nodeId?: NodeId
  /** 該当するポート名 */
  readonly port?: string
  /** 該当するパラメータ名。プロパティパネルの入力欄を指し示すのに使う */
  readonly paramName?: string
  /**
   * 学習設定や保存ファイルの中の位置。proto の JSON 表記のパスで書く
   * (例 'optimizer.learning_rate'、'data_spec.image.input_width')。
   *
   * 学習設定の問題はノードではなく「設定項目」を指すため、nodeId / paramName とは
   * 別に持たせている。JSON 表記の名前にそろえるのは、C++ のエラーメッセージ
   * (TrainingProtoMapper.cpp)と同じ書き方になり、両者を見比べやすいためである。
   */
  readonly field?: string
}

export type Issue = IssueLocation & {
  readonly severity: Severity
  readonly code: IssueCode
  readonly message: string
}

export type ValidationResult = {
  /** severity が error の問題が 1 件もなければ true。warning は実行を止めない */
  readonly ok: boolean
  readonly issues: readonly Issue[]
}

export function issueError(code: IssueCode, message: string, location: IssueLocation = {}): Issue {
  return { severity: 'error', code, message, ...location }
}

export function issueWarning(
  code: IssueCode,
  message: string,
  location: IssueLocation = {},
): Issue {
  return { severity: 'warning', code, message, ...location }
}

export function hasError(issues: readonly Issue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}

export function toValidationResult(issues: readonly Issue[]): ValidationResult {
  return { ok: !hasError(issues), issues }
}

export function issuesOfNode(issues: readonly Issue[], nodeId: NodeId): readonly Issue[] {
  return issues.filter((issue) => issue.nodeId === nodeId)
}

/**
 * error を先に、同じ severity 内では元の順序を保って並べる。
 *
 * ログパネルの先頭に、実行を止めている原因が来るようにするため。
 * Array.prototype.sort は安定ソートなので、同じ severity の並びは崩れない。
 */
export function sortIssuesBySeverity(issues: readonly Issue[]): readonly Issue[] {
  const rank = (severity: Severity): number => (severity === 'error' ? 0 : 1)
  return [...issues].sort((a, b) => rank(a.severity) - rank(b.severity))
}
