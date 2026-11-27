/**
 * 学習の状態と進捗。
 *
 * HTTP の JSON 表記(train_loss など)はエンティティでは使わず、対応は
 * infrastructure/http/http-training-progress.ts に閉じ込める。1a の GRAPH_INPUT と同じく、
 * 表記の都合を変換層の外に漏らさないためである。
 */

export const TRAINING_STATUSES = ['idle', 'running', 'completed', 'failed', 'stopped'] as const

export type TrainingStatus = (typeof TRAINING_STATUSES)[number]

export const TRAINING_STATUS_LABELS: Readonly<Record<TrainingStatus, string>> = {
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

/*
 * メトリクスの値は、NaN や inf のときは null(JSON では表せないため。Rust の serde_json は null で書く)。
 * 例えば検証データに現れないクラスの IoU は、学習エンジンが NaN にする(0 と区別するため)。
 */

export type SegmentationMetrics = {
  readonly kind: 'segmentation'
  readonly pixelAcc: number | null
  /** 背景(クラス 0)と、検証データに現れないクラスを除いた IoU の平均 */
  readonly miou: number | null
  readonly fwIou: number | null
  readonly meanClassAccuracy: number | null
  /** クラスの番号順 */
  readonly perClassIou: readonly (number | null)[]
}

export type ClassificationMetrics = {
  readonly kind: 'classification'
  readonly accuracy: number | null
  readonly macroF1: number | null
  /** クラスの番号順 */
  readonly perClassAccuracy: readonly (number | null)[]
}

/** タスクによってどちらか一方になる */
export type ProgressMetrics = SegmentationMetrics | ClassificationMetrics

export type TrainingProgress = {
  /** 終了したエポック数 */
  readonly epoch: number
  /** 値が NaN や inf のときは null(JSON では表せないため) */
  readonly trainLoss: number | null
  /** 値が NaN や inf のときは null(JSON では表せないため) */
  readonly valLoss: number | null
  readonly status: TrainingStatus
  /** メトリクスをまだ計算していないエポックでは null */
  readonly metrics: ProgressMetrics | null
  /** このエポックにかかった時間(ミリ秒) */
  readonly epochElapsedMs: number
  /** 累計の処理時間(ミリ秒)。学習を再開すると 0 から数え直す */
  readonly totalElapsedMs: number
  /** 失敗の原因。失敗していなければ null */
  readonly errorMessage: string | null
  /**
   * このエポックの最後のバッチで使った学習率(学習エンジンが optimizer から読んだ値)。
   * まだ 1 エポックも終わっていない・送らない古いサーバーのときは null
   */
  readonly learningRate: number | null
}

/** loss のグラフの 1 点 */
export type LossPoint = {
  readonly epoch: number
  readonly trainLoss: number | null
  readonly valLoss: number | null
}

/**
 * 受け取った進捗を、グラフの点の列に加える。
 *
 *   - epoch 0 は描かない。まだ 1 エポックも終わっておらず、loss に意味がない
 *     (学習を再開した直後の最初のイベントも epoch 0 になる)。
 *   - 同じエポックのイベントは置き換える。再接続や終了の通知で、同じエポックが再び届くためである。
 *   - 点はエポックの順に保つ。
 *
 * サーバーは更新が重なると最新の状態だけを送るので、エポックが飛ぶことはある。
 */
export function appendLossPoint(
  points: readonly LossPoint[],
  progress: TrainingProgress,
): readonly LossPoint[] {
  if (progress.epoch === 0) return points
  const point: LossPoint = {
    epoch: progress.epoch,
    trainLoss: progress.trainLoss,
    valLoss: progress.valLoss,
  }
  return [...points.filter((existing) => existing.epoch !== point.epoch), point].sort(
    (a, b) => a.epoch - b.epoch,
  )
}

/** 学習率のグラフの 1 点。学習率が分からないエポック(古いサーバー)は null で、線を切る */
export type LearningRatePoint = {
  readonly epoch: number
  readonly learningRate: number | null
}

/** 進捗を学習率のグラフの点の列に加える。epoch 0・同じエポック・並び順の扱いは appendLossPoint と同じ */
export function appendLearningRatePoint(
  points: readonly LearningRatePoint[],
  progress: TrainingProgress,
): readonly LearningRatePoint[] {
  if (progress.epoch === 0) return points
  const point: LearningRatePoint = { epoch: progress.epoch, learningRate: progress.learningRate }
  return [...points.filter((existing) => existing.epoch !== point.epoch), point].sort(
    (a, b) => a.epoch - b.epoch,
  )
}

/** 1 点でも学習率があるか。全エポックで分からない(古いサーバー・古い学習)ならグラフ自体を出さない */
export function hasLearningRate(points: readonly LearningRatePoint[]): boolean {
  return points.some((point) => point.learningRate !== null)
}
