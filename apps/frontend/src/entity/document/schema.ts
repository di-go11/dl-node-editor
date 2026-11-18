import { z } from 'zod'

import { DATA_DIMS, FEATURE_METHODS } from '../editor-context/editor-context'
import { NODE_ID_PATTERN } from '../model-graph/node-id'
import { modelGraphJsonSchema } from '../model-graph/proto-json/schema'
import { trainingSettingsJsonSchema } from '../training/proto-json/schema'

import { DOCUMENT_FORMAT } from './document'
import { CURRENT_DOCUMENT_VERSION } from './migrate'

/**
 * 保存ファイル(版 2)の JSON 表記を検証する Zod スキーマ(指示書 7.2)。
 * 古い版のファイルは、migrate.ts で版 2 の形に変換してからこのスキーマで検証する。
 *
 * ```jsonc
 * {
 *   "format": "model-editor-document",
 *   "version": 2,
 *   "meta":    { "name": "segnet", "saved_at": "2026-10-22T10:00:00Z" },
 *   "context": { "data_dim": "2d", "method": "cnn" },
 *   "model":   { "model_graph": { ... } },          // model_graph.proto の JSON 表記そのもの
 *   "editor":  { "positions": { ... }, "viewport": { ... } },
 *   "training": { ... }                             // 省略可
 * }
 * ```
 *
 * ## model と training は proto の JSON 表記のまま持つ
 *
 * model.model_graph と training は、test_segnet_dag.json と同じ形のスキーマを
 * そのまま使っている。こうすると、保存ファイルの一部をそのまま API に送れ、
 * C++ の設定ファイルとも見比べられる。形式を 2 つ持つと、変換の誤りが入り込む。
 * ただしデータセットだけは、C++ の dataset_path(パス)ではなく dataset_id(登録済みデータセットの ID)を持つ
 * (版 2 から。フロントはサーバー上のパスを知らないため)。
 *
 * ## 緩くしている点
 *
 * - editor(見た目)は省略できる。座標がなくてもモデルの意味は完全であり、
 *   座標は表示側が自動で並べ直せるためである。手で書いた JSON や、
 *   test_segnet_dag.json から作ったファイルも読めるようにしておく。
 * - 構造だけを検証し、値の制約(kernel_size >= 1 など)は検証しない。
 *   制約違反は読み込んだあとの整合性チェックで報告する(指示書 7.2
 *   「今の条件で使えないノードが含まれていても、読み込みは成功させる」と同じ考え方)。
 */

const positionJsonSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const viewportJsonSchema = z.object({
  x: z.number(),
  y: z.number(),
  // 0 以下の倍率は表示できない。ここで弾かないと、開いた瞬間に画面が真っ白になる
  zoom: z.number().positive(),
})

export const documentJsonSchema = z.object({
  format: z.literal(DOCUMENT_FORMAT),
  version: z.literal(CURRENT_DOCUMENT_VERSION),
  meta: z.object({
    name: z.string(),
    saved_at: z.string().optional(),
  }),
  context: z.object({
    data_dim: z.enum(DATA_DIMS),
    method: z.enum(FEATURE_METHODS),
  }),
  model: z.object({
    model_graph: modelGraphJsonSchema,
  }),
  editor: z
    .object({
      // キーは予約 ID(__input__ / __output__)も含むので、予約の検査はせず文字種だけを見る
      positions: z.record(
        z.string().regex(NODE_ID_PATTERN, 'ノード ID に使えるのは英数字と - _ だけです'),
        positionJsonSchema,
      ),
      viewport: viewportJsonSchema.optional(),
    })
    .optional(),
  training: trainingSettingsJsonSchema.optional(),
})

export type PositionJson = z.infer<typeof positionJsonSchema>
export type ViewportJson = z.infer<typeof viewportJsonSchema>
export type DocumentJson = z.infer<typeof documentJsonSchema>
