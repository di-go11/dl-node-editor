/**
 * 層の種類とパラメータ。
 *
 * パラメータを種類ごとの静的な型にせず、名前から値への対応(パラメータ袋)として
 * 持っている。理由は次の 2 つである。
 *
 *   1. ノードを 1 種類増やす作業を「カタログに 1 件足すだけ」にするため(開放閉鎖原則)。
 *      種類ごとに型を書くと、型・カタログ・変換の 3 か所を触ることになる。
 *   2. プロパティパネルはカタログの定義からフォームを組み立てる汎用コードであり、
 *      params[name] = value という形で書き込む。種類ごとの狭い型だと、
 *      この汎用コードがキャストだらけになり、型安全の見かけだけが残る。
 *
 * 失う静的型安全の代わりに、実行時の安全をカタログから導いた Zod スキーマで確保する
 * (node-catalog/param-def.ts)。制約の宣言はカタログ 1 か所だけに置く。
 */

/**
 * proto の NodeSpec の oneof フィールド名。JSON 表記のキーと一致させる。
 * Input / Output はエディタ専用のノードなのでここには含まれない。
 *
 * この並びが生成型(src/api/schema.d.ts)の NodeSpec のキーと一致していることは、
 * src/api/model-graph-shape.contract.test.ts で型レベルに検査している。
 */
export const NODE_KINDS = [
  'conv2d',
  'pooling2d',
  'batch_norm',
  'linear',
  'activation',
  'indexed_pooling',
  'unpooling',
  'upsample',
  'add',
  'concat',
] as const

export type NodeKind = (typeof NODE_KINDS)[number]

export function isNodeKind(value: string): value is NodeKind {
  return (NODE_KINDS as readonly string[]).includes(value)
}

/** パラメータが取りうる値。proto の数値・文字列(enum 名)・真偽値に対応する */
export type ParamValue = number | string | boolean

export type ParamValues = Readonly<Record<string, ParamValue>>

export type NodeSpec = {
  readonly kind: NodeKind
  readonly params: ParamValues
}

/**
 * パラメータの読み出し。
 *
 * 型が必要な箇所(チャンネル数の整合チェックなど)はこの関数を通す。
 * 期待した型でなければ undefined を返し、呼び出し側は「分からないので確認しない」
 * と判断できる。例外にしないのは、編集中の不完全な状態でも検証を走らせるためである。
 */
export function readNumberParam(spec: NodeSpec, name: string): number | undefined {
  const value = spec.params[name]
  return typeof value === 'number' ? value : undefined
}

export function readStringParam(spec: NodeSpec, name: string): string | undefined {
  const value = spec.params[name]
  return typeof value === 'string' ? value : undefined
}

export function readBooleanParam(spec: NodeSpec, name: string): boolean | undefined {
  const value = spec.params[name]
  return typeof value === 'boolean' ? value : undefined
}

/** パラメータを部分的に差し替えた新しい NodeSpec を返す(元の値は変えない) */
export function withParams(spec: NodeSpec, patch: ParamValues): NodeSpec {
  return { kind: spec.kind, params: { ...spec.params, ...patch } }
}
