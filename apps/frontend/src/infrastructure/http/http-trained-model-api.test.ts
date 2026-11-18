// @vitest-environment node
import { HttpResponse, http } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import type { TrainingSettings } from '../../entity/training/training-settings'
import { defaultTrainingSettings } from '../../entity/training/training-settings'
import { defaultVariant } from '../../entity/training/variant'
import { OPTIMIZER_TYPES } from '../../entity/training/optimizer'
import { validSegnetGraph } from '../../entity/validation/test-fixtures'
import { MOCK_TRAINED_MODELS, createHandlers } from '../mock/handlers'
import { TEST_BASE_URL, createMockServer } from '../mock/server'

import { createApiClient } from './api-client'
import { createHttpTrainedModelApi } from './http-trained-model-api'
import { createHttpTrainingApi } from './http-training-api'
import { toRustResumeTrainingRequest } from './rust-training-request'

/**
 * 学習済みモデルの一覧・設定の取得・再開の HTTP 実装を、MSW のモック API に対して動かして確かめる。
 *
 * モックは新規学習(POST /trainings)で始めたモデルを一覧に載せるので、各テストは
 * まず学習を始めてから再開する。モックの状態はテストの間で共有されるので、モデル名はテストごとに変える。
 */

const server = createMockServer({ epochs: 5 })
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const client = () => createApiClient(TEST_BASE_URL)

function settingsNamed(modelName: string): TrainingSettings {
  return {
    ...defaultTrainingSettings(),
    modelName,
    datasetId: 'mock-dataset-voc2012',
    device: 'cpu',
    epoch: 5,
  }
}

/** 新規学習を始めて、そのモデルの model_id を返す */
async function trainModel(settings: TrainingSettings): Promise<string> {
  const started = await createHttpTrainingApi(client()).start(validSegnetGraph(), settings)
  if (!started.ok) throw new Error(started.error.message)
  const list = await createHttpTrainedModelApi(client()).list()
  if (!list.ok) throw new Error(list.error.message)
  const model = list.value.find((summary) => summary.modelName === settings.modelName)
  if (model === undefined) throw new Error('学習したモデルが一覧にありません')
  return model.modelId
}

describe('createHttpTrainedModelApi', () => {
  it('一覧は JSON をエンティティの形にする', async () => {
    await trainModel(settingsNamed('list_model'))

    const result = await createHttpTrainedModelApi(client()).list()

    if (!result.ok) throw new Error(result.error.message)
    expect(result.value[0]).toMatchObject({
      modelName: 'list_model',
      task: 'segmentation',
      lastRun: { status: 'completed', failureReason: null },
      completedEpochs: 5,
      resumable: true,
    })
  })

  it('前回の設定は、データセット以外は学習を始めたときの設定に戻る', async () => {
    const settings = settingsNamed('config_model')
    const modelId = await trainModel(settings)

    const result = await createHttpTrainedModelApi(client()).getConfig(modelId)

    // 設定の取得 API はデータセットを返さない(再開ではデータセットを変えられない)ので、未選択になる
    expect(result).toEqual({ ok: true, value: { ...settings, datasetId: '' } })
  })

  it('設定の取得の 404 は、モデルが見つからないという説明にする', async () => {
    const result = await createHttpTrainedModelApi(client()).getConfig('no-such-model')
    expect(result).toEqual({
      ok: false,
      error: { kind: 'http', status: 404, message: '指定されたモデルが見つかりません。' },
    })
  })

  it('変えてよい項目だけを送って再開し、job_id を受け取る', async () => {
    const settings = settingsNamed('resume_model')
    const modelId = await trainModel(settings)

    const result = await createHttpTrainedModelApi(client()).resume(modelId, {
      ...settings,
      epoch: 10,
    })

    expect(result).toMatchObject({ ok: true, value: { status: 'running' } })
  })

  it('optimizer の種類を変えると 422 になる', async () => {
    const settings = settingsNamed('resume_optimizer')
    const modelId = await trainModel(settings)

    const result = await createHttpTrainedModelApi(client()).resume(modelId, {
      ...settings,
      epoch: 10,
      optimizer: defaultVariant(OPTIMIZER_TYPES, 'sgd'),
    })

    expect(result).toMatchObject({ ok: false, error: { kind: 'http', status: 422 } })
  })

  it('epoch が完了済み以下だと 409 になる', async () => {
    const settings = settingsNamed('resume_epoch')
    const modelId = await trainModel(settings)

    const result = await createHttpTrainedModelApi(client()).resume(modelId, settings)

    expect(result).toMatchObject({ ok: false, error: { kind: 'http', status: 409 } })
  })

  it('ブラウザのモックの初期データは、一覧と設定の取得をそのまま通る', async () => {
    // 初期データ入りのハンドラを前に差し込む(afterEach の resetHandlers で外れる)
    server.use(...createHandlers({ baseUrl: TEST_BASE_URL, initialModels: MOCK_TRAINED_MODELS }))
    const api = createHttpTrainedModelApi(client())

    const list = await api.list()
    if (!list.ok) throw new Error(list.error.message)
    // 最近学習したモデルが先
    expect(list.value.map((model) => model.modelId)).toEqual(
      MOCK_TRAINED_MODELS.map((model) => model.modelId).reverse(),
    )
    expect(list.value.find((model) => model.modelId === 'mock-seed-oom')?.lastRun).toMatchObject({
      status: 'failed',
      failureReason: 'CUDA out of memory',
    })

    for (const model of MOCK_TRAINED_MODELS) {
      const config = await api.getConfig(model.modelId)
      if (model.resumable) {
        expect(config, model.modelId).toMatchObject({ ok: true })
      } else {
        expect(config, model.modelId).toMatchObject({
          ok: false,
          error: { kind: 'http', status: 409 },
        })
      }
    }
  })

  it('一覧の応答が契約の形でなければ invalid-response になる', async () => {
    server.use(http.get(`${TEST_BASE_URL}/models`, () => HttpResponse.json({ models: [{}] })))
    const result = await createHttpTrainedModelApi(client()).list()
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-response' } })
  })
})

describe('toRustResumeTrainingRequest', () => {
  it('固定項目(model_name・data_spec・seed・データセット)を含めない', () => {
    const result = toRustResumeTrainingRequest({ ...settingsNamed('x'), seed: 42 })
    if (!result.ok) throw new Error(result.message)
    expect(Object.keys(result.value).sort()).toEqual([
      'batch',
      'device',
      'epoch',
      'loss',
      'optimizer',
      'save_last_every',
    ])
    expect(result.value.optimizer).toMatchObject({ type: 'adam' })
  })
})
