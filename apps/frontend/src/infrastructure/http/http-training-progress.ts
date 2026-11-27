import { z } from 'zod'

import type { ProgressListener } from '../../application/ports/training-api'
import type { ProgressMetrics, TrainingProgress } from '../../entity/training/progress'
import { isTerminalStatus } from '../../entity/training/progress'

/**
 * 学習の進捗の HTTP 表記(Rust の TrainingProcessDto)と、SSE の受信。
 *
 * ## SSE(Server-Sent Events)
 *
 * サーバーから送り続けられるイベントを、1 本の HTTP 接続で受け取る仕組みである。
 * openapi-fetch は扱えないので、ブラウザの EventSource を使う。
 *
 * Rust はイベントに `progress` と `error` の名前を付けて送る。名前付きのイベントは
 * onmessage には届かないので、addEventListener で受ける。
 *
 * ## error が 2 つの意味を持つこと
 *
 * Rust が送る error イベントと、接続の問題でブラウザが発火する error は、同じリスナーに届く。
 * 前者は MessageEvent で data を持ち、後者は data を持たないので、これで見分ける。
 * 接続の問題のとき、readyState が CLOSED ならブラウザは再接続しない
 * (ジョブがない 404 や、学習エンジンに届かない 502 など)。それ以外なら自動で再接続する。
 */

export const trainingStatusJsonSchema = z.enum([
  'idle',
  'running',
  'completed',
  'failed',
  'stopped',
])

export const trainingStatusResponseSchema = z.object({
  status: trainingStatusJsonSchema,
  reason: z.string().optional(),
})

/**
 * メトリクスの値は NaN や inf のとき null で届く(Rust の f64 を serde_json が null で書く)。
 * 検証データに現れないクラスの IoU は NaN なので、null を許さないと進捗や記録の全体が読めなくなる。
 */
const metricValueSchema = z.number().nullable()

export const metricsJsonSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('segmentation'),
    pixel_accuracy: metricValueSchema,
    miou: metricValueSchema,
    fw_iou: metricValueSchema,
    mean_class_accuracy: metricValueSchema,
    per_class_iou: z.array(metricValueSchema),
  }),
  z.object({
    type: z.literal('classification'),
    accuracy: metricValueSchema,
    macro_f1: metricValueSchema,
    per_class_accuracy: z.array(metricValueSchema),
  }),
])

export const trainingProcessJsonSchema = z.object({
  epoch: z.number(),
  // NaN や inf は JSON で null になる
  train_loss: z.number().nullable(),
  val_loss: z.number().nullable(),
  status: trainingStatusJsonSchema,
  reason: z.string().optional(),
  metrics: metricsJsonSchema.nullable(),
  epoch_elapsed_ms: z.number(),
  total_elapsed_ms: z.number(),
  // 学習率を送らない古いサーバーではキーがない。まだ 1 エポックも終わっていなければ null
  learning_rate: z.number().nullable().optional(),
})

export type TrainingProcessJson = z.infer<typeof trainingProcessJsonSchema>

export function metricsFromJson(json: z.infer<typeof metricsJsonSchema>): ProgressMetrics {
  switch (json.type) {
    case 'segmentation':
      return {
        kind: 'segmentation',
        pixelAcc: json.pixel_accuracy,
        miou: json.miou,
        fwIou: json.fw_iou,
        meanClassAccuracy: json.mean_class_accuracy,
        perClassIou: json.per_class_iou,
      }
    case 'classification':
      return {
        kind: 'classification',
        accuracy: json.accuracy,
        macroF1: json.macro_f1,
        perClassAccuracy: json.per_class_accuracy,
      }
  }
}

export function progressFromJson(json: TrainingProcessJson): TrainingProgress {
  return {
    epoch: json.epoch,
    trainLoss: json.train_loss,
    valLoss: json.val_loss,
    status: json.status,
    metrics: json.metrics === null ? null : metricsFromJson(json.metrics),
    epochElapsedMs: json.epoch_elapsed_ms,
    totalElapsedMs: json.total_elapsed_ms,
    errorMessage: json.reason ?? null,
    learningRate: json.learning_rate ?? null,
  }
}

function parseProgress(data: unknown): TrainingProgress | null {
  if (typeof data !== 'string') return null
  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    return null
  }
  const parsed = trainingProcessJsonSchema.safeParse(json)
  return parsed.success ? progressFromJson(parsed.data) : null
}

/** EventSource のうち、ここで使う部分。テストでは偽物を渡す */
export type ProgressEventSource = {
  readonly readyState: number
  addEventListener(type: string, listener: (event: Event) => void): void
  close(): void
}

/** EventSource.CLOSED の値 */
const READY_STATE_CLOSED = 2

const dataOf = (event: Event): unknown => ('data' in event ? event.data : undefined)

/** EventSource にリスナーを付け、受信をやめるための関数を返す */
export function listenTrainingProgress(
  source: ProgressEventSource,
  listener: ProgressListener,
): () => void {
  source.addEventListener('progress', (event) => {
    const progress = parseProgress(dataOf(event))
    if (progress === null) {
      source.close()
      listener.onProblem({
        message: 'サーバーの進捗の形が契約と合わないので、受信をやめました。',
        retrying: false,
      })
      return
    }
    // 閉じないと、ブラウザが自動で再接続し、最終状態の受信を繰り返す
    if (isTerminalStatus(progress.status)) source.close()
    listener.onProgress(progress)
  })

  source.addEventListener('error', (event) => {
    const data = dataOf(event)
    if (typeof data === 'string') {
      listener.onProblem({ message: `学習サーバーのエラー: ${data}`, retrying: true })
    } else if (source.readyState === READY_STATE_CLOSED) {
      listener.onProblem({
        message: '進捗を受信できません(ジョブがないか、学習サーバーに接続できません)。',
        retrying: false,
      })
    } else {
      listener.onProblem({ message: '接続が切れました。再接続しています…', retrying: true })
    }
  })

  return () => {
    source.close()
  }
}
