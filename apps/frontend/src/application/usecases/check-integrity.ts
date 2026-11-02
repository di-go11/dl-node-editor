import type { EditorContext } from '../../entity/editor-context/editor-context'
import type { ModelGraph } from '../../entity/model-graph/model-graph'
import type { NodeCatalog } from '../../entity/node-catalog/catalog'
import type { TrainingSettings } from '../../entity/training/training-settings'
import type { ValidationResult } from '../../entity/validation/issue'
import { sortIssuesBySeverity, toValidationResult } from '../../entity/validation/issue'
import { validateOutputActivation } from '../../entity/validation/output-activation'
import { validateModelGraph } from '../../entity/validation/validate-model-graph'
import { validateTrainingSettings } from '../../entity/validation/validate-training'

/**
 * ユースケース「整合性チェック」(指示書 8 章)。2 段階のチェックの結果を、1 つの一覧にまとめる。
 *
 *   (1) モデル構造のチェック   … entity の validateModelGraph(1c)
 *   (2) 学習設定のチェック     … entity の validateTrainingSettings(1d + 5a の規則)と、
 *                               モデルと学習設定の組み合わせ(Output の直前の活性化と loss)
 *
 * サーバーには問い合わせない(Rust にも proto にも検証の API がない)。
 * C++ だけが検出できる問題は、学習開始の 422 で初めて分かる。
 */

export type IntegrityCheckInput = {
  readonly graph: ModelGraph
  readonly context: EditorContext
  readonly catalog: NodeCatalog
  readonly settings: TrainingSettings
  /** capabilities で得たデバイスの一覧(まだ取得できていなければ undefined) */
  readonly availableDevices?: readonly string[]
}

export function checkIntegrity(input: IntegrityCheckInput): ValidationResult {
  const graphIssues = validateModelGraph({
    graph: input.graph,
    context: input.context,
    catalog: input.catalog,
  }).issues
  const settingsIssues = validateTrainingSettings(
    input.availableDevices === undefined
      ? { settings: input.settings }
      : { settings: input.settings, availableDevices: input.availableDevices },
  ).issues
  const activationIssues = validateOutputActivation({
    graph: input.graph,
    settings: input.settings,
  })

  return toValidationResult(
    sortIssuesBySeverity([...graphIssues, ...settingsIssues, ...activationIssues]),
  )
}
