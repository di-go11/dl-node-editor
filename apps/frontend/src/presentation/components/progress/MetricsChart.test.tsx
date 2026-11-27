import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { cloneElement, isValidElement } from 'react'
import type { ReactNode } from 'react'
import type * as Recharts from 'recharts'
import { describe, expect, it, vi } from 'vitest'

import type { MetricPoint } from '../../../entity/training/metric-points'

import { MetricsChart } from './MetricsChart'

/*
 * jsdom はレイアウトを計算しないので、ResponsiveContainer は幅 0 を測り、グラフを描かない。
 * 線の数やラベルを確かめるため、テストでは決まった大きさで描く入れ物に差し替える。
 */
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof Recharts>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { readonly children: ReactNode }) =>
      isValidElement<{ width?: number; height?: number }>(children)
        ? cloneElement(children, { width: 800, height: 300 })
        : children,
  }
})

const segPoint = (epoch: number, perClass: readonly (number | null)[]): MetricPoint => ({
  epoch,
  kind: 'segmentation',
  main: 0.5,
  perClass,
})

const lines = (container: HTMLElement) => container.querySelectorAll('.recharts-line')
const checkbox = (name: string) => screen.getByRole('checkbox', { name })

describe('MetricsChart', () => {
  it('凡例(線の切り替え)に mIoU とクラスの数だけ項目が出る', () => {
    render(<MetricsChart points={[segPoint(1, [0.9, 0.4, 0.2]), segPoint(2, [0.95, 0.5, 0.3])]} />)
    expect(checkbox('mIoU')).toBeChecked()
    for (const index of [0, 1, 2]) expect(checkbox(`クラス ${index} の IoU`)).toBeChecked()
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
  })

  it('チェックを外すとその線が消え、戻すと出る', async () => {
    const { container } = render(
      <MetricsChart points={[segPoint(1, [0.9, 0.4]), segPoint(2, [0.95, 0.5])]} />,
    )
    expect(lines(container)).toHaveLength(3)

    await userEvent.click(checkbox('クラス 1 の IoU'))
    expect(lines(container)).toHaveLength(2)
    expect(checkbox('クラス 1 の IoU')).not.toBeChecked()

    await userEvent.click(checkbox('クラス 1 の IoU'))
    expect(lines(container)).toHaveLength(3)
  })

  it('クラスが 8 より多いときは、最初は mIoU だけを出す。まとめて表示できる', async () => {
    const perClass = Array.from({ length: 21 }, (_, index) => index / 21)
    const { container } = render(
      <MetricsChart points={[segPoint(1, perClass), segPoint(2, perClass)]} />,
    )
    expect(lines(container)).toHaveLength(1)
    expect(checkbox('mIoU')).toBeChecked()
    expect(checkbox('クラス 20 の IoU')).not.toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: 'クラスをすべて表示' }))
    expect(lines(container)).toHaveLength(22)
    await userEvent.click(screen.getByRole('button', { name: 'クラスをすべて隠す' }))
    expect(lines(container)).toHaveLength(1)
  })

  it('下の凡例に、表示している線だけを出す(loss のグラフと同じ)', async () => {
    const { container } = render(
      <MetricsChart points={[segPoint(1, [0.9, 0.4]), segPoint(2, [0.95, 0.5])]} />,
    )
    const legendNames = () =>
      Array.from(container.querySelectorAll('.recharts-legend-item-text')).map(
        (text) => text.textContent,
      )
    expect(legendNames()).toEqual(['mIoU', 'クラス 0 の IoU', 'クラス 1 の IoU'])

    await userEvent.click(checkbox('クラス 0 の IoU'))
    expect(legendNames()).toEqual(['mIoU', 'クラス 1 の IoU'])
  })

  it('線の終わりに名前を出す(色だけに頼らない)', () => {
    const { container } = render(
      <MetricsChart points={[segPoint(1, [0.9, 0.4]), segPoint(2, [0.95, null])]} />,
    )
    const names = Array.from(container.querySelectorAll('svg.recharts-surface text')).map(
      (text) => text.textContent,
    )
    expect(names).toEqual(expect.arrayContaining(['mIoU', 'クラス 0', 'クラス 1']))
  })

  it('segmentation では mIoU の計算に背景を含まないことを書く', () => {
    render(<MetricsChart points={[segPoint(1, [0.9])]} />)
    expect(screen.getByText(/背景\(クラス 0\)/)).toBeInTheDocument()
  })

  it('classification では accuracy とクラスごとの accuracy の名前になる', () => {
    render(
      <MetricsChart
        points={[{ epoch: 1, kind: 'classification', main: 0.8, perClass: [0.9, 0.7] }]}
      />,
    )
    expect(checkbox('accuracy')).toBeChecked()
    expect(checkbox('クラス 1 の accuracy')).toBeChecked()
    expect(screen.queryByText(/背景\(クラス 0\)/)).not.toBeInTheDocument()
  })
})
