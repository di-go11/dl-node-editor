// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  appendMetricPoint,
  hasMetrics,
  metricLabelsOf,
  metricPointOf,
  metricsChartTitle,
} from './metric-points'
import type { ProgressMetrics, TrainingProgress } from './progress'

const segmentation = (patch: Partial<Extract<ProgressMetrics, { kind: 'segmentation' }>> = {}) =>
  ({
    kind: 'segmentation',
    pixelAcc: 0.9,
    miou: 0.6,
    fwIou: 0.8,
    meanClassAccuracy: 0.7,
    perClassIou: [0.95, 0.8, 0.4],
    confusionMatrix: null,
    ...patch,
  }) as const

const progress = (patch: Partial<TrainingProgress>): TrainingProgress => ({
  epoch: 1,
  trainLoss: 0.5,
  valLoss: 0.6,
  status: 'running',
  metrics: segmentation(),
  epochElapsedMs: 0,
  totalElapsedMs: 0,
  errorMessage: null,
  learningRate: null,
  ...patch,
})

describe('metricPointOf', () => {
  it('segmentation は mIoU とクラスごとの IoU の点になる', () => {
    expect(metricPointOf(3, segmentation())).toEqual({
      epoch: 3,
      kind: 'segmentation',
      main: 0.6,
      perClass: [0.95, 0.8, 0.4],
    })
  })

  it('classification は accuracy とクラスごとの accuracy の点になる', () => {
    expect(
      metricPointOf(1, {
        kind: 'classification',
        accuracy: 0.8,
        macroF1: 0.7,
        perClassAccuracy: [0.9, 0.6],
      }),
    ).toEqual({ epoch: 1, kind: 'classification', main: 0.8, perClass: [0.9, 0.6] })
  })

  it('metrics が null のエポックは値のない点になる', () => {
    expect(metricPointOf(2, null)).toEqual({ epoch: 2, kind: null, main: null, perClass: [] })
  })

  it('NaN・inf・null のクラスは null にする(0 にしない)', () => {
    const point = metricPointOf(
      1,
      segmentation({ miou: Number.NaN, perClassIou: [0.9, null, Infinity, 0] }),
    )
    expect(point.main).toBeNull()
    expect(point.perClass).toEqual([0.9, null, null, 0])
  })
})

describe('appendMetricPoint', () => {
  it('epoch 0 は描かない', () => {
    expect(appendMetricPoint([], progress({ epoch: 0 }))).toEqual([])
  })

  it('同じエポックが来たら置き換え、エポックの順に保つ', () => {
    let points = appendMetricPoint([], progress({ epoch: 2 }))
    points = appendMetricPoint(points, progress({ epoch: 1 }))
    points = appendMetricPoint(points, progress({ epoch: 2, metrics: segmentation({ miou: 0.7 }) }))
    expect(points.map((point) => [point.epoch, point.main])).toEqual([
      [1, 0.6],
      [2, 0.7],
    ])
  })
})

describe('hasMetrics', () => {
  it('値が 1 つでもあれば true、全エポックでメトリクスがなければ false', () => {
    expect(hasMetrics([])).toBe(false)
    expect(hasMetrics([metricPointOf(1, null)])).toBe(false)
    expect(hasMetrics([metricPointOf(1, null), metricPointOf(2, segmentation())])).toBe(true)
  })
})

describe('metricLabelsOf', () => {
  it('segmentation の名前と、一番多いクラス数', () => {
    const points = [
      metricPointOf(1, null),
      metricPointOf(2, segmentation({ perClassIou: [0.9] })),
      metricPointOf(3, segmentation()),
    ]
    expect(metricLabelsOf(points)).toEqual({ main: 'mIoU', perClass: 'IoU', classCount: 3 })
    expect(metricsChartTitle(points)).toBe('mIoU とクラスごとの IoU の推移')
  })

  it('classification は accuracy の名前になる', () => {
    const points = [
      metricPointOf(1, { kind: 'classification', accuracy: 1, macroF1: 1, perClassAccuracy: [1] }),
    ]
    expect(metricLabelsOf(points)).toEqual({
      main: 'accuracy',
      perClass: 'accuracy',
      classCount: 1,
    })
    expect(metricsChartTitle(points)).toBe('accuracy とクラスごとの accuracy の推移')
  })
})
