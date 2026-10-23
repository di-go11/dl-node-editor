import type { EditorContext } from '../editor-context/editor-context'
import { editorContextEquals } from '../editor-context/editor-context'
import type { ReservedNodeId } from '../model-graph/node-id'
import type { NodeKind, ParamValue, ParamValues } from '../model-graph/node-spec'
import type { PortKind } from '../model-graph/port'

import type { ParamDefs } from '../param/param-def'
import { enumLabelOf } from '../param/param-def'

/**
 * ノード 1 種類の定義。カタログ 1 件ぶん。
 *
 * ## 設計の要点:すべてデータであること
 *
 * この型には **関数を持たせていない。** 要約表示も summaryTemplate という文字列で
 * 表している。指示書 5.3 が「カタログは将来 API から取得する実装に差し替えられる
 * ようにする」としているため、定義が JSON で表せる形でなければならない。
 * 要約を (params) => string のような関数にすると、その時点で API 由来にできなくなる。
 *
 * ## ノードを 1 種類増やすとき
 *
 * entries/ にこの型の値を 1 つ作り、entries/index.ts の配列に 1 行足すだけでよい。
 * UI も検証も、この定義を読んで動く汎用コードになっている(開放閉鎖原則)。
 */

/** サイドバーのディレクトリ(指示書 4.2) */
export const NODE_CATEGORIES = [
  'convolution',
  'pooling',
  'normalization',
  'activation',
  'fully-connected',
  'upsample',
  'merge',
  'graph-io',
] as const

export type NodeCategory = (typeof NODE_CATEGORIES)[number]

export const NODE_CATEGORY_LABELS: Readonly<Record<NodeCategory, string>> = {
  convolution: '畳み込み',
  pooling: 'プーリング',
  normalization: '正規化',
  activation: '活性化',
  'fully-connected': '全結合',
  upsample: '拡大',
  merge: '結合',
  'graph-io': 'グラフの入出力',
}

/**
 * 入力ポートの定義。NodePorts.hpp の InputPortSpec と 1 対 1 に対応させている。
 * フィールドをそろえておくと、C++ 側を見ながら移植でき、差分も目で追える。
 */
export type InputPortDef = {
  readonly name: string
  readonly kind: PortKind
  /** true なら同じポートに複数つなげる(Add / Concat の 'x') */
  readonly variadic: boolean
  /** 最低限必要な接続の本数 */
  readonly minCount: number
}

/** 出力ポートの定義。NodePorts.hpp の OutputPortSpec に対応する */
export type OutputPortDef = {
  readonly name: string
  readonly kind: PortKind
}

/**
 * エディタ内でのノードの種類の識別子。
 *
 * proto に出るノードは NodeSpec の oneof フィールド名、エディタ専用の Input / Output は
 * 予約ノード ID をそのまま使う。Input / Output はグラフにそれぞれ 1 つだけなので、
 * 種類の識別子とノードの ID が一致していてよい。
 */
export type NodeTypeId = NodeKind | ReservedNodeId

type NodeTypeDefBase = {
  readonly label: string
  readonly category: NodeCategory
  readonly description?: string
  readonly inputs: readonly InputPortDef[]
  readonly outputs: readonly OutputPortDef[]
  readonly params: ParamDefs
  /** この種類を使える条件の組み合わせ(指示書 4.3) */
  readonly contexts: readonly EditorContext[]
  /** ノード上の要約表示。'{in_channels}→{out_channels}, k{kernel_size}' のように書く */
  readonly summaryTemplate?: string
}

/**
 * editorOnly で 2 つに分かれる。
 * false なら typeId は proto の層の種類、true なら予約 ID になる。
 * 2 つのフィールドを独立に持たせると「editorOnly なのに typeId が conv2d」のような
 * ありえない組み合わせが作れてしまうため、型で縛っている。
 */
export type NodeTypeDef = NodeTypeDefBase &
  (
    | { readonly editorOnly: false; readonly typeId: NodeKind }
    | { readonly editorOnly: true; readonly typeId: ReservedNodeId }
  )

/** NodePorts.hpp の既定値(kind=Feature, variadic=false, minCount=1)に合わせた作成関数 */
export function inputPort(
  name: string,
  options: { kind?: PortKind; variadic?: boolean; minCount?: number } = {},
): InputPortDef {
  return {
    name,
    kind: options.kind ?? 'feature',
    variadic: options.variadic ?? false,
    minCount: options.minCount ?? 1,
  }
}

export function outputPort(name: string, kind: PortKind = 'feature'): OutputPortDef {
  return { name, kind }
}

export function inputPortDef(def: NodeTypeDef, name: string): InputPortDef | undefined {
  return def.inputs.find((port) => port.name === name)
}

export function outputPortDef(def: NodeTypeDef, name: string): OutputPortDef | undefined {
  return def.outputs.find((port) => port.name === name)
}

/** proto のノードになる種類なら層の種類を返す。エディタ専用なら null */
export function wireKindOf(def: NodeTypeDef): NodeKind | null {
  return def.editorOnly ? null : def.typeId
}

export function isAvailableInContext(def: NodeTypeDef, context: EditorContext): boolean {
  return def.contexts.some((candidate) => editorContextEquals(candidate, context))
}

/** summaryTemplate が参照しているパラメータ名を取り出す(定義の健全性検査に使う) */
export function summaryPlaceholdersOf(def: NodeTypeDef): readonly string[] {
  if (def.summaryTemplate === undefined) return []
  return [...def.summaryTemplate.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1] ?? '')
}

/**
 * ノード上の要約表示を組み立てる。
 *
 * enum のパラメータは、proto の名前(ACTIVATION_TYPE_RELU)ではなく
 * 表示用のラベル(ReLU)に置き換える。ノードの上に出すのは人が読む文字列なので、
 * 機械向けの表記をそのまま見せない。
 */
export function formatNodeSummary(def: NodeTypeDef, params: ParamValues): string {
  const template = def.summaryTemplate
  if (template === undefined) return ''

  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_whole: string, name: string): string => {
    const value: ParamValue | undefined = params[name]
    if (value === undefined) return '?'
    const paramDef = def.params[name]
    if (paramDef?.kind === 'enum') return enumLabelOf(paramDef, value)
    return String(value)
  })
}
