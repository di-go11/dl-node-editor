import type { EditorContext } from '../../entity/editor-context/editor-context'
import type { ModelGraph } from '../../entity/model-graph/model-graph'
import type { NodeCatalog } from '../../entity/node-catalog/catalog'
import type { TrainingSettings } from '../../entity/training/training-settings'
import type { Issue, ValidationResult } from '../../entity/validation/issue'
import {
  hasError,
  issueError,
  sortIssuesBySeverity,
  toValidationResult,
} from '../../entity/validation/issue'
import { validateOutputActivation } from '../../entity/validation/output-activation'
import { validateModelGraph } from '../../entity/validation/validate-model-graph'
import { validateTrainingSettings } from '../../entity/validation/validate-training'
import type { ModelGraphValidationApi } from '../ports/model-graph-validation-api'

/**
 * ユースケース「整合性チェック」(指示書 8 章)。3 段階のチェックの結果を、1 つの一覧にまとめる。
 *
 *   (1) モデル構造のチェック   … entity の validateModelGraph(1c)
 *   (2) 学習設定のチェック     … entity の validateTrainingSettings(1d + 5a の規則)と、
 *                               モデルと学習設定の組み合わせ(Output の直前の活性化と loss)
 *   (3) サーバー側のチェック   … ポート ModelGraphValidationApi(POST /model-graphs/validate)
 *
 * ## (1) にエラーがあれば (3) を呼ばない
 *
 * 閉路や未接続のようなモデル構造の誤りは、サーバーに送っても同じ誤りが返ってくるだけで、
 * ログに同じ問題が 2 回ずつ並ぶ。まずフロント側で分かる誤りを直してもらい、それが
 * なくなってからサーバーに確かめる。学習設定の誤りはモデル構造と無関係なので、
 * (3) を呼ぶかどうかには影響させない。
 *
 * ## サーバーに届かなければ error
 *
 * 届かないなら学習も始められない。「チェックできなかった」を OK とみなすと、
 * 学習実行のボタンが押せてしまい、押した瞬間に失敗する。
 */

export type IntegrityCheckInput = {
  readonly graph: ModelGraph
  readonly context: EditorContext
  readonly catalog: NodeCatalog
  readonly settings: TrainingSettings
  /** capabilities で得たデバイスの一覧(まだ取得できていなければ undefined) */
  readonly availableDevices?: readonly string[]
}

export type IntegrityCheckDeps = {
  readonly validationApi: ModelGraphValidationApi
}

export async function checkIntegrity(
  deps: IntegrityCheckDeps,
  input: IntegrityCheckInput,
): Promise<ValidationResult> {
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

  const serverIssues: readonly Issue[] = hasError(graphIssues)
    ? []
    : await serverCheck(deps.validationApi, input.graph)

  return toValidationResult(
    sortIssuesBySeverity([...graphIssues, ...settingsIssues, ...activationIssues, ...serverIssues]),
  )
}

async function serverCheck(
  api: ModelGraphValidationApi,
  graph: ModelGraph,
): Promise<readonly Issue[]> {
  const result = await api.validate(graph)
  if (result.ok) return result.value.issues
  return [
    issueError(
      'server/unreachable',
      `サーバー側のチェックができませんでした: ${result.error.message}`,
    ),
  ]
}
