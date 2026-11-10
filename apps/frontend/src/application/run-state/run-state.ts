import type { EditorDocument } from '../../entity/document/document'
import type { ValidationResult } from '../../entity/validation/issue'

/**
 * 学習の実行までの状態機械(指示書 4.5)。
 *
 *   editing ──[整合性チェック]──▶ checking ──OK──▶ checked ──[学習実行]──▶ starting ──▶ running
 *      ▲                            │NG                │
 *      └────────────────────────────┴── グラフか設定を 1 つでも変更したら editing に戻る
 *
 * ## 「変更したら editing に戻る」を、変更する側に書かない
 *
 * グラフや設定を変える操作は数多くある(ノードを足す、線を引く、パラメータを変える、
 * 条件を切り替える …)。そのすべてに「状態を editing に戻す」を書くと、どれか 1 つで
 * 書き忘れたときに、**検証していない内容が実行されてしまう。**
 *
 * そこで、チェックを始めた時点の graph / context / training の **参照** を記録しておき
 * (CheckTarget)、今の参照と同じときだけ checked とみなす(effectiveRunState)。
 * 文書はイミュータブルに更新しているので、中身が 1 か所でも変われば参照も変わる。
 * 変更する操作の側では何もしなくても、自動で editing に戻る。
 *
 * ## 純粋関数として application 層に置く理由
 *
 * 「チェックが OK のときだけ実行できる」はアプリの手順の規則であり、UI の都合ではない。
 * 状態をどこに持つか(Zustand のストア)とは切り離し、遷移の規則だけをここに書く。
 * ボタンの有効 / 無効もユースケース(start-training.ts)の確認も、同じ関数を使う。
 */

/** チェックの対象。参照の同一性で「チェックした内容と同じか」を判定する */
export type CheckTarget = {
  readonly graph: EditorDocument['graph']
  readonly context: EditorDocument['context']
  readonly training: NonNullable<EditorDocument['training']>
}

export type RunState =
  /**
   * 編集中。前回のチェックの結果と、そのときの対象があれば持つ。
   * 結果はログに出すため、対象は「その結果が今の内容に対するものか(古くなっていないか)」を
   * 画面が判定するため(isStaleResult)。
   */
  | {
      readonly kind: 'editing'
      readonly lastResult: ValidationResult | null
      readonly lastTarget: CheckTarget | null
    }
  | { readonly kind: 'checking'; readonly target: CheckTarget }
  | { readonly kind: 'checked'; readonly target: CheckTarget; readonly result: ValidationResult }
  /** 学習開始のリクエストを送っている最中 */
  | { readonly kind: 'starting'; readonly target: CheckTarget; readonly result: ValidationResult }
  | { readonly kind: 'running'; readonly jobId: string }

export const INITIAL_RUN_STATE: RunState = { kind: 'editing', lastResult: null, lastTarget: null }

/** 文書からチェックの対象を取り出す。学習設定がまだなければ null */
export function checkTargetOf(document: EditorDocument): CheckTarget | null {
  if (document.training === null) return null
  return { graph: document.graph, context: document.context, training: document.training }
}

export function sameCheckTarget(a: CheckTarget, b: CheckTarget | null): boolean {
  return b !== null && a.graph === b.graph && a.context === b.context && a.training === b.training
}

/**
 * 今の内容に照らした、実際の状態。
 *
 * checking / checked のあとに内容が変わっていたら editing とみなす。
 * starting(リクエストを送った後)は、送ったのがチェック済みの内容なので、そのまま扱う。
 */
export function effectiveRunState(state: RunState, current: CheckTarget | null): RunState {
  switch (state.kind) {
    case 'checking':
      return sameCheckTarget(state.target, current) ? state : INITIAL_RUN_STATE
    case 'checked':
      return sameCheckTarget(state.target, current)
        ? state
        : { kind: 'editing', lastResult: state.result, lastTarget: state.target }
    case 'editing':
    case 'starting':
    case 'running':
      return state
  }
}

/** [整合性チェック] を押した。学習を始めている最中・学習中はチェックしない */
export function beginCheck(state: RunState, target: CheckTarget): RunState {
  if (state.kind === 'starting' || state.kind === 'running') return state
  return { kind: 'checking', target }
}

/**
 * チェックの結果が返ってきた。
 *
 * チェックの途中で内容が変わっていたら(target が違えば)、結果を捨てる。
 * 古い内容を検証した結果で checked にすると、検証していない内容を実行できてしまう。
 */
export function finishCheck(
  state: RunState,
  target: CheckTarget,
  result: ValidationResult,
): RunState {
  if (state.kind !== 'checking' || !sameCheckTarget(state.target, target)) return state
  return result.ok
    ? { kind: 'checked', target, result }
    : { kind: 'editing', lastResult: result, lastTarget: target }
}

/** [学習実行] を押せるか(checked のときだけ。指示書 4.5) */
export function canStart(state: RunState, current: CheckTarget | null): boolean {
  return effectiveRunState(state, current).kind === 'checked'
}

/** [学習実行] を押した。押せない状態なら何も変えない */
export function beginStart(state: RunState, current: CheckTarget | null): RunState {
  const effective = effectiveRunState(state, current)
  if (effective.kind !== 'checked') return state
  return { kind: 'starting', target: effective.target, result: effective.result }
}

export type StartOutcome = { readonly ok: true; readonly jobId: string } | { readonly ok: false }

/**
 * 学習開始のリクエストの結果。失敗したら checked に戻す(内容は検証済みのままなので、
 * 通信が回復すればそのまま再実行できる)。
 */
export function finishStart(state: RunState, outcome: StartOutcome): RunState {
  if (state.kind !== 'starting') return state
  return outcome.ok
    ? { kind: 'running', jobId: outcome.jobId }
    : { kind: 'checked', target: state.target, result: state.result }
}

/** 学習が終わった(完了・失敗・停止。フェーズ 6)。編集に戻る */
export function finishRun(state: RunState): RunState {
  return state.kind === 'running' ? INITIAL_RUN_STATE : state
}

/**
 * 前回のチェックの結果が、そのあとの変更で古くなっているか。
 * 古い結果をログに出すときは、そのことを利用者に知らせる(直したつもりの問題が残って見えるため)。
 */
export function isStaleResult(state: RunState, current: CheckTarget | null): boolean {
  return (
    state.kind === 'editing' &&
    state.lastTarget !== null &&
    !sameCheckTarget(state.lastTarget, current)
  )
}
