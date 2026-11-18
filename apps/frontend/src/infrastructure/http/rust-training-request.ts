import { z } from 'zod'

import type { NodeSpecJson } from '../../entity/model-graph/proto-json/schema'
import {
  trainingSettingsFromJson,
  trainingSettingsToJson,
} from '../../entity/training/proto-json/convert'
import type { StartTrainingRequestJson, VariantJson } from '../../entity/training/proto-json/schema'
import { trainingSettingsJsonSchema } from '../../entity/training/proto-json/schema'
import type { TrainingSettings } from '../../entity/training/training-settings'

/**
 * 学習開始リクエストの、Rust の HTTP API 向けの形(スキーマと変換)。
 *
 * ## なぜエンティティ層の proto-json と別に持つのか
 *
 * proto-json は C++ の設定ファイルと保存ファイルの形であり、種類の選択は
 * `{ "adam": { ... } }`、enum は `ACTIVATION_TYPE_RELU` と書く。一方 Rust の DTO は
 * `{ "type": "adam", ... }`、`relu` と書く。Rust の形は HTTP でしか現れないので、
 * capabilities の応答と同じ基準で infrastructure 層に置く。
 *
 * ## 変換の結果をスキーマに通す理由
 *
 * proto-json のパラメータは「名前 → 値」の袋で、型からは中身が分からない。そこで変換の後に
 * このスキーマで確かめる。Rust に対応する値がないもの(`*_UNSPECIFIED` や object_detection)は、
 * 送って 422 を受け取る前に、ここで理由つきの失敗になる。
 *
 * 生成型(src/api/schema.d.ts)とのキーの一致は src/api/*.contract.test.ts で検査している。
 */

const integer = z.number().int()
const nonNegativeInteger = integer.nonnegative()

const windowParams = { kernel_size: integer, stride: integer, padding: integer }

export const rustNodeSpecSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('conv2d'),
    in_channels: integer,
    out_channels: integer,
    kernel_size: integer,
    stride: integer,
    padding: integer,
    dilation: integer,
  }),
  z.object({
    type: z.literal('pooling2d'),
    pooling_type: z.enum(['max', 'average']),
    ...windowParams,
  }),
  z.object({
    type: z.literal('batch_norm'),
    num_features: integer,
    eps: z.number(),
    momentum: z.number(),
  }),
  z.object({
    type: z.literal('linear'),
    in_features: integer,
    out_features: integer,
    bias: z.boolean(),
  }),
  z.object({
    type: z.literal('activation'),
    activation_type: z.enum(['relu', 'sigmoid', 'softmax', 'tanh']),
    dim: integer,
  }),
  z.object({ type: z.literal('indexed_pooling'), ...windowParams }),
  z.object({ type: z.literal('unpooling'), ...windowParams }),
  z.object({
    type: z.literal('upsample'),
    upsample_mode: z.enum(['nearest', 'bilinear']),
    scale_factor: integer,
  }),
  z.object({ type: z.literal('add'), alpha: z.number() }),
  z.object({ type: z.literal('concat') }),
])

export const rustPortRefSchema = z.object({
  node_id: z.string(),
  port: z.string(),
})

export const rustNodeInputSchema = z.object({
  port: z.string(),
  // null はグラフ入力(画像)を意味する
  source: rustPortRefSchema.nullable(),
})

export const rustNodeSchema = z.object({
  id: z.string(),
  spec: rustNodeSpecSchema,
  inputs: z.array(rustNodeInputSchema),
})

export const rustModelGraphSchema = z.object({
  nodes: z.array(rustNodeSchema),
  outputs: z.array(rustPortRefSchema),
})

const rustOptimizerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('adam'),
    learning_rate: z.number(),
    weight_decay: z.number(),
    beta1: z.number(),
    beta2: z.number(),
    eps: z.number(),
  }),
  z.object({
    type: z.literal('adam_w'),
    learning_rate: z.number(),
    weight_decay: z.number(),
    beta1: z.number(),
    beta2: z.number(),
  }),
  z.object({
    type: z.literal('sgd'),
    learning_rate: z.number(),
    weight_decay: z.number(),
    momentum: z.number(),
    nesterov: z.boolean(),
  }),
])

const rustLossSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cross_entropy') }),
  z.object({ type: z.literal('mse') }),
  z.object({ type: z.literal('dice') }),
  z.object({ type: z.literal('focal'), gamma: z.number(), alpha: z.number() }),
  z.object({ type: z.literal('combo'), alpha: z.number() }),
  z.object({ type: z.literal('boundary') }),
])

export const rustDataSpecSchema = z.object({
  type: z.literal('image'),
  input_width: nonNegativeInteger,
  input_height: nonNegativeInteger,
  image_task_spec: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('segmentation'),
      ignore_index: nonNegativeInteger,
      ignore_color_enabled: z.boolean(),
      ignore_color_r: nonNegativeInteger,
      ignore_color_g: nonNegativeInteger,
      ignore_color_b: nonNegativeInteger,
    }),
    z.object({ type: z.literal('classification') }),
  ]),
  image_annotation_config: z.discriminatedUnion('type', [
    z.object({ type: z.literal('pascal_voc'), include_difficult: z.boolean() }),
    z.object({ type: z.literal('original') }),
  ]),
})

export const rustStartTrainingRequestSchema = z.object({
  model_name: z.string(),
  model_graph: rustModelGraphSchema,
  optimizer: rustOptimizerSchema,
  loss: rustLossSchema,
  epoch: nonNegativeInteger,
  batch: nonNegativeInteger,
  // 登録済みデータセットの ID。未選択(空文字)では送らない(サーバーも 422 を返す)
  dataset_id: z.string().min(1),
  device: z.string(),
  data_spec: rustDataSpecSchema,
  save_last_every: nonNegativeInteger,
  seed: nonNegativeInteger.nullable().optional(),
})

export type RustNodeSpec = z.infer<typeof rustNodeSpecSchema>
export type RustPortRef = z.infer<typeof rustPortRefSchema>
export type RustNodeInput = z.infer<typeof rustNodeInputSchema>
export type RustNode = z.infer<typeof rustNodeSchema>
export type RustModelGraph = z.infer<typeof rustModelGraphSchema>
export type RustDataSpec = z.infer<typeof rustDataSpecSchema>
export type RustStartTrainingRequest = z.infer<typeof rustStartTrainingRequestSchema>

/** パラメータ名 → proto の enum 名の接頭辞。残りを小文字にすると Rust の値になる */
const ENUM_PREFIXES: Readonly<Record<string, string>> = {
  activation_type: 'ACTIVATION_TYPE_',
  pooling_type: 'POOLING_TYPE_',
  upsample_mode: 'UPSAMPLE_MODE_',
}

/** `{ "種類": { ...パラメータ } }` を `{ "type": "種類", ...パラメータ }` にする */
function tagged(json: VariantJson): Record<string, unknown> {
  const [type, params] = Object.entries(json)[0] ?? []
  return { type, ...params }
}

/** スキーマを通す前の、層の種類とパラメータの変換(enum の名前も短くする) */
export function toRustNodeSpec(spec: NodeSpecJson): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(tagged(spec)).map(([key, value]) => {
      const prefix = ENUM_PREFIXES[key]
      return prefix !== undefined && typeof value === 'string' && value.startsWith(prefix)
        ? [key, value.slice(prefix.length).toLowerCase()]
        : [key, value]
    }),
  )
}

export type RustRequestConversion =
  | { readonly ok: true; readonly value: RustStartTrainingRequest }
  | { readonly ok: false; readonly message: string }

/** proto-json の学習開始リクエストを、Rust の HTTP API が受け取る形にする */
export function toRustStartTrainingRequest(json: StartTrainingRequestJson): RustRequestConversion {
  const { annotation, task_specs, input_width, input_height } = json.data_spec.image
  const parsed = rustStartTrainingRequestSchema.safeParse({
    model_name: json.model_name,
    model_graph: {
      nodes: json.model_graph.nodes.map((node) => ({
        id: node.id,
        spec: toRustNodeSpec(node.spec),
        inputs: node.inputs.map((input) => ({
          port: input.port,
          // proto-json は常に {} で書き出すが、読み込んだ JSON の "" も同じくグラフ入力である
          source:
            input.source.node_id === undefined || input.source.node_id === ''
              ? null
              : { node_id: input.source.node_id, port: input.source.port ?? '' },
        })),
      })),
      outputs: json.model_graph.outputs,
    },
    optimizer: tagged(json.optimizer),
    loss: tagged(json.loss),
    epoch: json.epoch,
    batch: json.batch,
    dataset_id: json.dataset_id,
    device: json.device,
    data_spec: {
      type: 'image',
      input_width,
      input_height,
      image_task_spec: tagged(task_specs),
      image_annotation_config: tagged(annotation),
    },
    save_last_every: json.save_last_every,
    // 固定しないときは、キーごと省く
    ...(json.seed === undefined ? {} : { seed: json.seed.value }),
  })
  if (parsed.success) return { ok: true, value: parsed.data }
  const first = parsed.error.issues[0]
  const where = first === undefined ? '' : first.path.join('.')
  return { ok: false, message: `学習開始のリクエストを作れませんでした(${where})。` }
}

// ------------------------------------------------------------
// 学習再開(/models 以下)
// ------------------------------------------------------------

/**
 * 学習再開のリクエスト(POST /models/{model_id}/resume)。再開時に変えてよい項目だけを持つ。
 * 固定項目(model_name / model_graph / data_spec / seed / データセット)はサーバーが前回の設定を使うので送らない。
 */
export const rustResumeTrainingRequestSchema = rustStartTrainingRequestSchema.pick({
  optimizer: true,
  loss: true,
  epoch: true,
  batch: true,
  device: true,
  save_last_every: true,
})

export type RustResumeTrainingRequest = z.infer<typeof rustResumeTrainingRequestSchema>

export type RustResumeRequestConversion =
  | { readonly ok: true; readonly value: RustResumeTrainingRequest }
  | { readonly ok: false; readonly message: string }

/** 学習設定から、再開で変えてよい項目だけを Rust の HTTP API の形にする */
export function toRustResumeTrainingRequest(
  settings: TrainingSettings,
): RustResumeRequestConversion {
  const json = trainingSettingsToJson(settings)
  const parsed = rustResumeTrainingRequestSchema.safeParse({
    optimizer: tagged(json.optimizer),
    loss: tagged(json.loss),
    epoch: json.epoch,
    batch: json.batch,
    device: json.device,
    save_last_every: json.save_last_every,
  })
  if (parsed.success) return { ok: true, value: parsed.data }
  const first = parsed.error.issues[0]
  const where = first === undefined ? '' : first.path.join('.')
  return { ok: false, message: `学習再開のリクエストを作れませんでした(${where})。` }
}

/**
 * 学習設定の取得(GET /models/{model_id}/config)の応答。学習開始のリクエストと同じ形に model_id が付く。
 * モデル構造は再開画面で使わない(サーバーが保存済みの構造で再開する)ので、検証もしない。
 * データセットは応答に含まれない(サーバーはパスを返さない。再開ではデータセットを変えられない)。
 */
export const rustModelConfigSchema = rustStartTrainingRequestSchema.omit({
  model_graph: true,
  dataset_id: true,
})

export type RustModelConfig = z.infer<typeof rustModelConfigSchema>

export type RustConfigConversion =
  | { readonly ok: true; readonly value: TrainingSettings }
  | { readonly ok: false; readonly message: string }

/**
 * `{ "type": "種類", ...パラメータ }` を `{ "種類": { ...パラメータ } }` に戻す(tagged の逆)。
 * 形は直後に trainingSettingsJsonSchema で確かめるので、ここでは型を付けない
 */
function untagged(json: Readonly<{ type: string }>): Record<string, unknown> {
  const { type, ...params } = json
  return { [type]: params }
}

/** Rust の形の学習設定を、学習設定の型にする(proto-json を通して、カタログにない種類を弾く) */
export function fromRustModelConfig(json: RustModelConfig): RustConfigConversion {
  const parsed = trainingSettingsJsonSchema.safeParse({
    model_name: json.model_name,
    optimizer: untagged(json.optimizer),
    loss: untagged(json.loss),
    epoch: json.epoch,
    batch: json.batch,
    // データセットは応答にないので、学習設定では未選択(再開画面では使わない)
    device: json.device,
    data_spec: {
      image: {
        annotation: untagged(json.data_spec.image_annotation_config),
        input_width: json.data_spec.input_width,
        input_height: json.data_spec.input_height,
        task_specs: untagged(json.data_spec.image_task_spec),
      },
    },
    save_last_every: json.save_last_every,
    resume_from: '',
    // null(固定しない)は、proto-json ではキーごと省く
    ...(json.seed === null || json.seed === undefined ? {} : { seed: { value: json.seed } }),
  })
  if (parsed.success) return { ok: true, value: trainingSettingsFromJson(parsed.data) }
  const first = parsed.error.issues[0]
  const where = first === undefined ? '' : first.path.join('.')
  return { ok: false, message: `サーバーの学習設定を読めませんでした(${where})。` }
}
