import { z } from 'zod'

import { NODE_ID_PATTERN, isReservedNodeId } from '../node-id'
import { isNodeKind } from '../node-spec'

/**
 * モデル構造の JSON 表記(`test_segnet_dag.json` と同じ形)を検証する Zod スキーマ。
 *
 * ## なぜエンティティ層にあるのか
 *
 * この形は HTTP の都合ではない。C++ が直接読む設定ファイルの形であり、
 * 保存ファイル(指示書 7 章)にも埋め込まれ、3 言語すべての共通語になっている。
 * つまりこのプロジェクトの中核的なデータ形式なので、エンティティ層が持つ。
 *
 * HTTP で送る形はこれとは別で、infrastructure/http/rust-training-request.ts が変換する。
 *
 * ## このスキーマが検証すること / しないこと
 *
 * 検証するのは **構造** だけである。
 *   - キーの名前と入れ子の形
 *   - ID が proto の文字制約を満たし、予約 ID でないこと
 *   - spec が既知の層の種類を 1 つだけ持つこと
 *
 * 一方、**パラメータの制約**(kernel_size >= 1 など)はここでは検証しない。
 * 制約の宣言はノードカタログの ParamDef に 1 か所だけ置き、検証層がそれを使う。
 * 同じ制約を Zod とカタログの 2 か所に書くと、必ず片方が古くなるためである。
 *
 * ## 契約より緩くしている点
 *
 * nodes と outputs の最小個数を 0 にしている。API の契約では nodes >= 1 /
 * outputs == 1 だが、編集途中のグラフも保存できる必要がある。
 * 「送れる状態か」の判定は検証層の責務であって、この形式の責務ではない。
 */

/** パラメータが取りうる値。proto の数値・enum 名の文字列・真偽値に対応する */
export const paramValueJsonSchema = z.union([z.number(), z.string(), z.boolean()])

const nodeIdJsonSchema = z
  .string()
  .regex(NODE_ID_PATTERN, 'ノード ID に使えるのは英数字と - _ だけです')
  .refine(
    (value) => !isReservedNodeId(value),
    'このノード ID はエディタ専用に予約されています(__input__ / __output__)',
  )

/**
 * 出力ポート 1 つへの参照。
 * 両方のキーを省いた `{}` はグラフ入力(画像)を意味する。
 */
export const portRefJsonSchema = z.object({
  node_id: z.string().optional(),
  port: z.string().optional(),
})

/** モデルの出力。グラフ入力は指定できないので node_id を必須にしている */
export const nodeOutputRefJsonSchema = z.object({
  node_id: nodeIdJsonSchema,
  port: z.string().min(1),
})

export const nodeInputJsonSchema = z.object({
  port: z.string().min(1),
  source: portRefJsonSchema,
})

/**
 * 層の種類とパラメータ。proto の oneof なので、キーはちょうど 1 つ。
 *
 * 種類ごとに別のスキーマを書かず、「名前 → パラメータ袋」として受けている。
 * ノードを 1 種類増やしてもこのスキーマを触らずに済むようにするためである
 * (node-spec.ts の設計方針と同じ理由)。
 */
export const nodeSpecJsonSchema = z
  .record(z.string(), z.record(z.string(), paramValueJsonSchema))
  .refine(
    (value) => Object.keys(value).length === 1,
    'spec は層の種類をちょうど 1 つだけ持つ必要があります(proto の oneof)',
  )
  .refine((value) => {
    const kind = Object.keys(value)[0]
    return kind !== undefined && isNodeKind(kind)
  }, '知らない層の種類です')

export const nodeJsonSchema = z.object({
  id: nodeIdJsonSchema,
  spec: nodeSpecJsonSchema,
  inputs: z.array(nodeInputJsonSchema),
})

export const modelGraphJsonSchema = z.object({
  nodes: z.array(nodeJsonSchema),
  outputs: z.array(nodeOutputRefJsonSchema),
})

export type ParamValueJson = z.infer<typeof paramValueJsonSchema>
export type PortRefJson = z.infer<typeof portRefJsonSchema>
export type NodeOutputRefJson = z.infer<typeof nodeOutputRefJsonSchema>
export type NodeInputJson = z.infer<typeof nodeInputJsonSchema>
export type NodeSpecJson = z.infer<typeof nodeSpecJsonSchema>
export type NodeJson = z.infer<typeof nodeJsonSchema>
export type ModelGraphJson = z.infer<typeof modelGraphJsonSchema>
