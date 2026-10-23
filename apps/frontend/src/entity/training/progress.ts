/**
 * 学習の状態と進捗。training.proto の TrainingStatus / StreamProgressResponse に対応する。
 *
 * proto の enum 名(TRAINING_STATUS_RUNNING)はエンティティでは短い名前('running')にし、
 * 対応は proto-json/ に閉じ込める。1a の GRAPH_INPUT と同じく、表記の都合を
 * 変換層の外に漏らさないためである。
 */

export const TRAINING_STATUSES = [
  'unspecified',
  'idle',
  'running',
  'completed',
  'failed',
  'stopped',
] as const

export type TrainingStatus = (typeof TRAINING_STATUSES)[number]

export const TRAINING_STATUS_LABELS: Readonly<Record<TrainingStatus, string>> = {
  unspecified: '不明',
  idle: '待機中',
  running: '学習中',
  completed: '完了',
  failed: '失敗',
  stopped: '停止',
}

/** これ以上状態が変わらない状態。進捗のストリームを閉じる判断に使う(指示書 4.6) */
export type TerminalTrainingStatus = 'completed' | 'failed' | 'stopped'

export function isTerminalStatus(status: TrainingStatus): status is TerminalTrainingStatus {
  return status === 'completed' || status === 'failed' || status === 'stopped'
}

export type SegmentationMetrics = {
  readonly kind: 'segmentation'
  readonly pixelAcc: number
  readonly miou: number
  readonly fwIou: number
  readonly meanClassAccuracy: number
  /** クラスの番号順 */
  readonly perClassIou: readonly number[]
}

export type ClassificationMetrics = {
  readonly kind: 'classification'
  readonly accuracy: number
  readonly macroF1: number
  /** クラスの番号順 */
  readonly perClassAccuracy: readonly number[]
}

/** proto の oneof(metrics)。タスクによってどちらか一方になる */
export type ProgressMetrics = SegmentationMetrics | ClassificationMetrics

export type TrainingProgress = {
  /** 終了したエポック数 */
  readonly epoch: number
  readonly trainLoss: number
  readonly valLoss: number
  readonly status: TrainingStatus
  /** メトリクスをまだ計算していないエポックでは null */
  readonly metrics: ProgressMetrics | null
  /** このエポックにかかった時間(ミリ秒) */
  readonly epochElapsedMs: number
  /** 累計の処理時間(ミリ秒) */
  readonly totalElapsedMs: number
  /**
   * 失敗の原因。失敗していなければ null。
   *
   * proto では空文字が「なし」を意味するが、空文字と「なし」を同じ値で表すと、
   * 表示側が毎回 `message !== ''` を書くことになり、書き忘れると空の赤枠が出る。
   * null にしておけば、型が確認を強制してくれる。
   */
  readonly errorMessage: string | null
}
