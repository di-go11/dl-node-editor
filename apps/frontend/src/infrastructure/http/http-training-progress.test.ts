// @vitest-environment node
import { HttpResponse, http } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { ProgressListener } from '../../application/ports/training-api'
import type { TrainingProgress } from '../../entity/training/progress'
import { defaultTrainingSettings } from '../../entity/training/training-settings'
import { validSegnetGraph } from '../../entity/validation/test-fixtures'
import { TEST_BASE_URL, createMockServer } from '../mock/server'

import { createApiClient } from './api-client'
import { createHttpTrainingApi } from './http-training-api'
import type { ProgressEventSource } from './http-training-progress'
import { trainingProcessJsonSchema } from './http-training-progress'

/**
 * 進捗(SSE)と停止を確かめる。
 *
 * Node には EventSource がないので、受信の処理は偽物の EventSource で確かめる。
 * モックの SSE は fetch で本文を読み、イベントの形が受信側のスキーマに合うことを確かめる。
 */

class FakeEventSource implements ProgressEventSource {
  readyState = 1
  closed = false
  private readonly listeners = new Map<string, (event: Event) => void>()

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, listener)
  }

  close(): void {
    this.closed = true
    this.readyState = 2
  }

  emit(type: string, data?: string): void {
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data })
    this.listeners.get(type)?.(event)
  }
}

const RUNNING_JSON = {
  epoch: 3,
  train_loss: 0.17,
  val_loss: 0.12,
  status: 'running',
  metrics: {
    type: 'segmentation',
    pixel_accuracy: 0.97,
    miou: 0.04,
    fw_iou: 0.95,
    mean_class_accuracy: 0.36,
    per_class_iou: [0.97, 0.001, 0.08],
  },
  epoch_elapsed_ms: 6806,
  total_elapsed_ms: 20378,
}

const server = createMockServer({ progressIntervalMs: 1, epochs: 2 })
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function subscribe() {
  const source = new FakeEventSource()
  const urls: string[] = []
  const api = createHttpTrainingApi(createApiClient(TEST_BASE_URL), {
    baseUrl: TEST_BASE_URL,
    createEventSource: (url) => {
      urls.push(url)
      return source
    },
  })
  const listener = {
    onProgress: vi.fn<ProgressListener['onProgress']>(),
    onProblem: vi.fn<ProgressListener['onProblem']>(),
  }
  const unsubscribe = api.subscribeProgress('job/1', listener)
  return { source, urls, listener, unsubscribe }
}

describe('進捗の受信', () => {
  it('job_id をエンコードした URL に接続する', () => {
    expect(subscribe().urls).toEqual([`${TEST_BASE_URL}/trainings/job%2F1/progress`])
  })

  it('progress イベントを TrainingProgress に変換する', () => {
    const { source, listener } = subscribe()
    source.emit('progress', JSON.stringify(RUNNING_JSON))
    expect(listener.onProgress).toHaveBeenCalledWith<[TrainingProgress]>({
      epoch: 3,
      trainLoss: 0.17,
      valLoss: 0.12,
      status: 'running',
      metrics: {
        kind: 'segmentation',
        pixelAcc: 0.97,
        miou: 0.04,
        fwIou: 0.95,
        meanClassAccuracy: 0.36,
        perClassIou: [0.97, 0.001, 0.08],
        confusionMatrix: null,
      },
      epochElapsedMs: 6806,
      totalElapsedMs: 20378,
      errorMessage: null,
      // 学習率を送らない古いサーバーの JSON(キーなし)は null
      learningRate: null,
    })
    expect(source.closed).toBe(false)
  })

  it('クラス分類のメトリクス、loss の null、metrics の null を読める', () => {
    const { source, listener } = subscribe()
    source.emit(
      'progress',
      JSON.stringify({
        ...RUNNING_JSON,
        train_loss: null,
        metrics: { type: 'classification', accuracy: 0.8, macro_f1: 0.7, per_class_accuracy: [1] },
      }),
    )
    source.emit('progress', JSON.stringify({ ...RUNNING_JSON, epoch: 0, metrics: null }))
    expect(listener.onProgress.mock.calls[0]?.[0]).toMatchObject({
      trainLoss: null,
      metrics: { kind: 'classification', macroF1: 0.7 },
    })
    expect(listener.onProgress.mock.calls[1]?.[0].metrics).toBeNull()
  })

  it('メトリクスの NaN(JSON では null)を読める。検証データに現れないクラスの IoU は NaN になる', () => {
    const { source, listener } = subscribe()
    source.emit(
      'progress',
      JSON.stringify({
        ...RUNNING_JSON,
        metrics: {
          type: 'segmentation',
          pixel_accuracy: 0.9,
          miou: null,
          fw_iou: 0.8,
          mean_class_accuracy: 0.7,
          per_class_iou: [0.9, null, 0.1],
        },
      }),
    )
    expect(listener.onProgress.mock.calls[0]?.[0].metrics).toMatchObject({
      kind: 'segmentation',
      miou: null,
      perClassIou: [0.9, null, 0.1],
      // 混同行列のキーがない(混同行列を送る前の古いサーバー)ときは null
      confusionMatrix: null,
    })
  })

  it.each([
    [
      'C 行 C 列の行列',
      [
        [3, 1],
        [0, 4],
      ],
      [
        [3, 1],
        [0, 4],
      ],
    ],
    ['null(記録なし)', null, null],
    ['正方でない行列(読めないので記録なしと同じ)', [[3, 1]], null],
  ])('混同行列: %s', (_, confusionMatrix, expected) => {
    const { source, listener } = subscribe()
    const json = {
      ...RUNNING_JSON,
      metrics: { ...RUNNING_JSON.metrics, confusion_matrix: confusionMatrix },
    }
    source.emit('progress', JSON.stringify(json))
    // 行列の形が悪くても、ほかのメトリクスは読める
    expect(listener.onProgress.mock.calls[0]?.[0].metrics).toMatchObject({
      kind: 'segmentation',
      confusionMatrix: expected,
    })
  })

  it.each(['completed', 'stopped'])('%s を受け取ったら閉じる', (status) => {
    const { source, listener } = subscribe()
    source.emit('progress', JSON.stringify({ ...RUNNING_JSON, status }))
    expect(source.closed).toBe(true)
    expect(listener.onProgress).toHaveBeenCalledOnce()
  })

  it('failed の reason を errorMessage にして閉じる', () => {
    const { source, listener } = subscribe()
    source.emit('progress', JSON.stringify({ ...RUNNING_JSON, status: 'failed', reason: 'OOM' }))
    expect(source.closed).toBe(true)
    expect(listener.onProgress.mock.calls[0]?.[0]).toMatchObject({
      status: 'failed',
      errorMessage: 'OOM',
    })
  })

  it('形の合わない進捗は、受信をやめて知らせる', () => {
    const { source, listener } = subscribe()
    source.emit('progress', '{"epoch":"three"}')
    expect(source.closed).toBe(true)
    expect(listener.onProgress).not.toHaveBeenCalled()
    expect(listener.onProblem.mock.calls[0]?.[0].retrying).toBe(false)
  })

  it('Rust の error イベント(data あり)は、受信を続ける問題として知らせる', () => {
    const { source, listener } = subscribe()
    source.emit('error', 'failed to fetch training process')
    expect(listener.onProblem).toHaveBeenCalledWith({
      message: '学習サーバーのエラー: failed to fetch training process',
      retrying: true,
    })
  })

  it('接続の問題(data なし)は、readyState で再接続するかを見分ける', () => {
    const { source, listener } = subscribe()
    source.readyState = 0
    source.emit('error')
    expect(listener.onProblem.mock.lastCall?.[0].retrying).toBe(true)
    source.readyState = 2
    source.emit('error')
    expect(listener.onProblem.mock.lastCall?.[0].retrying).toBe(false)
  })

  it('返された関数で閉じる', () => {
    const { source, unsubscribe } = subscribe()
    unsubscribe()
    expect(source.closed).toBe(true)
  })
})

describe('停止', () => {
  const api = () => createHttpTrainingApi(createApiClient(TEST_BASE_URL))
  const settings = {
    ...defaultTrainingSettings(),
    datasetId: 'mock-dataset-voc2012',
    device: 'cpu',
  }

  it('応答の状態を返す(エポックの区切りまでは running)', async () => {
    const started = await api().start(validSegnetGraph(), settings)
    if (!started.ok) throw new Error(started.error.message)
    expect(await api().stop(started.value.jobId)).toEqual({ ok: true, value: 'running' })
  })

  it('ジョブがなければ 404 の説明を返す', async () => {
    expect(await api().stop('none')).toEqual({
      ok: false,
      error: { kind: 'http', status: 404, message: '指定されたジョブが見つかりません。' },
    })
  })

  it('本物の応答の形(reason つき)を読める', async () => {
    server.use(
      http.post(`${TEST_BASE_URL}/trainings/:jobId/stop`, () =>
        HttpResponse.json({ status: 'failed', reason: 'OOM' }),
      ),
    )
    expect(await api().stop('job-1')).toEqual({ ok: true, value: 'failed' })
  })
})

describe('モックの進捗', () => {
  const api = () => createHttpTrainingApi(createApiClient(TEST_BASE_URL))

  /** SSE の本文を最後まで読み、progress イベントの data を返す */
  async function readEvents(jobId: string, afterConnect?: () => Promise<unknown>) {
    const response = await fetch(`${TEST_BASE_URL}/trainings/${jobId}/progress`)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    await afterConnect?.()
    const text = await response.text()
    return text
      .split('\n\n')
      .filter((block) => block.startsWith('event: progress'))
      .map((block) =>
        trainingProcessJsonSchema.parse(JSON.parse(block.split('\n')[1]?.slice(6) ?? '')),
      )
  }

  async function startJob(modelName: string) {
    const settings = {
      ...defaultTrainingSettings(),
      modelName,
      datasetId: 'mock-dataset-voc2012',
      device: 'cpu',
    }
    const started = await api().start(validSegnetGraph(), settings)
    if (!started.ok) throw new Error(started.error.message)
    return started.value.jobId
  }

  it('epoch 0 から進み、loss が下がって completed で終わる', async () => {
    const events = await readEvents(await startJob('segnet'))
    expect(events.map((event) => [event.epoch, event.status])).toEqual([
      [0, 'running'],
      [1, 'running'],
      [2, 'completed'],
    ])
    expect(events[2]?.train_loss).toBeLessThan(events[1]?.train_loss ?? 0)
    expect(events[0]?.metrics).toBeNull()
    expect(events[1]?.metrics?.type).toBe('segmentation')
  })

  it('モデル名が mock-fail なら failed と理由を送る', async () => {
    const events = await readEvents(await startJob('mock-fail'))
    expect(events.at(-1)).toMatchObject({ status: 'failed', reason: 'CUDA out of memory' })
  })

  it('停止を要求すると stopped で終わる', async () => {
    const jobId = await startJob('segnet')
    const events = await readEvents(jobId, () => api().stop(jobId))
    expect(events.at(-1)?.status).toBe('stopped')
  })

  it('知らないジョブの進捗は 404', async () => {
    const response = await fetch(`${TEST_BASE_URL}/trainings/none/progress`)
    expect(response.status).toBe(404)
  })
})
