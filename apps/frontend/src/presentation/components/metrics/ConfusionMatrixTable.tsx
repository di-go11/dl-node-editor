import { useId, useState } from 'react'

import type { ConfusionMatrix } from '../../../entity/training/confusion-matrix'
import {
  classPixelRatios,
  columnRatios,
  rowRatios,
} from '../../../entity/training/confusion-matrix'

import styles from './ConfusionMatrixTable.module.css'

/**
 * 検証データの混同行列の表(issue「混同行列の表示」)。学習中の画面と学習の記録の画面で使う。
 *
 *   - 行 = 正解のクラス、列 = 予測のクラス。行見出し・列見出しを <th scope> で付け、対角のセルは枠で強調する
 *   - 表示を切り替えられる: 正解ごとの割合(既定。対角が再現率で、見落としが分かる)/
 *     予測ごとの割合(対角が適合率で、はみ出しが分かる)/ 画素数
 *   - セルの背景は 1 色の濃淡(値が大きいほど濃い)。色だけに頼らず、数値を必ず書く
 *   - 右端の「画素の割合」は、正解がそのクラスの画素が検証データ全体に占める割合(クラスの少なさ)
 *   - 合計が 0 の行・列(検証データに現れない・一度も予測されないクラス)の割合は「—」(0 % と区別する)
 */

const MODES = {
  row: {
    label: '正解ごとの割合',
    description:
      '各行は、正解がそのクラスの画素を、どのクラスと予測したかの割合です。対角は再現率(見落としの少なさ)です。',
  },
  column: {
    label: '予測ごとの割合',
    description:
      '各列は、そのクラスと予測した画素の、正解のクラスの割合です。対角は適合率(はみ出しの少なさ)です。',
  },
  count: {
    label: '画素数',
    description: '画素数そのものです。ignore_index の画素は含みません。',
  },
} as const

type Mode = keyof typeof MODES

/** 背景の濃さの上限(%)。これ以上濃くすると、セルの文字が読みにくくなる */
const MAX_SHADE_PERCENT = 55

const countFormat = new Intl.NumberFormat('ja-JP')
const formatRatio = (value: number | null) =>
  value === null ? '—' : `${(value * 100).toFixed(1)} %`

export function ConfusionMatrixTable({
  matrix,
  caption,
}: {
  readonly matrix: ConfusionMatrix
  /** 表の名前(例: 混同行列(検証データ・エポック 200)) */
  readonly caption: string
}) {
  const [mode, setMode] = useState<Mode>('row')
  const radioName = useId()

  const classIndexes = matrix.map((_, index) => index)
  const ratios =
    mode === 'row' ? rowRatios(matrix) : mode === 'column' ? columnRatios(matrix) : null
  const maxCount = Math.max(0, ...matrix.flat())
  const pixelRatios = classPixelRatios(matrix)

  const cell = (trueClass: number, predClass: number) => {
    const count = matrix[trueClass]?.[predClass] ?? 0
    const value = ratios === null ? count : (ratios[trueClass]?.[predClass] ?? null)
    // 濃さは 0〜1。画素数は、行列の中で一番多いセルを 1 にする
    const shade =
      value === null ? 0 : ratios === null ? (maxCount === 0 ? 0 : count / maxCount) : value
    return {
      text: ratios === null ? countFormat.format(count) : formatRatio(value),
      background:
        shade === 0
          ? undefined
          : `color-mix(in srgb, var(--color-series-1) ${(shade * MAX_SHADE_PERCENT).toFixed(1)}%, transparent)`,
    }
  }

  return (
    <div>
      <fieldset className={styles.modes}>
        <legend className={styles.modesTitle}>表示</legend>
        {(Object.keys(MODES) as Mode[]).map((key) => (
          <label key={key} className={styles.mode}>
            <input
              type="radio"
              name={radioName}
              value={key}
              checked={mode === key}
              onChange={() => setMode(key)}
            />
            {MODES[key].label}
          </label>
        ))}
      </fieldset>
      {/* クラスが多いと(VOC は 21 クラス)画面より広くなるので、表だけを横にスクロールさせる */}
      <div className={styles.scroll}>
        <table className={styles.table}>
          <caption className={styles.caption}>{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.corner}>
                正解 ↓ / 予測 →
              </th>
              {classIndexes.map((index) => (
                <th key={index} scope="col">
                  クラス {index}
                </th>
              ))}
              <th scope="col" className={styles.share}>
                画素の割合
              </th>
            </tr>
          </thead>
          <tbody>
            {classIndexes.map((trueClass) => (
              <tr key={trueClass}>
                <th scope="row">クラス {trueClass}</th>
                {classIndexes.map((predClass) => {
                  const { text, background } = cell(trueClass, predClass)
                  return (
                    <td
                      key={predClass}
                      className={trueClass === predClass ? styles.diagonal : undefined}
                      style={background === undefined ? undefined : { background }}
                    >
                      {text}
                    </td>
                  )
                })}
                <td className={styles.share}>{formatRatio(pixelRatios[trueClass] ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.note}>{MODES[mode].description}</p>
    </div>
  )
}
