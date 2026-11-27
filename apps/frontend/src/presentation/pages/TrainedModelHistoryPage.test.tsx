import { render, screen } from '@testing-library/react'
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
