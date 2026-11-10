import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { apiOk } from '../../application/ports/api-result'
import type { TrainedModelApi } from '../../application/ports/trained-model-api'
import type { TrainedModelSummary } from '../../entity/trained-model/trained-model'
import type { TrainingSettings } from '../../entity/training/training-settings'
import { defaultTrainingSettings } from '../../entity/training/training-settings'
import { DependenciesContext } from '../app/dependencies'
import { fakeDependencies } from '../test-utils/fake-dependencies'

import { ResumeListPage } from './ResumeListPage'
import { ResumeSettingsPage } from './ResumeSettingsPage'

/**
 * 学習再開の 2 画面(issue doc 作業 7)を、偽物の TrainedModelApi で描いて確かめる。
 *   - 一覧から再開できるモデルを選べる
 *   - 再開の設定画面は、変えられない欄を外し、epoch が完了済み以下なら再開できない
 *   - 再開できたら進捗画面に移る
 */

const summary: TrainedModelSummary = {
  modelId: 'model-1',
  modelName: 'segnet',
  createdAt: '2026-11-01T00:00:00Z',
  task: 'segmentation',
  lastRun: {
    status: 'stopped',
    failureReason: null,
    startedAt: '2026-11-02T00:00:00Z',
    finishedAt: '2026-11-02T01:00:00Z',
  },
  completedEpochs: 5,
  resumable: true,
}

const savedSettings: TrainingSettings = {
  ...defaultTrainingSettings(),
  modelName: 'segnet',
  datasetPath: '/data/voc',
  device: 'cpu',
  epoch: 10,
}

function ProgressStub() {
  const { jobId } = useParams()
  return <h1>進捗 {jobId}</h1>
}

function renderAt(path: string, api: Partial<TrainedModelApi> = {}) {
  const resume = vi.fn<TrainedModelApi['resume']>(() =>
    Promise.resolve(apiOk({ jobId: 'job-3', status: 'running' as const })),
  )
  const trainedModelApi: TrainedModelApi = {
    list: () => Promise.resolve(apiOk([summary])),
    getConfig: () => Promise.resolve(apiOk(savedSettings)),
    resume,
    ...api,
  }
  render(
    <DependenciesContext value={fakeDependencies({ trainedModelApi })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/resume" element={<ResumeListPage />} />
          <Route path="/resume/:modelId" element={<ResumeSettingsPage />} />
          <Route path="/progress/:jobId" element={<ProgressStub />} />
        </Routes>
      </MemoryRouter>
    </DependenciesContext>,
  )
  return { resume }
}

const resumeButton = () => screen.getByRole('button', { name: '学習再開' })

describe('学習再開の一覧', () => {
  it('学習済みモデルを並べ、選ぶと再開の設定画面へ移る', async () => {
    renderAt('/resume')
    const table = await screen.findByRole('table', { name: '学習済みモデル' })
    expect(table).toHaveTextContent('segnet')
    expect(table).toHaveTextContent('セグメンテーション')
    expect(table).toHaveTextContent('停止')

    await userEvent.click(screen.getByRole('link', { name: '再開' }))
    expect(await screen.findByRole('heading', { name: '学習再開: segnet' })).toBeInTheDocument()
  })

  it('モデル構造がないモデルは再開できない', async () => {
    renderAt('/resume', {
      list: () => Promise.resolve(apiOk([{ ...summary, resumable: false }])),
    })
    expect(await screen.findByText('再開できません')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '再開' })).not.toBeInTheDocument()
  })
})

describe('学習再開の設定', () => {
  it('変えられない欄(モデル名・seed・データ)を出さず、optimizer の種類は選べない', async () => {
    renderAt('/resume/model-1')
    await screen.findByRole('heading', { name: '学習再開: segnet' })

    expect(screen.queryByRole('textbox', { name: /モデル名/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /乱数シード/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'タスクの種類' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'optimizerの種類' })).toBeDisabled()
    // 変えられる欄は出す
    expect(screen.getByRole('combobox', { name: 'lossの種類' })).toBeEnabled()
  })

  it('epoch が完了済みのエポック数以下なら、理由を出して再開できない', async () => {
    renderAt('/resume/model-1', {
      getConfig: () => Promise.resolve(apiOk({ ...savedSettings, epoch: 5 })),
    })
    await screen.findByRole('heading', { name: '学習再開: segnet' })

    expect(screen.getByText(/6 以上にしてください/)).toBeInTheDocument()
    expect(resumeButton()).toBeDisabled()
  })

  it('再開できたら、進捗画面へ移る', async () => {
    const { resume } = renderAt('/resume/model-1')
    await screen.findByRole('heading', { name: '学習再開: segnet' })

    await userEvent.click(resumeButton())

    expect(await screen.findByRole('heading', { name: '進捗 job-3' })).toBeInTheDocument()
    expect(resume).toHaveBeenCalledWith('model-1', savedSettings)
  })
})
