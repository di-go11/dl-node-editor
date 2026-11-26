// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { HistoryEpoch, TrainingHistory } from './history'
import {
  historyLearningRatePoints,
  historyLossPoints,
  historyToCsv,
  latestEpochs,
  perClassColumnsOf,
  perClassValuesOf,
} from './history'

const epoch = (patch: Partial<HistoryEpoch>): HistoryEpoch => ({
  jobId: 'job-1',
  epoch: 1,
  trainLoss: 0.5,
  valLoss: 0.6,
  learningRate: 1e-3,
  epochElapsedMs: 1000,
  metrics: {
    kind: 'segmentation',
    pixelAcc: 0.9,
    miou: 0.5,
    fwIou: 0.8,
    meanClassAccuracy: 0.6,
    perClassIou: [0.9, 0.1],
  },
  ...patch,
})

const history = (epochs: readonly HistoryEpoch[]): TrainingHistory => ({
  modelId: 'model-1',
  modelName: 'seg',
  runs: [
    { jobId: 'job-1', status: 'completed', failureReason: null, startedAt: 't1', finishedAt: 't2' },
    { jobId: 'job-2', status: 'running', failureReason: null, startedAt: 't3', finishedAt: null },
  ],
  epochs,
})

describe('グラフの点', () => {
  it('同じエポック番号が 2 つの run にあれば、後の run の値を使う(再開でやり直したエポック)', () => {
    const h = history([
      epoch({ epoch: 1 }),
      epoch({ epoch: 2, trainLoss: 0.4 }),
      epoch({ jobId: 'job-2', epoch: 2, trainLoss: 0.3, learningRate: 5e-4 }),
      epoch({ jobId: 'job-2', epoch: 3 }),
    ])
    expect(latestEpochs(h).map((e) => [e.jobId, e.epoch])).toEqual([
      ['job-1', 1],
      ['job-2', 2],
      ['job-2', 3],
    ])
    expect(historyLossPoints(h)[1]).toEqual({ epoch: 2, trainLoss: 0.3, valLoss: 0.6 })
    expect(historyLearningRatePoints(h)[1]).toEqual({ epoch: 2, learningRate: 5e-4 })
  })
})

describe('historyToCsv', () => {
  it('全 run の全エポックを 1 行ずつ出し、クラスごとの値も列にする', () => {
    const csv = historyToCsv(
      history([epoch({ epoch: 1 }), epoch({ jobId: 'job-2', epoch: 1, learningRate: null })]),
    )
    expect(csv.split('\r\n')).toEqual([
      'run,job_id,epoch,train_loss,val_loss,learning_rate,epoch_elapsed_ms,pixel_accuracy,miou,fw_iou,mean_class_accuracy,iou_class_0,iou_class_1',
      '1,job-1,1,0.5,0.6,0.001,1000,0.9,0.5,0.8,0.6,0.9,0.1',
      // 学習率の記録がない(null)ところは空にする
      '2,job-2,1,0.5,0.6,,1000,0.9,0.5,0.8,0.6,0.9,0.1',
      '',
    ])
  })

  it('メトリクスのないエポックは、メトリクスの列を空にする。NaN も空にする', () => {
    const csv = historyToCsv(
      history([
        epoch({ epoch: 1 }),
        epoch({ epoch: 2, metrics: null, trainLoss: Number.NaN }),
      ]),
    )
    expect(csv.split('\r\n')[2]).toBe('1,job-1,2,,0.6,0.001,1000,,,,,,')
  })

  it('classification のメトリクスは accuracy / macro_f1 / クラスごとの accuracy の列になる', () => {
    const csv = historyToCsv(
      history([
        epoch({
          metrics: { kind: 'classification', accuracy: 0.75, macroF1: 0.5, perClassAccuracy: [1, 0.5] },
        }),
      ]),
    )
    expect(csv.split('\r\n')[0]).toBe(
      'run,job_id,epoch,train_loss,val_loss,learning_rate,epoch_elapsed_ms,accuracy,macro_f1,accuracy_class_0,accuracy_class_1',
    )
  })

  it('カンマ・引用符を含む値は引用符で囲む', () => {
    const csv = historyToCsv(history([epoch({ jobId: 'job,"x"' })]))
    expect(csv.split('\r\n')[1]?.startsWith(',"job,""x""",1,')).toBe(true)
  })
})

describe('クラスごとの値の列', () => {
  it('列数は全エポックで一番多いクラス数。segmentation は IoU', () => {
    const h = history([
      epoch({ epoch: 1, metrics: null }),
      epoch({ epoch: 2 }),
      epoch({
        epoch: 3,
        metrics: {
          kind: 'segmentation',
          pixelAcc: 0.9,
          miou: 0.5,
          fwIou: 0.8,
          meanClassAccuracy: 0.6,
          perClassIou: [0.9, 0.1, 0.3],
        },
      }),
    ])
    expect(perClassColumnsOf(h.epochs)).toEqual({ count: 3, label: 'IoU' })
    expect(perClassValuesOf(h.epochs[0]?.metrics ?? null)).toEqual([])
  })

  it('classification は accuracy。メトリクスが 1 つもなければ 0 列', () => {
    const classification = epoch({
      metrics: { kind: 'classification', accuracy: 0.75, macroF1: 0.5, perClassAccuracy: [1, 0.5] },
    })
    expect(perClassColumnsOf([classification])).toEqual({ count: 2, label: 'accuracy' })
    expect(perClassColumnsOf([epoch({ metrics: null })])).toEqual({ count: 0, label: 'IoU' })
  })
})
