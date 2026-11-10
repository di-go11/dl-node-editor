import { minResumeEpoch } from '../trained-model/trained-model'
import { TRAINING_NUMBER_DEFS } from '../training/training-settings'

import type { ValidationResult } from './issue'
import { issueError, sortIssuesBySeverity, toValidationResult } from './issue'
import type { TrainingValidationInput, TrainingValidationRule } from './validate-training'
import {
  validateDatasetPath,
  validateDevice,
  validateLoss,
  validateLossTask,
  validateOptimizer,
  validateTrainingNumbers,
} from './validate-training'

/**
 * 学習再開の設定のチェック(issue doc 作業 7)。
 *
 * 新規学習のチェック(validate-training.ts)のルールのうち、再開で変えられる項目のものだけを使い、
 * epoch が前回までに完了したエポック数より大きいかを足す。
 *
 * model_name / data_spec / seed / optimizer の種類は前回の値に決まっていて、
 * 画面で直せない(サーバーも前回の値を使う)ので確かめない。
 * loss とタスクの組み合わせは、loss を変えられるので確かめる。
 *
 * サーバー側の DB との整合性(POST /trainings/validate)に当たる確認は、再開 API の中で行われる。
 */

export type ResumeValidationInput = TrainingValidationInput & {
  /** 前回までに完了したエポック数(一覧 API の completed_epochs) */
  readonly completedEpochs: number
}

/** epoch は合計エポック数なので、完了済みのエポック数より大きくないと学習が進まない */
export function validateResumeEpoch({
  settings,
  completedEpochs,
}: ResumeValidationInput): ReturnType<TrainingValidationRule> {
  const min = minResumeEpoch(completedEpochs)
  if (settings.epoch >= min) return []
  return [
    issueError(
      'training/epoch-not-increased',
      `${TRAINING_NUMBER_DEFS.epoch.label}は合計の数です。前回までに ${completedEpochs} エポック完了しているので、${min} 以上にしてください。`,
      { field: 'epoch' },
    ),
  ]
}

/** 並びは再開画面の項目の並びに合わせている */
const RESUME_RULES: readonly TrainingValidationRule[] = [
  validateOptimizer,
  validateLoss,
  validateTrainingNumbers,
  validateDatasetPath,
  validateDevice,
  validateLossTask,
]

export function validateResumeSettings(input: ResumeValidationInput): ValidationResult {
  const issues = [...RESUME_RULES.flatMap((rule) => rule(input)), ...validateResumeEpoch(input)]
  return toValidationResult(sortIssuesBySeverity(issues))
}
