import { useId, useState } from 'react'

import type { ParamValue } from '../../../entity/model-graph/node-spec'
import type { ParamDef } from '../../../entity/param/param-def'
import { describeParamConstraint, paramErrorOf } from '../../../entity/param/param-def'

import styles from './ParamField.module.css'

/**
 * パラメータ 1 つぶんの入力欄。**ParamDef(カタログの定義)から自動で組み立てる。**
 *
 *   kind: 'int' / 'float' → 数値の入力欄
 *   kind: 'bool'          → チェックボックス
 *   kind: 'enum'          → セレクト(選択肢はカタログの options)
 *
 * ノードごとにフォームを手書きしない(指示書 4.2)。ノードを 1 種類増やしても、
 * カタログに ParamDef を書けば入力欄は自動でできる。フェーズ 5 の学習設定画面
 * (optimizer / loss のパラメータ)でも同じ部品を使う。
 *
 * ## 入力途中の文字列は、この部品の中にだけ持つ
 *
 * 数値の欄に「1e-」「0.」「(空)」と打っている途中は、まだ数値として読めない。
 * これをそのままドメインに書くと NaN が入り込む。そこで入力中の文字列(draft)は
 * この部品の state に持ち、**数値として読めたときだけ** onCommit でストアに書く。
 * 欄からフォーカスが外れたら draft を捨て、ストアの値の表示に戻す。
 *
 * ## 制約違反はすぐに表示する
 *
 * 制約(kernel_size >= 1 など)はカタログの ParamDef から paramErrorOf で確かめ、
 * 入力欄の下に表示する(指示書 4.2「制約違反は入力欄の横にすぐ表示する」)。
 * 違反した値もストアには書く。整合性チェックがログにも出し、学習を始められなくする。
 * 書かずに捨てると、ノード上の要約と入力欄の表示が食い違って分かりにくい。
 */

export type ParamFieldProps = {
  readonly name: string
  readonly def: ParamDef
  readonly value: ParamValue | undefined
  readonly onCommit: (value: ParamValue) => void
}

/** 入力欄の文字列を数値として読む。読めなければ null(空欄・途中の入力) */
function parseNumberInput(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

export function ParamField({ name, def, value, onCommit }: ParamFieldProps) {
  const inputId = useId()
  const messageId = useId()
  const [draft, setDraft] = useState<string | null>(null)

  const draftUnreadable = draft !== null && parseNumberInput(draft) === null
  const error = draftUnreadable ? '数値として読めません。' : paramErrorOf(def, value)
  const constraint = describeParamConstraint(def)

  const describedBy = error !== null || def.help !== undefined ? messageId : undefined

  const control = (() => {
    switch (def.kind) {
      case 'int':
      case 'float':
        return (
          <input
            id={inputId}
            className={styles.input}
            type="text"
            // スマートフォンでは数字のキーボードを出す。type="number" にしないのは、
            // 途中の入力(1e- など)をブラウザが空文字に変えてしまい、draft で扱えないため
            inputMode={def.kind === 'int' ? 'numeric' : 'decimal'}
            value={draft ?? (value === undefined ? '' : String(value))}
            aria-invalid={error !== null}
            aria-describedby={describedBy}
            onChange={(event) => {
              const text = event.target.value
              setDraft(text)
              const parsed = parseNumberInput(text)
              if (parsed !== null) onCommit(parsed)
            }}
            onBlur={() => setDraft(null)}
          />
        )
      case 'bool':
        return (
          <input
            id={inputId}
            type="checkbox"
            checked={value === true}
            aria-describedby={describedBy}
            onChange={(event) => onCommit(event.target.checked)}
          />
        )
      case 'enum':
        return (
          <select
            id={inputId}
            className={styles.input}
            value={typeof value === 'string' ? value : ''}
            aria-invalid={error !== null}
            aria-describedby={describedBy}
            onChange={(event) => onCommit(event.target.value)}
          >
            {def.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )
    }
  })()

  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {def.label}
        <span className={styles.name}>{name}</span>
      </label>
      <div className={styles.control}>
        {control}
        {constraint !== undefined && def.kind !== 'enum' && (
          <span className={styles.constraint}>{constraint}</span>
        )}
      </div>
      {(error !== null || def.help !== undefined) && (
        <p id={messageId} className={error !== null ? styles.error : styles.help}>
          {error ?? def.help}
        </p>
      )}
    </div>
  )
}
