import type { ModelGraph } from '../../entity/model-graph/model-graph'
import type { TrainingProgress, TrainingStatus } from '../../entity/training/progress'
import type { TrainingSettings } from '../../entity/training/training-settings'

import type { ApiResult } from './api-result'

/**
 * 学習の開始・進捗・停止(契約の /trainings 以下)。
 *
 * モデル構造と学習設定は別々に受け取り、StartTrainingRequest の JSON に合わせるのは
 * 実装(infrastructure)の中だけにする。
 */

export type StartedTraining = {
  readonly jobId: string
  readonly status: TrainingStatus
}

/** 進捗の受信で起きた問題 */
export type ProgressProblem = {
  /** 利用者に見せる説明 */
  readonly message: string
  /** true なら受信を続けている(再接続中など)。false なら、もう進捗は届かない */
  readonly retrying: boolean
}

export type ProgressListener = {
  readonly onProgress: (progress: TrainingProgress) => void
  readonly onProblem: (problem: ProgressProblem) => void
}

export type TrainingApi = {
  start(graph: ModelGraph, settings: TrainingSettings): Promise<ApiResult<StartedTraining>>
  /**
   * 進捗の受信を始める。学習が終わると(完了・失敗・停止)受信は自動で閉じる。
   * 戻り値は、途中で受信をやめるための関数である。
   */
  subscribeProgress(jobId: string, listener: ProgressListener): () => void
  /**
   * 停止を要求する。停止はエポックの区切りで行われるので、結果が running でも正常である。
   * 止まったことは subscribeProgress の stopped で分かる。
   */
  stop(jobId: string): Promise<ApiResult<TrainingStatus>>
}
