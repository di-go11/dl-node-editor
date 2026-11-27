import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ConfusionMatrixTable } from './ConfusionMatrixTable'

// 行 = 正解、列 = 予測
const matrix = [
  [900, 100],
  [300, 700],
]

const renderTable = () =>
  render(<ConfusionMatrixTable matrix={matrix} caption="検証データ・エポック 3" />)
const table = () => screen.getByRole('table', { name: '検証データ・エポック 3' })
/** 正解クラス i の行(見出し行の次から) */
const row = (trueClass: number) => within(table()).getAllByRole('row')[trueClass + 1]!

describe('ConfusionMatrixTable', () => {
  it('行見出し(正解)・列見出し(予測)と、正解ごとの割合を既定で出す', () => {
    renderTable()
    expect(within(table()).getAllByRole('columnheader', { name: /^クラス \d$/ })).toHaveLength(2)
    expect(within(table()).getAllByRole('rowheader', { name: /^クラス \d$/ })).toHaveLength(2)
    expect(screen.getByRole('radio', { name: '正解ごとの割合' })).toBeChecked()
    // 対角は再現率: クラス 1 の画素 1,000 のうち 700 を正しく予測
    expect(row(1)).toHaveTextContent('30.0 %70.0 %')
    // 画素の割合: クラス 1 は全体 2,000 のうち 1,000
    expect(within(row(1)).getAllByRole('cell').at(-1)).toHaveTextContent('50.0 %')
  })

  it('予測ごとの割合に切り替えると、対角が適合率になる', async () => {
    renderTable()
    await userEvent.click(screen.getByRole('radio', { name: '予測ごとの割合' }))
    // クラス 0 と予測した 1,200 画素のうち 900 が正解もクラス 0
    expect(within(row(0)).getAllByRole('cell')[0]).toHaveTextContent('75.0 %')
    expect(within(row(1)).getAllByRole('cell')[0]).toHaveTextContent('25.0 %')
  })

  it('画素数に切り替えると、画素数そのものを出す', async () => {
    renderTable()
    await userEvent.click(screen.getByRole('radio', { name: '画素数' }))
    expect(row(0)).toHaveTextContent('900100')
    expect(screen.getByText(/画素数そのもの/)).toBeInTheDocument()
  })

  it('合計が 0 の行(検証データに現れないクラス)の割合は — と出す', () => {
    render(
      <ConfusionMatrixTable
        matrix={[
          [5, 0],
          [0, 0],
        ]}
        caption="検証データ・エポック 1"
      />,
    )
    const cells = within(within(screen.getByRole('table')).getAllByRole('row')[2]!).getAllByRole(
      'cell',
    )
    expect(cells.slice(0, 2).map((cell) => cell.textContent)).toEqual(['—', '—'])
    expect(cells.at(-1)).toHaveTextContent('0.0 %')
  })
})
