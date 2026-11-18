// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import type { TrainingSettings } from '../../entity/training/training-settings'
import { defaultTrainingSettings } from '../../entity/training/training-settings'
import { apiError, apiOk } from '../ports/api-result'
import type { TrainedModelApi } from '../ports/trained-model-api'

import { resumeTraining } from './resume-training'

function fakeTrainedModelApi(result: ReturnType<TrainedModelApi['resume']>) {
  const resume = vi.fn<TrainedModelApi['resume']>(() => result)
  const api: TrainedModelApi = {
    list: () => Promise.resolve(apiOk([])),
    getConfig: () => Promise.resolve(apiOk(defaultTrainingSettings())),
    resume,
  }
  return { api, resume }
}

const settings: TrainingSettings = {
  ...defaultTrainingSettings(),
  device: 'cpu',
  epoch: 10,
}

describe('resumeTraining', () => {
  it('検証を通れば、モデルと設定を渡して再開し、job_id を返す', async () => {
    const { api, resume } = fakeTrainedModelApi(
      Promise.resolve(apiOk({ jobId: 'job-9', status: 'running' as const })),
    )

    const result = await resumeTraining(
      { trainedModelApi: api },
      { modelId: 'model-1', settings, completedEpochs: 5 },
    )

    expect(result).toEqual({ ok: true, jobId: 'job-9' })
    expect(resume).toHaveBeenCalledWith('model-1', settings)
  })

  it('epoch が完了済み以下なら、サーバーに送らない', async () => {
    const { api, resume } = fakeTrainedModelApi(
      Promise.resolve(apiOk({ jobId: 'job-9', status: 'running' as const })),
    )

    const result = await resumeTraining(
      { trainedModelApi: api },
      { modelId: 'model-1', settings: { ...settings, epoch: 5 }, completedEpochs: 5 },
    )

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: 'invalid' })
    expect(resume).not.toHaveBeenCalled()
  })

  it('API の失敗はそのまま返す', async () => {
    const error = { kind: 'http', status: 409, message: '再開できません' } as const
    const { api } = fakeTrainedModelApi(Promise.resolve(apiError(error)))

    const result = await resumeTraining(
      { trainedModelApi: api },
      { modelId: 'model-1', settings, completedEpochs: 5 },
    )

    expect(result).toEqual({ ok: false, reason: 'api', error })
  })
})
