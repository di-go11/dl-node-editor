import { useId, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { LearningRatePoint } from '../../../entity/training/progress'

/**
 * エポックごとの学習率の折れ線グラフ(issue「学習の安定化」の段階 3c)。
 *
 *   - 横軸はエポック(LossChart とそろえる)。値は学習エンジンが optimizer から読んだ実際の学習率
 *   - 縦軸は対数目盛にできる(既定は対数)。step は 1e-4 → 1e-5 → 1e-6 と桁で変わるので、
 *     普通の目盛りだと後半が 0 に張り付いて見えない
 *   - 学習率が分からないエポック(null)は線を切る
 *   - 対数目盛では 0 以下を描けない(poly の最後のバッチは 0 になる)。その点は線を切って描かない
 *   - 受信のたびに描き直すので、線のアニメーションは切る(LossChart と同じ)
 *
 * 学習の記録の画面(モデル一覧から開く)でも同じ部品を使う。
 */
export function LearningRateChart({
  points,
  height = 240,
}: {
  readonly points: readonly LearningRatePoint[]
  readonly height?: number
}) {
  const [logScale, setLogScale] = useState(true)
  const toggleId = useId()

  const data = points.map((point) => ({
    epoch: point.epoch,
    learningRate:
      point.learningRate === null || (logScale && point.learningRate <= 0)
        ? null
        : point.learningRate,
  }))

  return (
    <div>
      <label htmlFor={toggleId}>
        <input
          id={toggleId}
          type="checkbox"
          checked={logScale}
          onChange={(event) => setLogScale(event.target.checked)}
        />
        学習率の縦軸を対数目盛にする
      </label>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <CartesianGrid stroke="var(--color-border)" />
          <XAxis dataKey="epoch" allowDecimals={false} stroke="var(--color-text-muted)" />
          <YAxis
            scale={logScale ? 'log' : 'auto'}
            domain={logScale ? ['auto', 'auto'] : [0, 'auto']}
            allowDataOverflow={logScale}
            tickFormatter={(value: number) => value.toExponential(0)}
            stroke="var(--color-text-muted)"
            width={64}
          />
          <Tooltip formatter={(value) => (typeof value === 'number' ? value.toExponential(3) : value)} />
          <Line
            dataKey="learningRate"
            name="learning_rate"
            stroke="var(--color-accent)"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
