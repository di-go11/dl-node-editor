import { useId, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { LossPoint } from '../../../entity/training/progress'

/**
 * train_loss / val_loss の折れ線グラフ(指示書 4.6)。
 *
 * loss が null の点(NaN や inf)は線を切る。つなぐと、値があったように見えてしまう。
 * 受信のたびに描き直すので、線のアニメーションは切っている。
 *
 * 縦軸は対数目盛に切り替えられる(既定は普通の目盛り)。val が一時的に大きく跳ねると、普通の目盛りでは
 * ほかのエポックが底に張り付いて見えなくなるため。対数目盛では 0 以下を描けないので、その点は線を切る
 * (MSE や Dice は 0 になりうる)。
 */
export function LossChart({ points }: { readonly points: readonly LossPoint[] }) {
  const [logScale, setLogScale] = useState(false)
  const toggleId = useId()

  // 対数目盛では 0 以下を null にして線を切る(log に渡すと軸の計算が壊れる)
  const positiveOrNull = (value: number | null) =>
    value === null || (logScale && value <= 0) ? null : value
  const data = points.map((point) => ({
    epoch: point.epoch,
    trainLoss: positiveOrNull(point.trainLoss),
    valLoss: positiveOrNull(point.valLoss),
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
        loss の縦軸を対数目盛にする
      </label>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data}>
          <CartesianGrid stroke="var(--color-border)" />
          <XAxis dataKey="epoch" allowDecimals={false} stroke="var(--color-text-muted)" />
          <YAxis
            scale={logScale ? 'log' : 'auto'}
            domain={logScale ? ['auto', 'auto'] : [0, 'auto']}
            allowDataOverflow={logScale}
            stroke="var(--color-text-muted)"
          />
          <Tooltip />
          <Legend />
          <Line
            dataKey="trainLoss"
            name="train_loss"
            stroke="var(--color-accent)"
            isAnimationActive={false}
          />
          <Line
            dataKey="valLoss"
            name="val_loss"
            stroke="var(--color-warning)"
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
