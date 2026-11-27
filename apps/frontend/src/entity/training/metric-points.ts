import type { ProgressMetrics, TrainingProgress } from './progress'

/**
 * mIoU とクラスごとの IoU の推移のグラフ(issue「mIoU とクラスごとの IoU の推移グラフ」)の点。
 *
 * 分類タスクも同じ形で描く(mIoU → accuracy、クラスごとの IoU → クラスごとの accuracy)。
 * 学習中の画面(進捗のストリーム)と、学習の記録の画面(DB の記録)の両方で使う。
 */

/** グラフの 1 点。値がない(メトリクスを計算していない・NaN)ところは null にして線を切る */
export type MetricPoint = {
  readonly epoch: number
  /** 値の名前を決めるのに使う。メトリクスのないエポックでは null */
  readonly kind: ProgressMetrics['kind'] | null
  /** segmentation は mIoU、classification は accuracy */
  readonly main: number | null
  /** クラスの番号順。segmentation は IoU、classification は accuracy */
  readonly perClass: readonly (number | null)[]
}

/** クラスごとの値。segmentation は IoU、classification は accuracy。メトリクスがなければ空 */
export function perClassValuesOf(metrics: ProgressMetrics | null): readonly (number | null)[] {
  if (metrics === null) return []
  return metrics.kind === 'segmentation' ? metrics.perClassIou : metrics.perClassAccuracy
}

/** 有限の数でなければ null(0 にはしない。検証データに現れないクラスの NaN を 0 と区別する) */
const finiteOrNull = (value: number | null): number | null =>
  value !== null && Number.isFinite(value) ? value : null

/** あるエポックのメトリクスから点を作る */
export function metricPointOf(epoch: number, metrics: ProgressMetrics | null): MetricPoint {
  if (metrics === null) return { epoch, kind: null, main: null, perClass: [] }
  return {
    epoch,
    kind: metrics.kind,
    main: finiteOrNull(metrics.kind === 'segmentation' ? metrics.miou : metrics.accuracy),
    perClass: perClassValuesOf(metrics).map(finiteOrNull),
  }
}

/** 進捗を点の列に加える。epoch 0・同じエポック・並び順の扱いは appendLossPoint と同じ */
export function appendMetricPoint(
  points: readonly MetricPoint[],
  progress: TrainingProgress,
): readonly MetricPoint[] {
  if (progress.epoch === 0) return points
  const point = metricPointOf(progress.epoch, progress.metrics)
  return [...points.filter((existing) => existing.epoch !== point.epoch), point].sort(
    (a, b) => a.epoch - b.epoch,
  )
}

/** 1 点でも値があるか。メトリクスを 1 エポックも記録していなければ、グラフの代わりに文言を出す */
export function hasMetrics(points: readonly MetricPoint[]): boolean {
  return points.some((point) => point.main !== null || point.perClass.some((v) => v !== null))
}

export type MetricLabels = {
  /** 太い線の名前 */
  readonly main: 'mIoU' | 'accuracy'
  /** クラスごとの値の名前 */
  readonly perClass: 'IoU' | 'accuracy'
  /** 線を引くクラスの数(全エポックで一番多いクラス数) */
  readonly classCount: number
}

/**
 * 凡例の名前とクラス数。値の名前は、メトリクスのある最初の点のタスクで決める
 * (1 つのモデルのタスクは変わらない。history.ts の perClassColumnsOf と同じ)
 */
export function metricLabelsOf(points: readonly MetricPoint[]): MetricLabels {
  const kind = points.find((point) => point.kind !== null)?.kind
  const classCount = Math.max(0, ...points.map((point) => point.perClass.length))
  return kind === 'classification'
    ? { main: 'accuracy', perClass: 'accuracy', classCount }
    : { main: 'mIoU', perClass: 'IoU', classCount }
}

/** グラフの見出し。segmentation は「mIoU とクラスごとの IoU の推移」 */
export function metricsChartTitle(points: readonly MetricPoint[]): string {
  const labels = metricLabelsOf(points)
  return `${labels.main} とクラスごとの ${labels.perClass} の推移`
}
