import type { ModelGraph } from '../../entity/model-graph/model-graph'
import type { TrainingStatus } from '../../entity/training/progress'
import type { TrainingSettings } from '../../entity/training/training-settings'

import type { ApiResult } from './api-result'

/**
 * 学習の開始・進捗・停止(契約の /trainings 以下)。
 *
 * フェーズ 5 では開始(start)だけを使う。進捗の購読と停止はフェーズ 6 で足す。
 * モデル構造と学習設定は別々に受け取り、StartTrainingRequest の JSON に合わせるのは
 * 実装(infrastructure)の中だけにする(エンティティ層の toStartTrainingRequestJson を使う)。
 */

export type StartedTraining = {
  readonly jobId: string
  readonly status: TrainingStatus
}

export type TrainingApi = {
  start(graph: ModelGraph, settings: TrainingSettings): Promise<ApiResult<StartedTraining>>
}
