import { useId } from 'react'
import type { ReactNode } from 'react'

import type { ParamValues } from '../../../entity/model-graph/node-spec'
import type { ParamDef, ParamDefs } from '../../../entity/param/param-def'
import type { VariantCatalog, Variant } from '../../../entity/training/variant'
import {
  changeVariantKind,
  isVariantKind,
  variantKindsOf,
  withVariantParams,
} from '../../../entity/training/variant'
import { ParamField } from '../param-form/ParamField'

import styles from './TrainingForm.module.css'

/**
 * proto の oneof 1 つぶんの入力欄(optimizer / loss / annotation / task で共通)。
 *
 *   [種類 ▼]           ← カタログの種類(Adam / AdamW / SGD …)
 *   説明
 *   パラメータの欄 …    ← 選んだ種類の ParamDef から ParamField が自動で作る
 *
 * 種類を切り替えたときは、entity の changeVariantKind が同じ名前・同じ型のパラメータを
 * 引き継ぐ(Adam → SGD でも学習率はそのまま)。この部品はそれを呼ぶだけである。
 * 1d で oneof を「バリアントのカタログ」にまとめたので、4 つの oneof を
 * この 1 つの部品で扱える。
 */

/**
 * 入力欄を出すパラメータ。enabledBy の bool パラメータがオフのものは隠す
 * (値は袋に残るので、オンに戻すと前の値が出る)
 */
function visibleParamsOf(
  defs: ParamDefs,
  params: ParamValues,
): readonly (readonly [string, ParamDef])[] {
  return Object.entries(defs).filter(
    ([, paramDef]) =>
      paramDef.kind !== 'int' ||
      paramDef.enabledBy === undefined ||
      params[paramDef.enabledBy] === true,
  )
}

export type VariantFieldProps<K extends string> = {
  readonly legend: string
  /** JSON 表記での名前(optimizer、loss …)。欄の横に小さく出す */
  readonly name: string
  readonly catalog: VariantCatalog<K>
  readonly variant: Variant<K>
  readonly onChange: (variant: Variant<K>) => void
  /** 選択肢の表示名。省略すればカタログの label(未対応の印などを足すときに渡す) */
  readonly optionLabel?: (kind: K) => string
  /** 選択欄の下に出す問題(loss とタスクの組み合わせなど) */
  readonly messages?: readonly string[]
  /** 説明の下に出す補足(loss が期待する入力など) */
  readonly hint?: ReactNode
  /**
   * 種類を変えられないときの理由(学習再開の optimizer など)。渡すと種類の選択欄を無効にし、
   * 理由を横に出す。パラメータは変えられる
   */
  readonly kindLockedReason?: string
}

export function VariantField<K extends string>({
  legend,
  name,
  catalog,
  variant,
  onChange,
  optionLabel,
  messages = [],
  hint,
  kindLockedReason,
}: VariantFieldProps<K>) {
  const selectId = useId()
  const def = catalog[variant.kind]

  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>
        {legend}
        <span className={styles.name}>{name}</span>
      </legend>
      <label htmlFor={selectId} className={styles.visuallyHidden}>
        {legend}の種類
      </label>
      <select
        id={selectId}
        className={styles.select}
        value={variant.kind}
        aria-invalid={messages.length > 0}
        disabled={kindLockedReason !== undefined}
        onChange={(event) => {
          const next = event.target.value
          if (isVariantKind(catalog, next)) onChange(changeVariantKind(catalog, variant, next))
        }}
      >
        {variantKindsOf(catalog).map((kind) => (
          <option key={kind} value={kind}>
            {optionLabel?.(kind) ?? catalog[kind].label}
          </option>
        ))}
      </select>
      {kindLockedReason !== undefined && <p className={styles.hint}>{kindLockedReason}</p>}
      {messages.map((message) => (
        <p key={message} className={styles.error}>
          {message}
        </p>
      ))}
      {def.description !== undefined && <p className={styles.description}>{def.description}</p>}
      {hint}
      {visibleParamsOf(def.params, variant.params).map(([paramName, paramDef]) => (
        <ParamField
          // 種類を切り替えたら入力途中の状態を捨てるよう、種類もキーに含める
          key={`${variant.kind}:${paramName}`}
          name={paramName}
          def={paramDef}
          value={variant.params[paramName]}
          onCommit={(value) => onChange(withVariantParams(variant, { [paramName]: value }))}
        />
      ))}
    </fieldset>
  )
}
