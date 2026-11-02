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
 */
export function LossChart({ points }: { readonly points: readonly LossPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={[...points]}>
        <CartesianGrid stroke="var(--color-border)" />
        <XAxis dataKey="epoch" allowDecimals={false} stroke="var(--color-text-muted)" />
        <YAxis stroke="var(--color-text-muted)" />
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
  )
}
