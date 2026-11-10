import type { ImageTaskKind } from '../training/data-spec'
import type { TrainingStatus } from '../training/progress'

/**
 * 学習済みモデル(一度でも学習を始めたモデル)の一覧の 1 件。学習再開画面の一覧に使う。
 *
 * HTTP の JSON 表記(completed_epochs など)との対応は infrastructure/http に閉じ込める。
 */
export type TrainedModelSummary = {
  readonly modelId: string
  readonly modelName: string
  /** モデルを作った日時(UTC。サーバーの文字列のまま) */
  readonly createdAt: string
  /** 最新の run の data_spec のタスク */
  readonly task: ImageTaskKind
  readonly lastRun: LastRun
  /**
   * 全 run を通して記録された完了エポック数。再開時の epoch(合計エポック数)はこれより大きくする。
   * save_last_every が 1 より大きいと、checkpoint はこれより前のエポックのことがある
   */
  readonly completedEpochs: number
  /** 再開できるか(モデル構造がサーバーに保存されているか) */
  readonly resumable: boolean
}

/** そのモデルの最新の run */
export type LastRun = {
  readonly status: TrainingStatus
  /** status が failed のときの原因 */
  readonly failureReason: string | null
  /** 学習を始めた日時(UTC。サーバーの文字列のまま) */
  readonly startedAt: string
  /** 学習が終わった日時。学習中、または終了を記録できていなければ null */
  readonly finishedAt: string | null
}

/** 再開時の epoch(合計エポック数)の最小値 */
export function minResumeEpoch(completedEpochs: number): number {
  return completedEpochs + 1
}
