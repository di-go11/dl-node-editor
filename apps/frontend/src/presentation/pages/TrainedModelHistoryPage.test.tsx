import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'

import { apiOk } from '../../application/ports/api-result'
import type { TrainedModelApi } from '../../application/ports/trained-model-api'
import type { HistoryEpoch, TrainingHistory } from '../../entity/trained-model/history'
import { DependenciesContext } from '../app/dependencies'
import { fakeDependencies } from '../test-utils/fake-dependencies'

import { TrainedModelHistoryPage } from './TrainedModelHistoryPage'

/**
 * 学習の記録の画面のうち、mIoU とクラスごとの IoU の推移のグラフ
 * (issue「mIoU とクラスごとの IoU の推移グラフ」)の出し方を確かめる。
 */

const epoch = (patch: Partial<HistoryEpoch>): HistoryEpoch => ({
  jobId: 'job-1',
  epoch: 1,
  trainLoss: 0.5,
  valLoss: 0.6,
  learningRate: 1e-3,
  epochElapsedMs: 1000,
  metrics: null,
  ...patch,
})

function renderHistory(epochs: readonly HistoryEpoch[]) {
  const history: TrainingHistory = {
    modelId: 'model-1',
    modelName: 'segnet',
    runs: [
      {
        jobId: 'job-1',
        status: 'completed',
        failureReason: null,
        startedAt: 't1',
        finishedAt: 't2',
      },
    ],
    epochs,
  }
  const defaults = fakeDependencies()
  const trainedModelApi: TrainedModelApi = {
    ...defaults.trainedModelApi,
    getHistory: () => Promise.resolve(apiOk(history)),
  }
  render(
    <DependenciesContext value={{ ...defaults, trainedModelApi }}>
      <MemoryRouter initialEntries={['/models/model-1/history']}>
        <Routes>
          <Route path="/models/:modelId/history" element={<TrainedModelHistoryPage />} />
        </Routes>
      </MemoryRouter>
    </DependenciesContext>,
  )
}

describe('mIoU とクラスごとの IoU の推移', () => {
  it('segmentation の記録では、グラフの見出しと SVG で保存のボタンを出す', async () => {
    renderHistory([
      epoch({
        metrics: {
          kind: 'segmentation',
          pixelAcc: 0.9,
          miou: 0.5,
          fwIou: 0.8,
          meanClassAccuracy: 0.6,
          perClassIou: [0.9, null, 0.3],
          confusionMatrix: null,
        },
      }),
    ])
    const section = await screen.findByRole('region', { name: 'mIoU とクラスごとの IoU の推移' })
    expect(section).toHaveTextContent('SVG で保存')
    expect(screen.getByRole('checkbox', { name: 'クラス 2 の IoU' })).toBeChecked()
  })

  it('classification の記録では accuracy の名前で描く', async () => {
    renderHistory([
      epoch({
        metrics: {
          kind: 'classification',
          accuracy: 0.8,
          macroF1: 0.7,
          perClassAccuracy: [0.9, 0.7],
        },
      }),
    ])
    expect(
      await screen.findByRole('heading', { name: 'accuracy とクラスごとの accuracy の推移' }),
    ).toBeInTheDocument()
  })

  it('メトリクスのない記録では、グラフの代わりに文言を出す', async () => {
    renderHistory([epoch({ epoch: 1 }), epoch({ epoch: 2 })])
    expect(
      await screen.findByText('この学習にはメトリクスの記録がありません。'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'mIoU とクラスごとの IoU の推移' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'loss の推移' })).toBeInTheDocument()
  })
})

describe('混同行列', () => {
  const withMatrix = (matrix: number[][]): HistoryEpoch['metrics'] => ({
    kind: 'segmentation',
    pixelAcc: 0.9,
    miou: 0.5,
    fwIou: 0.8,
    meanClassAccuracy: 0.6,
    perClassIou: [0.9, 0.4],
    confusionMatrix: matrix,
  })

  it('開いたときは最後のエポックを選び、エポックを選ぶと切り替わる', async () => {
    const user = userEvent.setup()
    renderHistory([
      epoch({
        epoch: 1,
        metrics: withMatrix([
          [9, 1],
          [6, 4],
        ]),
      }),
      epoch({
        epoch: 2,
        metrics: withMatrix([
          [9, 1],
          [3, 7],
        ]),
      }),
    ])
    const select = await screen.findByRole('combobox', { name: 'エポック' })
    expect(select).toHaveValue('2')
    expect(screen.getByRole('table', { name: '検証データ・エポック 2' })).toHaveTextContent(
      '70.0 %',
    )

    await user.selectOptions(select, '1')
    expect(screen.getByRole('table', { name: '検証データ・エポック 1' })).toHaveTextContent(
      '40.0 %',
    )
  })

  it('混同行列のない記録(このissueより前の学習・分類タスク)では、その旨を出す', async () => {
    renderHistory([
      epoch({ epoch: 1 }),
      epoch({
        epoch: 2,
        metrics: { kind: 'classification', accuracy: 1, macroF1: 1, perClassAccuracy: [1] },
      }),
    ])
    expect(
      await screen.findByText('この学習には混同行列が記録されていません。'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'エポック' })).not.toBeInTheDocument()
  })
})

describe('グラフの保存', () => {
  it('グラフごとに SVG と PNG の保存ボタンがある。描く前に押すと保存できない理由を出す', async () => {
    const user = userEvent.setup()
    renderHistory([epoch({ epoch: 1 }), epoch({ epoch: 2 })])
    const lossSection = await screen.findByRole('region', { name: 'loss の推移' })
    expect(within(lossSection).getByRole('button', { name: 'SVG で保存' })).toBeInTheDocument()

    // jsdom はグラフ(recharts の svg)を描かないので、保存できない側の動きを確かめる
    await user.click(within(lossSection).getByRole('button', { name: 'PNG で保存' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'グラフがまだ描かれていないため、保存できませんでした。',
    )
  })
})
