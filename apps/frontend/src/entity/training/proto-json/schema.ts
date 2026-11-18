import { z } from 'zod'

import { modelGraphJsonSchema, paramValueJsonSchema } from '../../model-graph/proto-json/schema'
import { ANNOTATION_TYPES, IMAGE_TASK_TYPES } from '../data-spec'
import { LOSS_TYPES } from '../loss'
import { OPTIMIZER_TYPES } from '../optimizer'
import type { VariantCatalog } from '../variant'
import { isVariantKind, variantKindsOf } from '../variant'

/**
 * 学習設定の JSON 表記(`test_segnet_dag.json` と同じ形)を検証する Zod スキーマ。
 *
 * 方針は 1a の model-graph/proto-json/schema.ts と同じである。
 *
 *   - この形は C++ が直接読む設定ファイルの形であり、保存ファイル(指示書 7.2)の
 *     training の項目にも使う。HTTP の都合ではないので、エンティティ層が持つ。
 *   - 検証するのは **構造** だけ(キーの名前、入れ子、oneof が 1 つだけであること)。
 *     値の制約(learning_rate > 0 など)はカタログの ParamDef に 1 か所だけ置き、
 *     validation/validate-training.ts がそれを使う。
 *     構造が正しければ、制約を破った値(編集途中の epoch = 0 など)でも読み込める。
 *     そのほうが、保存ファイルを開いてから画面上で直せるため親切である。
 *
 * HTTP で送る形はこれとは別で、infrastructure/http/rust-training-request.ts が変換する。
 */

export type ParamBagJson = Record<string, z.infer<typeof paramValueJsonSchema>>
export type VariantJson = Record<string, ParamBagJson>

/**
 * proto の oneof 1 つぶんのスキーマを、カタログから作る。
 *
 * 種類ごとに z.object を書かず「種類名 → パラメータ袋」として受けている。
 * loss を 1 種類増やしても、このファイルを触らずに済むようにするためである
 * (NodeSpec の nodeSpecJsonSchema と同じ考え方)。
 *
 * 1 つ目の refine に abort: true を付けている。キーが 2 つあるときに
 * 「種類が不明」まで重ねて報告すると、本当の原因(oneof の違反)が埋もれるためである。
 */
function variantJsonSchemaOf(catalog: VariantCatalog, field: string): z.ZodType<VariantJson> {
  const kinds = variantKindsOf(catalog).join(' / ')
  return z
    .record(z.string(), z.record(z.string(), paramValueJsonSchema))
    .refine((value) => Object.keys(value).length === 1, {
      message: `${field} は種類をちょうど 1 つだけ持つ必要があります(proto の oneof)`,
      abort: true,
    })
    .refine((value) => {
      const kind = Object.keys(value)[0]
      return kind !== undefined && isVariantKind(catalog, kind)
    }, `${field} の種類が不明です。選べるのは次のどれかです: ${kinds}`)
}

export const optimizerJsonSchema = variantJsonSchemaOf(OPTIMIZER_TYPES, 'optimizer')
export const lossJsonSchema = variantJsonSchemaOf(LOSS_TYPES, 'loss')
export const annotationJsonSchema = variantJsonSchemaOf(ANNOTATION_TYPES, 'annotation')
export const imageTaskJsonSchema = variantJsonSchemaOf(IMAGE_TASK_TYPES, 'task_specs')

export const imageSpecJsonSchema = z.object({
  annotation: annotationJsonSchema,
  input_width: z.number(),
  input_height: z.number(),
  task_specs: imageTaskJsonSchema,
})

/**
 * proto の DataSpec(oneof)。今は image だけなので、image を必須にした strictObject で表す。
 *
 * strictObject にしているのは、知らない種類(例 { "sequence": {...} })を黙って
 * 捨てずに拒否するためである。oneof なのにキーを捨てると、送った内容と
 * 読み込んだ内容が食い違う。
 */
export const dataSpecJsonSchema = z.strictObject({
  image: imageSpecJsonSchema,
})

export const seedJsonSchema = z.object({
  value: z.number(),
})

/**
 * 学習設定(StartTrainingRequest から model_graph を除いたもの)。
 * seed は省略できる(省略 = 乱数を固定しない)。
 *
 * データセットだけは C++ の設定ファイルの形と違い、パス(dataset_path)ではなく
 * 登録済みデータセットの ID(dataset_id)を持つ。パスはサーバーが ID から決め、フロントは知らない。
 * dataset_id を省略できるのは、C++ の設定ファイル(test_segnet_dag.json など)も読み込めるようにするため。
 * それらにある dataset_path は、知らないキーとして読み捨てる(z.object の既定の動作)。
 */
export const trainingSettingsJsonSchema = z.object({
  model_name: z.string(),
  optimizer: optimizerJsonSchema,
  loss: lossJsonSchema,
  epoch: z.number(),
  batch: z.number(),
  dataset_id: z.string().optional(),
  device: z.string(),
  data_spec: dataSpecJsonSchema,
  save_last_every: z.number(),
  resume_from: z.string(),
  seed: seedJsonSchema.optional(),
})

/** 学習開始のリクエスト全体。test_segnet_dag.json そのものの形 */
export const startTrainingRequestJsonSchema = trainingSettingsJsonSchema.extend({
  model_graph: modelGraphJsonSchema,
})

export type ImageSpecJson = z.infer<typeof imageSpecJsonSchema>
export type DataSpecJson = z.infer<typeof dataSpecJsonSchema>
export type SeedJson = z.infer<typeof seedJsonSchema>
export type TrainingSettingsJson = z.infer<typeof trainingSettingsJsonSchema>
export type StartTrainingRequestJson = z.infer<typeof startTrainingRequestJsonSchema>
