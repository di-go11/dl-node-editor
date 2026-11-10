import type { TrainingSettings } from '../../entity/training/training-settings'
import type { Issue } from '../../entity/validation/issue'
import { validateResumeSettings } from '../../entity/validation/validate-resume'
import type { ApiError } from '../ports/api-result'
import type { TrainedModelApi } from '../ports/trained-model-api'

/**
 * ユースケース「学習を再開する」(issue doc 作業 7)。
 *
 * 新規学習と違い、整合性チェックのボタンと状態機械はない。再開画面のチェックはフォームの検証だけで、
 * DB との整合性はサーバーが再開 API の中で確かめる(チェックと開始の間に DB が変わっても安全なため)。
 *
 * [学習再開] のボタンは問題がないときしか押せないが、それは画面の都合による守りである。
 * 「問題のある設定は送らない」はアプリの規則なので、ここでも検証してから送る(start-training.ts と同じ二重の守り)。
 */

export type ResumeTrainingDeps = {
  readonly trainedModelApi: TrainedModelApi
}

export type ResumeTrainingInput = {
  readonly modelId: string
  readonly settings: TrainingSettings
  /** 前回までに完了したエポック数 */
  readonly completedEpochs: number
  /** capabilities API で得たデバイスの一覧。まだ取得できていなければ undefined */
  readonly availableDevices?: readonly string[]
}

export type ResumeTrainingResult =
  | { readonly ok: true; readonly jobId: string }
  | { readonly ok: false; readonly reason: 'invalid'; readonly issues: readonly Issue[] }
  | { readonly ok: false; readonly reason: 'api'; readonly error: ApiError }

export async function resumeTraining(
  deps: ResumeTrainingDeps,
  input: ResumeTrainingInput,
): Promise<ResumeTrainingResult> {
  const validation = validateResumeSettings({
    settings: input.settings,
    completedEpochs: input.completedEpochs,
    ...(input.availableDevices === undefined ? {} : { availableDevices: input.availableDevices }),
  })
  if (!validation.ok) return { ok: false, reason: 'invalid', issues: validation.issues }

  const result = await deps.trainedModelApi.resume(input.modelId, input.settings)
  if (!result.ok) return { ok: false, reason: 'api', error: result.error }
  return { ok: true, jobId: result.value.jobId }
}
