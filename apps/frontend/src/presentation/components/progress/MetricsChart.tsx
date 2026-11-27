import { useState } from 'react'
import type { ReactElement } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { LabelProps } from 'recharts'

import type { MetricPoint } from '../../../entity/training/metric-points'
import { metricLabelsOf } from '../../../entity/training/metric-points'

import styles from './MetricsChart.module.css'

/**
 * mIoU とクラスごとの IoU の推移の折れ線グラフ(issue「mIoU とクラスごとの IoU の推移グラフ」)。
 * 分類タスクでは accuracy とクラスごとの accuracy を描く。
 *
 *   - 横軸はエポック(LossChart・LearningRateChart とそろえる)
 *   - 縦軸は 0〜1 に固定する。学習ごとに範囲が変わると、別の学習の SVG を並べて比べられない
 *   - mIoU は太い線(文字の色)、クラスごとは細い線(系列の配色)。9 番目以降のクラスは破線で区別する
 *   - 色だけに頼らないよう、線の終わりに名前を出す(SVG で保存したときにも残る)
 *   - 線ごとに表示を切り替えられる。クラスが多い(VOC は 21 クラス)と線が重なって読めないので、
 *     DEFAULT_VISIBLE_CLASSES を超えるときは、最初は mIoU だけを出す
 *   - 値が null(メトリクスがない・NaN)の点は線を切る
 *   - 受信のたびに描き直すので、線のアニメーションは切る(LossChart と同じ)
 */

/** これ以下のクラス数なら、最初から全部のクラスの線を出す */
const DEFAULT_VISIBLE_CLASSES = 8

const SERIES_COLOR_COUNT = 8
const seriesColor = (classIndex: number) =>
  `var(--color-series-${(classIndex % SERIES_COLOR_COUNT) + 1})`
/** 色が一巡したら線の形を変える(1 巡目は実線) */
const DASHES = [undefined, '6 3', '2 3'] as const
const seriesDash = (classIndex: number) =>
  DASHES[Math.floor(classIndex / SERIES_COLOR_COUNT) % DASHES.length]

/** 点がこれ以下なら印を付ける(1〜2 エポックだけでは線にならず、何も見えないため) */
const MAX_POINTS_WITH_DOTS = 20

const MAIN_KEY = 'main'
const classKey = (classIndex: number) => `class${classIndex}`

type Series = {
  readonly key: string
  readonly name: string
  /** 線の終わりに出す短い名前 */
  readonly shortName: string
  readonly color: string
  readonly dash: string | undefined
  readonly width: number
}

const formatValue = (value: unknown) => (typeof value === 'number' ? value.toFixed(4) : '—')

/** 値のある最後の点だけに名前を出すラベル */
function endLabel(name: string, lastIndex: number) {
  return function EndLabel(props: LabelProps): ReactElement {
    const { viewBox, index, value } = props
    if (
      index !== lastIndex ||
      typeof value !== 'number' ||
      viewBox === undefined ||
      !('x' in viewBox)
    ) {
      return <g />
    }
    return (
      <text
        x={Number(viewBox.x ?? 0) + 6}
        y={Number(viewBox.y ?? 0)}
        dy={4}
        fontSize={11}
        fill="var(--color-text)"
      >
        {name}
      </text>
    )
  }
}

export function MetricsChart({
  points,
  height = 300,
}: {
  readonly points: readonly MetricPoint[]
  readonly height?: number
}) {
  const labels = metricLabelsOf(points)
  // 利用者が切り替えた線だけを覚える。それ以外は既定(クラス数で決まる)に従うので、
  // 学習中にクラス数が分かっても、既定の表示が正しく決まる
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({})

  const classIndexes = Array.from({ length: labels.classCount }, (_, index) => index)
  const series: readonly Series[] = [
    {
      key: MAIN_KEY,
      name: labels.main,
      shortName: labels.main,
      color: 'var(--color-text)',
      dash: undefined,
      width: 3,
    },
    ...classIndexes.map((index) => ({
      key: classKey(index),
      name: `クラス ${index} の ${labels.perClass}`,
      shortName: `クラス ${index}`,
      color: seriesColor(index),
      dash: seriesDash(index),
      width: 1.5,
    })),
  ]
  const defaultVisible = (key: string) =>
    key === MAIN_KEY || labels.classCount <= DEFAULT_VISIBLE_CLASSES
  const isVisible = (key: string) => toggled[key] ?? defaultVisible(key)
  const setVisible = (keys: readonly string[], visible: boolean) =>
    setToggled((current) => ({
      ...current,
      ...Object.fromEntries(keys.map((key) => [key, visible])),
    }))
  const classKeys = classIndexes.map(classKey)

  const data = points.map((point) => ({
    epoch: point.epoch,
    [MAIN_KEY]: point.main,
    ...Object.fromEntries(
      classIndexes.map((index) => [classKey(index), point.perClass[index] ?? null]),
    ),
  }))
  const lastIndexOf = (key: string) =>
    data.findLastIndex((row) => typeof (row as Record<string, unknown>)[key] === 'number')

  return (
    <div>
      <fieldset className={styles.toggles}>
        <legend className={styles.legendTitle}>表示する線</legend>
        {series.map((item) => (
          <label key={item.key} className={styles.toggle}>
            <input
              type="checkbox"
              checked={isVisible(item.key)}
              onChange={(event) => setVisible([item.key], event.target.checked)}
            />
            <svg width="20" height="10" aria-hidden="true">
              <line
                x1="0"
                y1="5"
                x2="20"
                y2="5"
                stroke={item.color}
                strokeWidth={item.width}
                strokeDasharray={item.dash}
              />
            </svg>
            {item.name}
          </label>
        ))}
        {labels.classCount > 0 && (
          <span className={styles.bulk}>
            <button type="button" onClick={() => setVisible(classKeys, true)}>
              クラスをすべて表示
            </button>
            <button type="button" onClick={() => setVisible(classKeys, false)}>
              クラスをすべて隠す
            </button>
          </span>
        )}
      </fieldset>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 72, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-border)" />
          <XAxis dataKey="epoch" allowDecimals={false} stroke="var(--color-text-muted)" />
          <YAxis
            domain={[0, 1]}
            ticks={[0, 0.2, 0.4, 0.6, 0.8, 1]}
            stroke="var(--color-text-muted)"
          />
          <Tooltip formatter={formatValue} />
          {series
            .filter((item) => isVisible(item.key))
            .map((item) => (
              <Line
                key={item.key}
                dataKey={item.key}
                name={item.name}
                stroke={item.color}
                strokeWidth={item.width}
                strokeDasharray={item.dash}
                dot={data.length <= MAX_POINTS_WITH_DOTS}
                label={endLabel(item.shortName, lastIndexOf(item.key))}
                isAnimationActive={false}
              />
            ))}
        </LineChart>
      </ResponsiveContainer>
      {labels.main === 'mIoU' && (
        <p className={styles.note}>
          mIoU は、背景(クラス 0)と検証データに現れないクラスを除いた IoU の平均です。
          そのため、クラスごとの線の平均とは一致しないことがあります。値がないクラス(NaN)は線を切っています。
        </p>
      )}
    </div>
  )
}
