import { z } from 'zod'

import type { ParamValue, ParamValues } from '../model-graph/node-spec'

/**
 * パラメータの定義。**制約の宣言はここ 1 か所だけに置く。**
 *
 * 1 つの ParamDef から次の 3 つが導かれる。
 *
 *   ParamDef ─┬─▶ プロパティパネルの入力欄(kind で入力の種類を決める)
 *             ├─▶ Zod スキーマ(実行時の制約検証) ... paramsSchemaOf
 *             └─▶ 既定値(ノードを置いたときの初期パラメータ) ... defaultParamsOf
 *
 * 同じ制約を「フォームの min 属性」と「検証コードの if 文」に別々に書くと、
 * 必ず片方が古くなる。1 つの宣言から両方を導けば、ずれようがない。
 *
 * ## なぜ独立したモジュールなのか
 *
 * ParamDef を使うのは、ノードカタログ(層のパラメータ)と学習設定(optimizer / loss の
 * パラメータ、エポック数など)の 2 つである。どちらか一方の下に置くと、もう一方が
 * 「関係のないモジュール」に依存することになる。editor-context と同じく、
 * 複数の概念から共有される部品として独立させている。
 */

export type EnumOption = {
  readonly value: string
  readonly label: string
}

export type IntParamDef = {
  readonly kind: 'int'
  readonly label: string
  readonly default: number
  readonly min?: number
  readonly max?: number
  readonly help?: string
}

export type FloatParamDef = {
  readonly kind: 'float'
  readonly label: string
  readonly default: number
  readonly min?: number
  /** min とは違い、この値そのものは許さない(eps > 0 のような制約に使う) */
  readonly exclusiveMin?: number
  readonly max?: number
  /** max とは違い、この値そのものは許さない(Adam の beta < 1 のような制約に使う) */
  readonly exclusiveMax?: number
  readonly help?: string
}

export type BoolParamDef = {
  readonly kind: 'bool'
  readonly label: string
  readonly default: boolean
  readonly help?: string
}

export type EnumParamDef = {
  readonly kind: 'enum'
  readonly label: string
  /** proto の enum の名前の文字列(例 'ACTIVATION_TYPE_RELU') */
  readonly default: string
  readonly options: readonly EnumOption[]
  readonly help?: string
}

export type ParamDef = IntParamDef | FloatParamDef | BoolParamDef | EnumParamDef

export type ParamDefs = Readonly<Record<string, ParamDef>>

/** 1 つのパラメータを検証する Zod スキーマを作る */
export function paramSchemaOf(def: ParamDef): z.ZodType<ParamValue> {
  switch (def.kind) {
    case 'int': {
      let schema = z.number().int('整数を入力してください')
      if (def.min !== undefined) schema = schema.gte(def.min)
      if (def.max !== undefined) schema = schema.lte(def.max)
      return schema
    }
    case 'float': {
      let schema = z.number()
      if (def.min !== undefined) schema = schema.gte(def.min)
      if (def.exclusiveMin !== undefined) schema = schema.gt(def.exclusiveMin)
      if (def.max !== undefined) schema = schema.lte(def.max)
      if (def.exclusiveMax !== undefined) schema = schema.lt(def.exclusiveMax)
      return schema
    }
    case 'bool':
      return z.boolean()
    case 'enum': {
      const values = def.options.map((option) => option.value)
      // z.enum は要素が 1 つ以上のタプルを求めるため、定義から作る動的な配列では
      // 素直に書けない。選択肢に含まれるかを refine で確かめるほうが、
      // エラーメッセージも説明的になる。
      return z
        .string()
        .refine(
          (value) => values.includes(value),
          `選べるのは次のどれかです: ${values.join(' / ')}`,
        )
    }
  }
}

/**
 * ノード 1 種類ぶんのパラメータをまとめて検証する Zod スキーマを作る。
 *
 * strictObject にしているので、定義にないパラメータが入っていれば拒否する。
 * 綴り間違いや、消したパラメータの残りを見逃さないためである
 * (この結果は検証層で Issue に変換するので、読み込み自体は失敗しない)。
 */
export function paramsSchemaOf(defs: ParamDefs): z.ZodType<ParamValues> {
  const shape: Record<string, z.ZodType<ParamValue>> = {}
  for (const [name, def] of Object.entries(defs)) {
    shape[name] = paramSchemaOf(def)
  }
  return z.strictObject(shape)
}

/** 定義から既定値のパラメータを作る(ノードを新しく置いたときの初期値) */
export function defaultParamsOf(defs: ParamDefs): ParamValues {
  const params: Record<string, ParamValue> = {}
  for (const [name, def] of Object.entries(defs)) {
    params[name] = def.default
  }
  return params
}

/** enum の値を表示用のラベルに直す。見つからなければ値そのものを返す */
export function enumLabelOf(def: EnumParamDef, value: ParamValue): string {
  if (typeof value !== 'string') return String(value)
  return def.options.find((option) => option.value === value)?.label ?? value
}

/** 制約を人間が読む形にする(プロパティパネルの補助表示用) */
export function describeParamConstraint(def: ParamDef): string | undefined {
  switch (def.kind) {
    case 'int':
    case 'float': {
      const parts: string[] = []
      if (def.min !== undefined) parts.push(`${def.min} 以上`)
      if (def.kind === 'float' && def.exclusiveMin !== undefined) {
        parts.push(`${def.exclusiveMin} より大きい`)
      }
      if (def.max !== undefined) parts.push(`${def.max} 以下`)
      if (def.kind === 'float' && def.exclusiveMax !== undefined) {
        parts.push(`${def.exclusiveMax} 未満`)
      }
      return parts.length > 0 ? parts.join('、') : undefined
    }
    case 'bool':
      return undefined
    case 'enum':
      return def.options.map((option) => option.label).join(' / ')
  }
}

/**
 * 制約を満たさない値に対する「〜にしてください」という文を作る。
 *
 * プロパティパネルの入力欄の横の表示(subject なし)と、学習設定の検証のログ
 * (subject あり。例「エポック数は整数(1 以上)にしてください。」)の両方で使う。
 * Zod の既定のメッセージ(英語)は使わない。ログや入力欄を読むのは利用者であり、
 * 「Too small: expected number to be >=1」より、何をすればよいかが分かる文のほうがよい。
 */
export function requirementMessage(def: ParamDef, subject?: string): string {
  const who = subject === undefined ? '' : `${subject}は`
  const constraint = describeParamConstraint(def)
  switch (def.kind) {
    case 'int':
      return `${who}${constraint === undefined ? '整数' : `整数(${constraint})`}にしてください。`
    case 'float':
      return `${who}${constraint === undefined ? '数値' : `数値(${constraint})`}にしてください。`
    case 'bool':
      return `${who}オン / オフで指定してください。`
    case 'enum':
      return `${who}次のどれかにしてください: ${constraint ?? ''}`
  }
}

/** 値が制約を満たしていれば null、満たしていなければ requirementMessage の文を返す */
export function paramErrorOf(
  def: ParamDef,
  value: ParamValue | undefined,
  subject?: string,
): string | null {
  return paramSchemaOf(def).safeParse(value).success ? null : requirementMessage(def, subject)
}
