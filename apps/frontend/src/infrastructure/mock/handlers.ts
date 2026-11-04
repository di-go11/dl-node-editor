import { HttpResponse, http } from 'msw'

import type { components } from '../../api/schema'
import { API_BASE_PATH } from '../http/api-client'
import { rustStartTrainingRequestSchema } from '../http/rust-training-request'

/**
 * MSW(Mock Service Worker)のリクエストハンドラ - モック API(指示書 6.3)。
 *
 * MSW は、ブラウザでは Service Worker、Node(テスト)ではリクエストの横取りによって、
 * fetch が実際にネットワークへ出る手前で応答を差し込む。アプリのコードから見ると
 * 本物の API と区別がつかないので、本物につなぎ替えるときにアプリ側を変えずに済む。
 * 同じハンドラをブラウザ(browser.ts)とテスト(server.ts)の両方で使う。
 *
 * 応答には生成型(components['schemas'])で型を付けている。モックが契約からずれると
 * tsc が教えてくれるので、「モックでは動くのに本物では動かない」を防げる。
 *
 * ## リクエストも検証する
 *
 * 受け取った JSON は、Rust の DTO と同じ形の Zod スキーマで確かめ、形が違えば
 * 本物と同じく 422 を返す。モックが何でも受け付けると、送る JSON の誤りに
 * 本物につないだ瞬間まで気づけないためである。
 *
 * ## 進捗(SSE)
 *
 * 一定の間隔でエポックを進め、loss が少しずつ下がるイベントを流し、最後に completed を送る。
 * モデル名を mock-fail にして学習を始めると、途中で failed になる(失敗の表示の確認用)。
 */

type Schemas = components['schemas']

/** モックが返す既定のデバイス一覧(CPU と GPU 1 枚) */
export const MOCK_CAPABILITIES: Schemas['CapabilitiesResponse'] = {
  devices: [
    { id: 'cpu', name: 'cpu' },
    { id: 'cuda:0', name: 'cuda:0' },
  ],
}

export type MockOptions = {
  /**
   * ベース URL。ブラウザでは相対パス(既定値)、テストでは絶対 URL を渡す
   * (Node には「今のページ」がないため、相対パスを解決できない)。
   */
  readonly baseUrl?: string
  readonly capabilities?: Schemas['CapabilitiesResponse']
  /** true なら、学習が実行中のときと同じく、学習開始に 409 を返す */
  readonly alreadyRunning?: boolean
  /**
   * すでに使われているモデル名。整合性チェック(/trainings/validate)はこの名前に 409 を返す。
   * モックで学習を始めたモデル名も、本物の DB と同じく使用済みになる
   */
  readonly usedModelNames?: readonly string[]
  /** 進捗のイベントの間隔(ミリ秒) */
  readonly progressIntervalMs?: number
  /** 学習が完了するまでのエポック数 */
  readonly epochs?: number
}

/** このモデル名で学習を始めると、途中で失敗する */
const FAILING_MODEL_NAME = 'mock-fail'

type MockJob = {
  readonly failing: boolean
  stopRequested: boolean
}

/** 学習の経過を模した進捗の 1 件。epoch 0 はまだ何も終わっていない状態である */
function mockProcess(epoch: number, status: Schemas['TrainingStatus']): Schemas['TrainingProcess'] {
  const loss = 1 / (epoch + 1)
  return {
    epoch,
    train_loss: loss,
    val_loss: loss * 1.1,
    status,
    metrics:
      epoch === 0
        ? null
        : {
            type: 'segmentation',
            pixel_accuracy: 1 - loss / 2,
            miou: 1 - loss,
            fw_iou: 1 - loss / 2,
            mean_class_accuracy: 1 - loss,
            per_class_iou: [1 - loss / 2, 1 - loss],
          },
    epoch_elapsed_ms: epoch === 0 ? 0 : 1000,
    total_elapsed_ms: epoch * 1000,
  }
}

/** 次のイベントを決める。status が終端なら、それが最後のイベントになる */
function nextMockProcess(job: MockJob, epoch: number, epochs: number): Schemas['TrainingProcess'] {
  if (job.stopRequested) return mockProcess(epoch, 'stopped')
  if (job.failing && epoch + 1 >= 2) {
    return { ...mockProcess(epoch, 'failed'), reason: 'CUDA out of memory' }
  }
  return mockProcess(epoch + 1, epoch + 1 >= epochs ? 'completed' : 'running')
}

/** 進捗を SSE の本文として流す。接続が切られたら止める */
function progressStream(job: MockJob, epochs: number, intervalMs: number) {
  const encoder = new TextEncoder()
  const encode = (process: Schemas['TrainingProcess']) =>
    encoder.encode(`event: progress\ndata: ${JSON.stringify(process)}\n\n`)
  let timer: ReturnType<typeof setInterval> | undefined

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let current = mockProcess(0, 'running')
      controller.enqueue(encode(current))
      timer = setInterval(() => {
        current = nextMockProcess(job, current.epoch, epochs)
        controller.enqueue(encode(current))
        if (current.status !== 'running') {
          clearInterval(timer)
          controller.close()
        }
      }, intervalMs)
    },
    cancel() {
      clearInterval(timer)
    },
  })
}

export function createHandlers(options: MockOptions = {}) {
  const base = options.baseUrl ?? API_BASE_PATH
  const capabilities = options.capabilities ?? MOCK_CAPABILITIES
  const epochs = options.epochs ?? 5
  const intervalMs = options.progressIntervalMs ?? 1000
  const jobs = new Map<string, MockJob>()
  const usedModelNames = new Set(options.usedModelNames ?? [])
  let jobCount = 0

  return [
    http.get(`${base}/capabilities`, () => HttpResponse.json(capabilities)),

    http.post(`${base}/trainings/validate`, async ({ request }) => {
      const parsed = rustStartTrainingRequestSchema.safeParse(await request.json())
      if (!parsed.success) return new HttpResponse(null, { status: 422 })
      if (usedModelNames.has(parsed.data.model_name)) return new HttpResponse(null, { status: 409 })
      return new HttpResponse(null, { status: 204 })
    }),

    http.post(`${base}/trainings`, async ({ request }) => {
      if (options.alreadyRunning === true) return new HttpResponse(null, { status: 409 })
      const parsed = rustStartTrainingRequestSchema.safeParse(await request.json())
      if (!parsed.success) return new HttpResponse(null, { status: 422 })
      usedModelNames.add(parsed.data.model_name)
      jobCount += 1
      const response: Schemas['StartTrainingResponse'] = { job_id: `mock-job-${jobCount}` }
      jobs.set(response.job_id, {
        failing: parsed.data.model_name === FAILING_MODEL_NAME,
        stopRequested: false,
      })
      return HttpResponse.json(response)
    }),

    http.get<{ jobId: string }>(`${base}/trainings/:jobId/progress`, ({ params }) => {
      const job = jobs.get(params.jobId)
      if (job === undefined) return new HttpResponse(null, { status: 404 })
      return new HttpResponse(progressStream(job, epochs, intervalMs), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }),

    http.post<{ jobId: string }>(`${base}/trainings/:jobId/stop`, ({ params }) => {
      const job = jobs.get(params.jobId)
      if (job === undefined) return new HttpResponse(null, { status: 404 })
      job.stopRequested = true
      // 停止はエポックの区切りで行われるので、この時点ではまだ running である
      const response: Schemas['TrainingStatusResponse'] = { status: 'running' }
      return HttpResponse.json(response)
    }),
  ]
}
