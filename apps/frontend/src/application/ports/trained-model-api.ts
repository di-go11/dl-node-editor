import type { TrainingHistory } from '../../entity/trained-model/history'
import type { TrainedModelSummary } from '../../entity/trained-model/trained-model'
import type { TrainingSettings } from '../../entity/training/training-settings'

import type { ApiResult } from './api-result'
import type { StartedTraining } from './training-api'

/**
 * 学習済みモデルの一覧と、学習の再開(契約の /models 以下)。
 *
 * 再開のリクエストは変えてよい項目だけを送る(固定項目はサーバーが前回の設定を使う)。
 * どの項目を送るかは契約の都合なので、実装(infrastructure)の中で決める。
 * 画面は前回の設定(TrainingSettings)を書き換えて、そのまま渡せばよい。
 */
export type TrainedModelApi = {
  list(): Promise<ApiResult<readonly TrainedModelSummary[]>>
  /** 最新の run の学習設定。再開フォームの初期値と、固定項目の表示に使う */
  getConfig(modelId: string): Promise<ApiResult<TrainingSettings>>
  resume(modelId: string, settings: TrainingSettings): Promise<ApiResult<StartedTraining>>
  /** 学習の記録(全 run のエポックごとの loss・学習率・メトリクス)。グラフと CSV に使う */
  getHistory(modelId: string): Promise<ApiResult<TrainingHistory>>
}
