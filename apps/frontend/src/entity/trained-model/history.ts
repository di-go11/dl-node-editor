import type {
  LearningRatePoint,
  LossPoint,
  ProgressMetrics,
  TrainingStatus,
} from '../training/progress'

/**
 * 学習済みモデルの学習の記録(GET /models/{model_id}/history)。全 run の、エポックごとの結果。
 * モデル一覧から開く「学習の記録」の画面で、loss・学習率のグラフ(SVG で保存できる)と
 * メトリクスの表(CSV で保存できる)に使う。
 */
export type TrainingHistory = {
  readonly modelId: string
  readonly modelName: string
  /** 学習を始めた順(新規学習 1 件と、再開ごとに 1 件) */
  readonly runs: readonly HistoryRun[]
  /**
   * run の順、run の中はエポックの順。エポック番号は再開をまたいで続く。
   * 再開した run が前の run と同じエポック番号を持つことがある(checkpoint を間引いて保存したとき)
   */
  readonly epochs: readonly HistoryEpoch[]
}

export type HistoryRun = {
  readonly jobId: string
  readonly status: TrainingStatus
  readonly failureReason: string | null
  readonly startedAt: string
  readonly finishedAt: string | null
}

export type HistoryEpoch = {
  readonly jobId: string
  /** 終了したエポック数(1 始まり。再開をまたいで続く) */
  readonly epoch: number
  readonly trainLoss: number | null
  readonly valLoss: number | null
  /** 学習率を記録する前の学習では null */
  readonly learningRate: number | null
  readonly epochElapsedMs: number
  readonly metrics: ProgressMetrics | null
}

/**
 * グラフに描くエポック。同じエポック番号が 2 つの run にあれば、後の run の値を使う
 * (再開でやり直したエポックなので、後の値がいまの重みにつながっている)。エポックの順に並べる。
 */
export function latestEpochs(history: TrainingHistory): readonly HistoryEpoch[] {
  const byEpoch = new Map<number, HistoryEpoch>()
  // epochs は run の順なので、後から来たものが上書きする
  for (const epoch of history.epochs) byEpoch.set(epoch.epoch, epoch)
  return [...byEpoch.values()].sort((a, b) => a.epoch - b.epoch)
}

export function historyLossPoints(history: TrainingHistory): readonly LossPoint[] {
  return latestEpochs(history).map((epoch) => ({
    epoch: epoch.epoch,
    trainLoss: epoch.trainLoss,
    valLoss: epoch.valLoss,
  }))
}

export function historyLearningRatePoints(history: TrainingHistory): readonly LearningRatePoint[] {
  return latestEpochs(history).map((epoch) => ({
    epoch: epoch.epoch,
    learningRate: epoch.learningRate,
  }))
}

// ------------------------------------------------------------
// CSV
// ------------------------------------------------------------

/** RFC 4180 の書き方。区切り・引用符・改行を含む値は "" で囲み、中の " は "" にする */
function csvCell(value: string | number | null): string {
  if (value === null) return ''
  // NaN や inf(JSON の null 以外で来ることはないが、念のため)は空にする
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/** クラスごとの値。segmentation は IoU、classification は accuracy。メトリクスがなければ空 */
export function perClassValuesOf(metrics: ProgressMetrics | null): readonly number[] {
  if (metrics === null) return []
  return metrics.kind === 'segmentation' ? metrics.perClassIou : metrics.perClassAccuracy
}

/**
 * 表に出すクラスの列数(全エポックで一番多いクラス数)と、その値の名前。
 * 値の名前は、メトリクスのある最初のエポックのタスクで決める(1 つのモデルのタスクは変わらない)
 */
export function perClassColumnsOf(epochs: readonly HistoryEpoch[]): {
  readonly count: number
  readonly label: 'IoU' | 'accuracy'
} {
  const count = Math.max(0, ...epochs.map((epoch) => perClassValuesOf(epoch.metrics).length))
  const first = epochs.find((epoch) => epoch.metrics !== null)?.metrics
  return { count, label: first?.kind === 'classification' ? 'accuracy' : 'IoU' }
}

/** クラスごとの値の列数(全エポックで一番多いクラス数) */
function classCount(epochs: readonly HistoryEpoch[], kind: ProgressMetrics['kind']): number {
  let count = 0
  for (const { metrics } of epochs) {
    if (metrics === null || metrics.kind !== kind) continue
    const values = metrics.kind === 'segmentation' ? metrics.perClassIou : metrics.perClassAccuracy
    count = Math.max(count, values.length)
  }
  return count
}

/**
 * メトリクスの表を CSV にする。**全 run の全エポックを、run の順にそのまま 1 行ずつ**出す
 * (グラフと違って、同じエポック番号の行も両方残す。job_id の列で区別できる)。
 *
 * 列: run(何回目の学習か)、job_id、epoch、train_loss、val_loss、learning_rate、epoch_elapsed_ms、
 * タスクのメトリクス(segmentation なら pixel_accuracy, miou, fw_iou, mean_class_accuracy, iou_class_0…、
 * classification なら accuracy, macro_f1, accuracy_class_0…)。
 * 値がないところ(記録なし・NaN)は空にする。行の終わりは CRLF(Excel で開きやすいように)。
 */
export function historyToCsv(history: TrainingHistory): string {
  const runIndex = new Map(history.runs.map((run, index) => [run.jobId, index + 1]))
  // メトリクスの列は、そのタスクのメトリクスが 1 エポックでもあるときだけ出す
  const hasSeg = history.epochs.some((e) => e.metrics?.kind === 'segmentation')
  const hasCls = history.epochs.some((e) => e.metrics?.kind === 'classification')
  const segClasses = classCount(history.epochs, 'segmentation')
  const clsClasses = classCount(history.epochs, 'classification')
  const range = (n: number) => Array.from({ length: n }, (_, i) => i)

  const header = [
    'run',
    'job_id',
    'epoch',
    'train_loss',
    'val_loss',
    'learning_rate',
    'epoch_elapsed_ms',
    ...(hasSeg
      ? [
          'pixel_accuracy',
          'miou',
          'fw_iou',
          'mean_class_accuracy',
          ...range(segClasses).map((i) => `iou_class_${i}`),
        ]
      : []),
    ...(hasCls ? ['accuracy', 'macro_f1', ...range(clsClasses).map((i) => `accuracy_class_${i}`)] : []),
  ]

  const rows = history.epochs.map((epoch) => {
    const seg = epoch.metrics?.kind === 'segmentation' ? epoch.metrics : null
    const cls = epoch.metrics?.kind === 'classification' ? epoch.metrics : null
    return [
      runIndex.get(epoch.jobId) ?? null,
      epoch.jobId,
      epoch.epoch,
      epoch.trainLoss,
      epoch.valLoss,
      epoch.learningRate,
      epoch.epochElapsedMs,
      ...(hasSeg
        ? [
            seg?.pixelAcc ?? null,
            seg?.miou ?? null,
            seg?.fwIou ?? null,
            seg?.meanClassAccuracy ?? null,
            ...range(segClasses).map((i) => seg?.perClassIou[i] ?? null),
          ]
        : []),
      ...(hasCls
        ? [
            cls?.accuracy ?? null,
            cls?.macroF1 ?? null,
            ...range(clsClasses).map((i) => cls?.perClassAccuracy[i] ?? null),
          ]
        : []),
    ]
  })

  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
