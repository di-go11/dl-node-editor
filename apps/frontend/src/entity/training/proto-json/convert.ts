import type { ModelGraph } from '../../model-graph/model-graph'
import { fromProtoJson, toProtoJson } from '../../model-graph/proto-json/convert'
import type { DataSpec } from '../data-spec'
import { ANNOTATION_TYPES, IMAGE_TASK_TYPES } from '../data-spec'
import { LOSS_TYPES } from '../loss'
import { OPTIMIZER_TYPES } from '../optimizer'
import type { TrainingSettings } from '../training-settings'
import type { Variant, VariantCatalog } from '../variant'
import { isVariantKind } from '../variant'

import type {
  DataSpecJson,
  StartTrainingRequestJson,
  TrainingSettingsJson,
  VariantJson,
} from './schema'

/**
 * 学習設定の、JSON 表記 ⇄ エンティティの型 の双方向変換。
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
