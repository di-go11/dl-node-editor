import { minResumeEpoch } from '../trained-model/trained-model'
import { LR_SCHEDULER_TYPES } from '../training/lr-scheduler'
import type { TrainingSettings } from '../training/training-settings'
import { TRAINING_NUMBER_DEFS } from '../training/training-settings'

import type { ValidationResult } from './issue'
import { issueError, issueWarning, sortIssuesBySeverity, toValidationResult } from './issue'
import type { TrainingValidationInput, TrainingValidationRule } from './validate-training'
import {
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
 * model_name / data_spec / seed / データセット / optimizer の種類は前回の値に決まっていて、
 * 画面で直せない(サーバーも前回の値を使う)ので確かめない。
 * loss とタスクの組み合わせは、loss を変えられるので確かめる。
 *
 * サーバー側の DB との整合性(POST /trainings/validate)に当たる確認は、再開 API の中で行われる。
 */

export type ResumeValidationInput = TrainingValidationInput & {
  /** 前回までに完了したエポック数(一覧 API の completed_epochs) */
  readonly completedEpochs: number
  /**
   * 前回の学習設定(GET /models/{id}/config)。渡すと、学習率スケジューラの曲線が再開の前後で
   * つながらなくなる変更に warning を出す(学習は止めない)
   */
  readonly savedSettings?: TrainingSettings
}

/**
 * 学習率スケジューラを使っているときに、再開で学習率の曲線がつながらなくなる変更(2026-11-26 決定: 許可して警告)。
 * スケジューラは再開で変えられない(保存した設定を使う)が、式に入る値が変わると学習率が跳ぶ。
 *   - poly / cosine は「進んだ割合 = 今のステップ / 総ステップ数」で決まるので、エポック数を変えると変わる
 *   - バッチごとに更新するときは、バッチサイズを変えると 1 エポックのステップ数が変わる
 *   - 基準の学習率(optimizer の学習率)を変えると、曲線全体の高さが変わる
 */
export function validateLrScheduleContinuity({
  settings,
  savedSettings,
}: ResumeValidationInput): ReturnType<TrainingValidationRule> {
  if (savedSettings === undefined) return []
  const { scheduler, updateInterval } = savedSettings.lrScheduler
  if (scheduler.kind === 'none') return []

  const changed: string[] = []
  const smooth = scheduler.kind === 'poly' || scheduler.kind === 'cosine'
  if (smooth && settings.epoch !== savedSettings.epoch) {
    changed.push(TRAINING_NUMBER_DEFS.epoch.label)
  }
  if (updateInterval === 'per_batch' && settings.batch !== savedSettings.batch) {
    changed.push(TRAINING_NUMBER_DEFS.batch.label)
  }
  const learningRate = settings.optimizer.params['learning_rate']
  if (learningRate !== savedSettings.optimizer.params['learning_rate']) {
    changed.push('学習率')
  }
  if (changed.length === 0) return []

  return [
    issueWarning(
      'training/lr-schedule-discontinuous',
      `${changed.join('・')}を前回から変えたため、学習率スケジューラ(${LR_SCHEDULER_TYPES[scheduler.kind].label})の学習率が再開の前後でつながりません。再開後は新しい値で計算し直します(進捗のグラフで確かめられます)。`,
      { field: 'lr_scheduler' },
    ),
  ]
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
  validateDevice,
  validateLossTask,
]

export function validateResumeSettings(input: ResumeValidationInput): ValidationResult {
  const issues = [
    ...RESUME_RULES.flatMap((rule) => rule(input)),
    ...validateResumeEpoch(input),
    ...validateLrScheduleContinuity(input),
  ]
  return toValidationResult(sortIssuesBySeverity(issues))
}
