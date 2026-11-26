import type { EditorContext } from '../../entity/editor-context/editor-context'
import type { ModelGraph } from '../../entity/model-graph/model-graph'
import type { NodeCatalog } from '../../entity/node-catalog/catalog'
import type { TrainingSettings } from '../../entity/training/training-settings'
import type { Issue, ValidationResult } from '../../entity/validation/issue'
import { issueError, sortIssuesBySeverity, toValidationResult } from '../../entity/validation/issue'
import { validateOutputActivation } from '../../entity/validation/output-activation'
import { validateModelGraph } from '../../entity/validation/validate-model-graph'
import { validateTrainingSettings } from '../../entity/validation/validate-training'
import type { ApiResult } from '../ports/api-result'
import type { ServerCheck, TrainingApi } from '../ports/training-api'

/**
 * ユースケース「整合性チェック」(指示書 8 章)。3 段階のチェックの結果を、1 つの一覧にまとめる。
 *
 *   (1) モデル構造のチェック   … entity の validateModelGraph(1c)
 *   (2) 学習設定のチェック     … entity の validateTrainingSettings(1d + 5a の規則)と、
 *                               モデルと学習設定の組み合わせ(Output の直前の活性化と loss)
 *   (3) サーバーでのチェック  … POST /trainings/validate。学習を始めずに、学習開始と同じ確認をする。
 *                               データセットの有無、設定の値、学習エンジンでのグラフの構造と形
 *                               (出力チャンネル数とクラス数の比較など、手元では分からないもの)、
 *                               同じ model_name が使われていないか
 *
 * (1)(2) は手元で行う純粋な関数 checkIntegrity、(3) まで含めたものが checkIntegrityWithServer である。
 * (1)(2) と (3) の一部は同じ規則だが、(1)(2) は編集中にすぐ知らせるため、(3) は最終的な判定のために持つ。
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

export type CheckIntegrityDeps = {
  readonly trainingApi: Pick<TrainingApi, 'validate'>
}

/**
 * [整合性チェック] のボタンが使う、サーバーへの問い合わせまで含めたチェック。
 *
 * (1)(2) で error が見つかったら、サーバーには問い合わせない。直すべき問題が手元で
 * 分かっているうえ、形の正しくないリクエストを送っても 422 が返るだけだからである。
 *
 * サーバーに確かめられなかった(通信の失敗など)ときも error にする。確かめていない内容で
 * 学習を始めると、同じ名前のモデルの checkpoint を上書きしてしまうおそれがあるため。
 */
export async function checkIntegrityWithServer(
  deps: CheckIntegrityDeps,
  input: IntegrityCheckInput,
): Promise<ValidationResult> {
  const local = checkIntegrity(input)
  if (!local.ok) return local

  const server = await deps.trainingApi.validate(input.graph, input.settings)
  const issues = [...local.issues, ...serverIssues(server, input.settings)]
  return toValidationResult(sortIssuesBySeverity(issues))
}

function serverIssues(
  server: ApiResult<ServerCheck>,
  settings: TrainingSettings,
): readonly Issue[] {
  if (!server.ok) {
    return [
      issueError(
        'training/server-check-failed',
        `サーバーで確認できませんでした: ${server.error.message}`,
      ),
    ]
  }
  switch (server.value.kind) {
    case 'ok':
      return []
    case 'model-name-used':
      return [
        issueError(
          'training/model-name-used',
          `モデル名「${settings.modelName}」はすでに使われています。別の名前にしてください。`,
          { field: 'model_name' },
        ),
      ]
    case 'invalid-config':
      // 位置(ノード・ポート・パラメータ・項目)は infrastructure で画面の書き方に直してある
      return server.value.issues
  }
}
