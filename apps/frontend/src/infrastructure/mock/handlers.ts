import { HttpResponse, http } from 'msw'

import type { components } from '../../api/schema'
import { ANNOTATION_TYPES } from '../../entity/training/data-spec'
import { API_BASE_PATH } from '../http/api-client'
import type { RustStartTrainingRequest } from '../http/rust-training-request'
import {
  rustResumeTrainingRequestSchema,
  rustStartTrainingRequestSchema,
} from '../http/rust-training-request'

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
 * 学習開始の dataset_id が登録済みのデータセット(datasets)になければ、本物と同じく 422 を返す。
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

/** モックに最初から登録されているデータセット(本物の GET /datasets と同じく、パスは持たない) */
export const MOCK_DATASETS: readonly Schemas['DatasetSummary'][] = [
  {
    dataset_id: 'mock-dataset-voc2012',
    dataset_name: 'VOC2012',
    dataset_type: 'pascal_voc',
    created_at: '2026-09-01T00:00:00Z',
  },
  {
    dataset_id: 'mock-dataset-voc-small',
    dataset_name: 'VOC2012 (小さい版)',
    dataset_type: 'pascal_voc',
    created_at: '2026-11-01T00:00:00Z',
  },
]

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
  /**
   * 起動した時点で一覧に載っている学習済みモデル(古い順)。既定は空で、学習を始めたモデルだけが載る。
   * ブラウザのモックでは MOCK_TRAINED_MODELS を渡し、一覧の表示をすぐ確かめられるようにする
   */
  readonly initialModels?: readonly MockTrainedModel[]
  /** 登録済みのデータセット。既定は MOCK_DATASETS。学習開始の dataset_id はこの中から選ぶ */
  readonly datasets?: readonly Schemas['DatasetSummary'][]
}

/** このモデル名で学習を始めると、途中で失敗する */
const FAILING_MODEL_NAME = 'mock-fail'

type MockJob = {
  readonly failing: boolean
  stopRequested: boolean
}

/**
 * モックが持つ学習済みモデル(学習済みモデルの画面用)。本物の DB と同じく、学習を始めると一覧に載る。
 * モックで始めた学習は必ず最後まで進んだものとみなし、完了エポック数は学習の epoch にする。
 * 初期データ(MOCK_TRAINED_MODELS)では、失敗・停止・再開できない などの状態も持たせる。
 */
export type MockTrainedModel = {
  readonly modelId: string
  readonly createdAt: string
  readonly config: RustStartTrainingRequest
  readonly completedEpochs: number
  readonly lastRun: Schemas['LastRunSummary']
  /** false なら、本物と同じく /models/{model_id}/config が 409 を返す(モデル構造のない古いモデル) */
  readonly resumable: boolean
}

/** 初期データの学習設定。モデル構造は一覧と設定の画面では使わないので空にしている */
function seedConfig(
  overrides: Partial<RustStartTrainingRequest> & Pick<RustStartTrainingRequest, 'model_name'>,
): RustStartTrainingRequest {
  return {
    model_graph: { nodes: [], outputs: [] },
    optimizer: {
      type: 'adam',
      learning_rate: 0.001,
      weight_decay: 0,
      beta1: 0.9,
      beta2: 0.999,
      eps: 1e-8,
    },
    loss: { type: 'cross_entropy' },
    epoch: 50,
    batch: 8,
    dataset_id: 'mock-dataset-voc2012',
    device: 'cuda:0',
    data_spec: {
      type: 'image',
      input_width: 256,
      input_height: 256,
      image_task_spec: {
        type: 'segmentation',
        ignore_index: 255,
        ignore_color_enabled: true,
        ignore_color_r: 224,
        ignore_color_g: 224,
        ignore_color_b: 192,
      },
      image_annotation_config: { type: 'pascal_voc', include_difficult: false },
    },
    save_last_every: 1,
    seed: null,
    ...overrides,
  }
}

/**
 * ブラウザのモックで最初から一覧に載せる学習済みモデル(古い順)。
 * 一覧の表示の分かれ目(状態 5 種のうち idle 以外・失敗の理由・タスク 2 種・再開できない)を一通り含む
 */
export const MOCK_TRAINED_MODELS: readonly MockTrainedModel[] = [
  {
    modelId: 'mock-seed-legacy',
    createdAt: '2026-09-01T02:00:00Z',
    config: seedConfig({ model_name: 'legacy-fcn', epoch: 20 }),
    completedEpochs: 20,
    lastRun: {
      status: 'completed',
      started_at: '2026-09-01T02:00:00Z',
      finished_at: '2026-09-01T05:12:00Z',
    },
    resumable: false,
  },
  {
    modelId: 'mock-seed-classifier',
    createdAt: '2026-10-10T01:00:00Z',
    config: seedConfig({
      model_name: 'resnet-voc-cls',
      optimizer: {
        type: 'sgd',
        learning_rate: 0.01,
        weight_decay: 0.0001,
        momentum: 0.9,
        nesterov: true,
      },
      epoch: 30,
      batch: 32,
      data_spec: {
        type: 'image',
        input_width: 224,
        input_height: 224,
        image_task_spec: { type: 'classification' },
        image_annotation_config: { type: 'pascal_voc', include_difficult: false },
      },
      seed: 42,
    }),
    completedEpochs: 30,
    lastRun: {
      status: 'completed',
      started_at: '2026-10-10T01:00:00Z',
      finished_at: '2026-10-10T09:30:00Z',
    },
    resumable: true,
  },
  {
    modelId: 'mock-seed-oom',
    createdAt: '2026-11-01T03:00:00Z',
    config: seedConfig({ model_name: 'segnet-voc-512', batch: 32 }),
    completedEpochs: 3,
    lastRun: {
      status: 'failed',
      reason: 'CUDA out of memory',
      started_at: '2026-11-01T03:00:00Z',
      finished_at: '2026-11-01T03:40:00Z',
    },
    resumable: true,
  },
  {
    modelId: 'mock-seed-stopped',
    createdAt: '2026-11-10T00:00:00Z',
    config: seedConfig({ model_name: 'segnet-voc', loss: { type: 'dice' } }),
    completedEpochs: 12,
    lastRun: {
      status: 'stopped',
      started_at: '2026-11-12T00:00:00Z',
      finished_at: '2026-11-12T02:24:00Z',
    },
    resumable: true,
  },
  {
    modelId: 'mock-seed-running',
    createdAt: '2026-11-14T00:00:00Z',
    config: seedConfig({ model_name: 'segnet-voc-long', epoch: 100 }),
    completedEpochs: 7,
    lastRun: { status: 'running', started_at: '2026-11-14T00:00:00Z', finished_at: null },
    resumable: true,
  },
]

/** モックの中で書き換える学習済みモデル(学習の開始・再開で更新する) */
type MockModel = {
  config: RustStartTrainingRequest
  createdAt: string
  completedEpochs: number
  lastRun: Schemas['LastRunSummary']
  resumable: boolean
}

/** モックで始めた学習の run。必ず最後まで進んだものとみなす */
function completedRunFromNow(): Schemas['LastRunSummary'] {
  return { status: 'completed', started_at: new Date().toISOString(), finished_at: null }
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
  // アップロードで増えるので、モックの中で書き換える一覧にする
  const datasets: Schemas['DatasetSummary'][] = [...(options.datasets ?? MOCK_DATASETS)]
  let datasetCount = 0
  const epochs = options.epochs ?? 5
  const intervalMs = options.progressIntervalMs ?? 1000
  const jobs = new Map<string, MockJob>()
  const usedModelNames = new Set(options.usedModelNames ?? [])
  // Map は入れた順を保つ。古い順に入れておき、一覧では逆順(最近学習したものが先)にする
  const models = new Map<string, MockModel>(
    (options.initialModels ?? []).map(({ modelId, ...model }) => [modelId, { ...model }]),
  )
  for (const model of models.values()) usedModelNames.add(model.config.model_name)
  let jobCount = 0
  let modelCount = 0

  /** 学習ジョブを 1 つ作る(新規学習と再開で共通) */
  const createJob = (failing: boolean): string => {
    jobCount += 1
    const jobId = `mock-job-${jobCount}`
    jobs.set(jobId, { failing, stopRequested: false })
    return jobId
  }

  return [
    http.get(`${base}/capabilities`, () => HttpResponse.json(capabilities)),

    http.get(`${base}/datasets`, () => {
      const response: Schemas['DatasetSummariesResponse'] = { datasets: [...datasets] }
      return HttpResponse.json(response)
    }),

    http.post(`${base}/datasets/upload`, async ({ request }) => {
      // 本物と同じく、file・name・type のどれかが欠けている・空なら 400(本文なし)
      const form = await request.formData().catch(() => null)
      const file = form?.get('file')
      const name = form?.get('name')
      const type = form?.get('type')
      if (
        !(file instanceof Blob) ||
        typeof name !== 'string' ||
        typeof type !== 'string' ||
        name.trim() === '' ||
        type.trim() === ''
      ) {
        return new HttpResponse(null, { status: 400 })
      }
      // 本物と同じく、知らない形式も 400
      if (!(type in ANNOTATION_TYPES)) return new HttpResponse(null, { status: 400 })
      // 解凍はしないので、フォルダ構成の確認(422)は真似しない。登録だけを真似て、一覧に載せる
      datasetCount += 1
      datasets.push({
        dataset_id: `mock-dataset-uploaded-${datasetCount}`,
        dataset_name: name,
        dataset_type: type,
        created_at: new Date().toISOString(),
      })
      return new HttpResponse(null, { status: 201 })
    }),

    http.post(`${base}/trainings/validate`, async ({ request }) => {
      const parsed = rustStartTrainingRequestSchema.safeParse(await request.json())
      if (!parsed.success) return new HttpResponse(null, { status: 422 })
      // 本物と同じく、整合性チェックでも登録されていないデータセットは原因のコード付きの 422 にする
      if (!datasets.some((dataset) => dataset.dataset_id === parsed.data.dataset_id)) {
        return HttpResponse.json({ error: 'dataset_not_found' }, { status: 422 })
      }
      if (usedModelNames.has(parsed.data.model_name)) return new HttpResponse(null, { status: 409 })
      return new HttpResponse(null, { status: 204 })
    }),

    http.post(`${base}/trainings`, async ({ request }) => {
      if (options.alreadyRunning === true) return new HttpResponse(null, { status: 409 })
      const parsed = rustStartTrainingRequestSchema.safeParse(await request.json())
      if (!parsed.success) return new HttpResponse(null, { status: 422 })
      // 本物と同じく、登録されていないデータセットは原因のコード付きの 422 にする
      if (!datasets.some((dataset) => dataset.dataset_id === parsed.data.dataset_id)) {
        return HttpResponse.json({ error: 'dataset_not_found' }, { status: 422 })
      }
      usedModelNames.add(parsed.data.model_name)
      const response: Schemas['StartTrainingResponse'] = {
        job_id: createJob(parsed.data.model_name === FAILING_MODEL_NAME),
      }
      modelCount += 1
      const run = completedRunFromNow()
      models.set(`mock-model-${modelCount}`, {
        config: parsed.data,
        createdAt: run.started_at,
        completedEpochs: parsed.data.epoch,
        lastRun: run,
        resumable: true,
      })
      return HttpResponse.json(response)
    }),

    http.get(`${base}/models`, () => {
      const response: Schemas['ModelSummariesResponse'] = {
        // 最近学習したモデルが先(本物と同じ並び)
        models: [...models.entries()].reverse().map(([modelId, model]) => ({
          model_id: modelId,
          model_name: model.config.model_name,
          created_at: model.createdAt,
          task_type: model.config.data_spec.image_task_spec.type,
          last_run: model.lastRun,
          completed_epochs: model.completedEpochs,
          resumable: model.resumable,
        })),
      }
      return HttpResponse.json(response)
    }),

    http.get<{ modelId: string }>(`${base}/models/:modelId/config`, ({ params }) => {
      const model = models.get(params.modelId)
      if (model === undefined) return new HttpResponse(null, { status: 404 })
      // モデル構造のない古いモデルは、本物と同じく設定を返せない
      if (!model.resumable) return new HttpResponse(null, { status: 409 })
      // 本物と同じく、データセットは返さず、seed を固定していなくても null で返す
      const { dataset_id: _datasetId, ...config } = model.config
      const response: Schemas['ModelTrainingConfig'] = {
        model_id: params.modelId,
        ...config,
        seed: config.seed ?? null,
      }
      return HttpResponse.json(response)
    }),

    http.post<{ modelId: string }>(
      `${base}/models/:modelId/resume`,
      async ({ params, request }) => {
        const model = models.get(params.modelId)
        if (model === undefined) return new HttpResponse(null, { status: 404 })
        if (options.alreadyRunning === true) return new HttpResponse(null, { status: 409 })
        const parsed = rustResumeTrainingRequestSchema.safeParse(await request.json())
        if (!parsed.success) return new HttpResponse(null, { status: 422 })
        // 本物と同じ規則: optimizer の種類は変えられない、epoch は完了済みより大きくする
        if (parsed.data.optimizer.type !== model.config.optimizer.type) {
          return new HttpResponse(null, { status: 422 })
        }
        if (parsed.data.epoch <= model.completedEpochs)
          return new HttpResponse(null, { status: 409 })

        model.config = { ...model.config, ...parsed.data }
        model.completedEpochs = parsed.data.epoch
        model.lastRun = completedRunFromNow()
        // 再開した run は一覧の先頭に来る
        models.delete(params.modelId)
        models.set(params.modelId, model)
        const response: Schemas['StartTrainingResponse'] = {
          job_id: createJob(model.config.model_name === FAILING_MODEL_NAME),
        }
        return HttpResponse.json(response)
      },
    ),

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
