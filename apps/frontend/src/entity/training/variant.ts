import type { ParamValue, ParamValues } from '../model-graph/node-spec'
import type { ParamDef, ParamDefs } from '../param/param-def'
import { defaultParamsOf } from '../param/param-def'

/**
 * バリアント - proto の oneof を「種類 1 つ + パラメータ袋」として扱うための型。
 *
 * ## なぜ oneof をこの形にまとめるのか
 *
 * training.proto の oneof(optimizer / loss / annotation / task_specs)は、
 * JSON 表記がどれも NodeSpec と同じ形をしている。
 *
 *   NodeSpec        = { "conv2d": { "in_channels": 3, ... } }
 *   OptimizerConfig = { "adam":   { "learning_rate": 0.001, ... } }
 *   LossConfig      = { "focal":  { "gamma": 2, "alpha": 0.25 } }
 *
 * そこで種類ごとの定義を VariantDef(表示名 + ParamDefs)のカタログとして持ち、
 * ノードカタログと同じ仕組みを使い回す。
 *
 *   - 制約の宣言は ParamDef の 1 か所だけ。検証(paramsSchemaOf)、既定値
 *     (defaultParamsOf)、学習設定画面のフォームを、すべてここから導く。
 *   - loss を 1 種類増やすときは、カタログに 1 件足すだけで済む(開放閉鎖原則)。
 *   - カタログを `satisfies` で宣言すると、種類名とパラメータ名がリテラル型として残る。
 *     src/api/training-shape.contract.test.ts がこれを使って、契約との一致を
 *     コンパイル時に検査する(1b のノードカタログと同じ手)。
 */

/** バリアント 1 種類の定義。カタログ 1 件ぶん。ノードカタログと同じく、すべてデータで持つ */
export type VariantDef = {
  readonly label: string
  readonly description?: string
  readonly params: ParamDefs
}

/** 種類名 → 定義。キーは proto の oneof のフィールド名と一致させる */
export type VariantCatalog<K extends string = string> = Readonly<Record<K, VariantDef>>

/** 選んだ値。NodeSpec と同じく、パラメータは名前 → 値の袋で持つ */
export type Variant<K extends string = string> = {
  readonly kind: K
  readonly params: ParamValues
}

/**
 * カタログの種類名を、宣言した順に返す(画面の選択肢の並び順に使う)。
 *
 * Object.keys の戻り値は string[] になってしまうため、ここで 1 回だけ K[] に直す。
 * キーはカタログ自身から取っているので、この変換は嘘にならない。
 */
export function variantKindsOf<K extends string>(catalog: VariantCatalog<K>): readonly K[] {
  return Object.keys(catalog) as K[]
}

export function isVariantKind<K extends string>(
  catalog: VariantCatalog<K>,
  value: string,
): value is K {
  // in 演算子だと 'toString' のようなプロトタイプ上の名前まで true になるため、自身のキーだけを見る
  return Object.hasOwn(catalog, value)
}

export function variantDefOf<K extends string>(catalog: VariantCatalog<K>, kind: K): VariantDef {
  return catalog[kind]
}

/** その種類の既定値のバリアントを作る(学習設定の初期値や、種類を切り替えたときに使う) */
export function defaultVariant<K extends string>(catalog: VariantCatalog<K>, kind: K): Variant<K> {
  return { kind, params: defaultParamsOf(catalog[kind].params) }
}

/**
 * 種類を切り替える。**名前と型が同じパラメータは値を引き継ぐ。**
 *
 * 例: Adam(learning_rate = 0.01)から SGD に切り替えると、SGD の learning_rate も
 * 0.01 のままになり、momentum など SGD にしかない項目は既定値になる。
 * 切り替えるたびに学習率を入れ直させると、比較実験のときに手間で、入れ忘れの原因にもなる。
 *
 * 引き継ぐのは「両方の定義にあり、kind も同じ」ものだけである。名前が同じでも
 * 片方が int、片方が enum のように意味が違えば、既定値に戻す。
 */
export function changeVariantKind<K extends string>(
  catalog: VariantCatalog<K>,
  current: Variant<K>,
  nextKind: K,
): Variant<K> {
  if (current.kind === nextKind) return current

  const currentDefs = catalog[current.kind].params
  const nextDefs = catalog[nextKind].params
  const params: Record<string, ParamValue> = { ...defaultParamsOf(nextDefs) }

  for (const [name, nextDef] of Object.entries(nextDefs)) {
    const currentDef: ParamDef | undefined = currentDefs[name]
    const value = current.params[name]
    if (currentDef?.kind === nextDef.kind && value !== undefined) {
      params[name] = value
    }
  }

  return { kind: nextKind, params }
}

/** パラメータを一部だけ書き換える(学習設定画面の入力欄 1 つぶんの更新) */
export function withVariantParams<K extends string>(
  variant: Variant<K>,
  patch: ParamValues,
): Variant<K> {
  return { kind: variant.kind, params: { ...variant.params, ...patch } }
}
