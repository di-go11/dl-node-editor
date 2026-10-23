import type { EditorDocument } from '../../entity/document/document'
import type { ApiError } from '../ports/api-result'
import type { TrainingApi } from '../ports/training-api'
import type { RunState } from '../run-state/run-state'
import { canStart, checkTargetOf } from '../run-state/run-state'

/**
 * ユースケース「学習を始める」。
 *
 * [学習実行] のボタンは checked のときしか押せないが、それは画面の都合による守りである。
 * 「検証していない内容は実行しない」はアプリの規則なので、ユースケースの側でも
 * 状態機械(run-state.ts)で確かめてから送る。画面の不具合でボタンが押せてしまっても、
 * 検証していない内容がサーバーに送られることはない(二重の守り)。
 */

export type StartTrainingDeps = {
  readonly trainingApi: TrainingApi
}

export type StartTrainingResult =
  | { readonly ok: true; readonly jobId: string }
  | { readonly ok: false; readonly reason: 'not-checked' }
  | { readonly ok: false; readonly reason: 'api'; readonly error: ApiError }

export async function startTraining(
  deps: StartTrainingDeps,
  runState: RunState,
  document: EditorDocument,
): Promise<StartTrainingResult> {
  const target = checkTargetOf(document)
  if (target === null || !canStart(runState, target)) {
    return { ok: false, reason: 'not-checked' }
  }

  const result = await deps.trainingApi.start(target.graph, target.training)
  if (!result.ok) return { ok: false, reason: 'api', error: result.error }
  return { ok: true, jobId: result.value.jobId }
}
