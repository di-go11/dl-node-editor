import type { ModelGraph } from '../../model-graph/model-graph'
import { fromProtoJson, toProtoJson } from '../../model-graph/proto-json/convert'
import type { DataSpec } from '../data-spec'
import { ANNOTATION_TYPES, IMAGE_TASK_TYPES } from '../data-spec'
import { LOSS_TYPES } from '../loss'
import { OPTIMIZER_TYPES } from '../optimizer'
import type { ProgressMetrics, TrainingProgress, TrainingStatus } from '../progress'
import type { TrainingSettings } from '../training-settings'
import type { Variant, VariantCatalog } from '../variant'
import { isVariantKind } from '../variant'

import type {
  DataSpecJson,
  ProgressMetricsJson,
  StartTrainingRequestJson,
  StreamProgressJson,
  TrainingSettingsJson,
  TrainingStatusJson,
  VariantJson,
} from './schema'

/**
 * 学習設定と進捗の、JSON 表記 ⇄ エンティティの型 の双方向変換。
 *
 * 入力側(*FromJson)には **schema.ts のスキーマを通した値を渡すこと。**
 * 1a の model-graph/proto-json/convert.ts と同じく、検証済みを前提にしているので、
 * 形が崩れていれば例外になる(プログラムの誤りとして扱う)。外部入力はまず safeParse する。
 *
 * 出力側(*ToJson)のキーの並びは、proto のフィールド番号順にしている。
 * JSON のキーの順序に意味はないが、test_segnet_dag.json と並べて目で比べやすくなる。
 */

// ------------------------------------------------------------
// バリアント(oneof)
// ------------------------------------------------------------

function variantFromJson<K extends string>(
  catalog: VariantCatalog<K>,
  json: VariantJson,
): Variant<K> {
  const entries = Object.entries(json)
  const entry = entries[0]
  if (entries.length !== 1 || entry === undefined) {
    throw new Error('oneof は種類をちょうど 1 つだけ持つ必要があります')
  }
  const [kind, params] = entry
  if (!isVariantKind(catalog, kind)) {
    throw new Error(`知らない種類です: ${kind}`)
  }
  return { kind, params: { ...params } }
}

function variantToJson(variant: Variant): VariantJson {
  // 種類名をキーにしたオブジェクト 1 つにする(proto の oneof の JSON 表記)
  return { [variant.kind]: { ...variant.params } }
}

// ------------------------------------------------------------
// data_spec
// ------------------------------------------------------------

function dataSpecFromJson(json: DataSpecJson): DataSpec {
  const image = json.image
  return {
    kind: 'image',
    annotation: variantFromJson(ANNOTATION_TYPES, image.annotation),
    inputWidth: image.input_width,
    inputHeight: image.input_height,
    task: variantFromJson(IMAGE_TASK_TYPES, image.task_specs),
  }
}

function dataSpecToJson(spec: DataSpec): DataSpecJson {
  // DataSpec の種類が増えたら、ここの switch が網羅性の検査で知らせてくれる
  switch (spec.kind) {
    case 'image':
      return {
        image: {
          annotation: variantToJson(spec.annotation),
          input_width: spec.inputWidth,
          input_height: spec.inputHeight,
          task_specs: variantToJson(spec.task),
        },
      }
  }
}

// ------------------------------------------------------------
// 学習設定
// ------------------------------------------------------------

export function trainingSettingsFromJson(json: TrainingSettingsJson): TrainingSettings {
  return {
    modelName: json.model_name,
    optimizer: variantFromJson(OPTIMIZER_TYPES, json.optimizer),
    loss: variantFromJson(LOSS_TYPES, json.loss),
    epoch: json.epoch,
    batch: json.batch,
    datasetPath: json.dataset_path,
    device: json.device,
    dataSpec: dataSpecFromJson(json.data_spec),
    saveLastEvery: json.save_last_every,
    resumeFrom: json.resume_from,
    // seed のキーがない = 乱数を固定しない。{ "value": 0 } は「0 に固定する」で別の意味
    seed: json.seed === undefined ? null : json.seed.value,
  }
}

export function trainingSettingsToJson(settings: TrainingSettings): TrainingSettingsJson {
  const json: TrainingSettingsJson = {
    model_name: settings.modelName,
    optimizer: variantToJson(settings.optimizer),
    loss: variantToJson(settings.loss),
    epoch: settings.epoch,
    batch: settings.batch,
    dataset_path: settings.datasetPath,
    device: settings.device,
    data_spec: dataSpecToJson(settings.dataSpec),
    save_last_every: settings.saveLastEvery,
    resume_from: settings.resumeFrom,
  }
  // 固定しないときは、キーごと省く(契約の Seed の説明のとおり)。
  // { "seed": null } にすると、Rust 側で「null の Seed」という余計な場合が増える。
  return settings.seed === null ? json : { ...json, seed: { value: settings.seed } }
}

/**
 * 学習開始のリクエスト全体を組み立てる。
 *
 * モデル構造(エディタの状態)と学習設定(学習設定画面の状態)は別々に持ち、
 * 合わせるのは送る直前のここだけにする。
 */
export function toStartTrainingRequestJson(
  graph: ModelGraph,
  settings: TrainingSettings,
): StartTrainingRequestJson {
  const { model_name, ...rest } = trainingSettingsToJson(settings)
  // proto のフィールド番号順(model_name = 1, model_graph = 2, ...)に並べる
  return { model_name, model_graph: toProtoJson(graph), ...rest }
}

/** 学習開始のリクエスト(test_segnet_dag.json の形)を、モデル構造と学習設定に分ける */
export function fromStartTrainingRequestJson(json: StartTrainingRequestJson): {
  readonly graph: ModelGraph
  readonly settings: TrainingSettings
} {
  const { model_graph, ...settingsJson } = json
  return {
    graph: fromProtoJson(model_graph),
    settings: trainingSettingsFromJson(settingsJson),
  }
}

// ------------------------------------------------------------
// 進捗
// ------------------------------------------------------------

/**
 * エンティティの状態名 → proto の enum 名。
 * Record<TrainingStatus, ...> にしているので、状態を増やして書き忘れると型エラーになる。
 */
const STATUS_TO_JSON: Readonly<Record<TrainingStatus, TrainingStatusJson>> = {
  unspecified: 'TRAINING_STATUS_UNSPECIFIED',
  idle: 'TRAINING_STATUS_IDLE',
  running: 'TRAINING_STATUS_RUNNING',
  completed: 'TRAINING_STATUS_COMPLETED',
  failed: 'TRAINING_STATUS_FAILED',
  stopped: 'TRAINING_STATUS_STOPPED',
}

/** 逆向きの対応。上の表から作るので、2 つの表がずれることはない */
const STATUS_FROM_JSON: ReadonlyMap<TrainingStatusJson, TrainingStatus> = new Map(
  Object.entries(STATUS_TO_JSON).map(([status, json]) => [json, status as TrainingStatus]),
)

export function trainingStatusFromJson(json: TrainingStatusJson): TrainingStatus {
  const status = STATUS_FROM_JSON.get(json)
  if (status === undefined) throw new Error(`知らない学習の状態です: ${json}`)
  return status
}

export function trainingStatusToJson(status: TrainingStatus): TrainingStatusJson {
  return STATUS_TO_JSON[status]
}

function metricsFromJson(json: ProgressMetricsJson): ProgressMetrics {
  if ('segmentation' in json) {
    const m = json.segmentation
    return {
      kind: 'segmentation',
      pixelAcc: m.pixel_acc,
      miou: m.miou,
      fwIou: m.fw_iou,
      meanClassAccuracy: m.mean_class_accuracy,
      perClassIou: [...m.per_class_iou],
    }
  }
  const m = json.classification
  return {
    kind: 'classification',
    accuracy: m.accuracy,
    macroF1: m.macro_f1,
    perClassAccuracy: [...m.per_class_accuracy],
  }
}

function metricsToJson(metrics: ProgressMetrics): ProgressMetricsJson {
  switch (metrics.kind) {
    case 'segmentation':
      return {
        segmentation: {
          pixel_acc: metrics.pixelAcc,
          miou: metrics.miou,
          fw_iou: metrics.fwIou,
          mean_class_accuracy: metrics.meanClassAccuracy,
          per_class_iou: [...metrics.perClassIou],
        },
      }
    case 'classification':
      return {
        classification: {
          accuracy: metrics.accuracy,
          macro_f1: metrics.macroF1,
          per_class_accuracy: [...metrics.perClassAccuracy],
        },
      }
  }
}

export function progressFromJson(json: StreamProgressJson): TrainingProgress {
  return {
    epoch: json.epoch,
    trainLoss: json.train_loss,
    valLoss: json.val_loss,
    status: trainingStatusFromJson(json.status),
    metrics: json.metrics === undefined ? null : metricsFromJson(json.metrics),
    epochElapsedMs: json.epoch_elapsed_ms,
    totalElapsedMs: json.total_elapsed_ms,
    // proto の「空文字 = なし」を null にそろえる(progress.ts の説明を参照)
    errorMessage:
      json.error_message === undefined || json.error_message === '' ? null : json.error_message,
  }
}

/**
 * 進捗を JSON 表記にする。フロント自身は進捗を送らないが、
 * MSW のモック(infrastructure/mock)が契約どおりのイベントを作るのに使う。
 */
export function progressToJson(progress: TrainingProgress): StreamProgressJson {
  const json: StreamProgressJson = {
    epoch: progress.epoch,
    train_loss: progress.trainLoss,
    val_loss: progress.valLoss,
    status: trainingStatusToJson(progress.status),
    epoch_elapsed_ms: progress.epochElapsedMs,
    total_elapsed_ms: progress.totalElapsedMs,
  }
  return {
    ...json,
    ...(progress.metrics === null ? {} : { metrics: metricsToJson(progress.metrics) }),
    ...(progress.errorMessage === null ? {} : { error_message: progress.errorMessage }),
  }
}
