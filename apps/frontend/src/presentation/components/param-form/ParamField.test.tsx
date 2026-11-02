import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ParamValue } from '../../../entity/model-graph/node-spec'
import { activationType, batchNormType, conv2dType } from '../../../entity/node-catalog/entries'
import type { ParamDef } from '../../../entity/param/param-def'

import { ParamField } from './ParamField'

/**
 * ストアの代わりに、値を state に持つだけの親で包んで描く。
 * ParamField は「受け取った値を表示し、確定した値を onCommit で返す」だけの部品なので、
 * これで実際の使われ方(親が値を持ち、書き換えて渡し直す)を再現できる。
 */
function Harness({
  def,
  initial,
  onCommit,
}: {
  readonly def: ParamDef
  readonly initial: ParamValue
  readonly onCommit?: (value: ParamValue) => void
}) {
  const [value, setValue] = useState<ParamValue>(initial)
  return (
    <ParamField
      name="p"
      def={def}
      value={value}
      onCommit={(next) => {
        setValue(next)
        onCommit?.(next)
      }}
    />
  )
}

describe('ParamField - 数値', () => {
  it('カタログの表示名・JSON の名前・制約を表示する', () => {
    render(<Harness def={conv2dType.params.kernel_size} initial={3} />)
    expect(screen.getByLabelText(/カーネルサイズ/)).toHaveValue('3')
    expect(screen.getByText('1 以上')).toBeInTheDocument()
    // help(カタログの説明)を下に出す
    expect(screen.getByText(/一度に見る範囲/)).toBeInTheDocument()
  })

  it('数値として読めた入力だけを、その場で確定する', async () => {
    const onCommit = vi.fn()
    render(<Harness def={conv2dType.params.out_channels} initial={64} onCommit={onCommit} />)
    const input = screen.getByLabelText(/出力チャンネル数/)
    await userEvent.clear(input)
    await userEvent.type(input, '128')
    // 空欄の間は確定しない(NaN をドメインに入れない)。1 → 12 → 128 と確定していく
    expect(onCommit.mock.calls.map(([value]) => value as number)).toEqual([1, 12, 128])
  })

  it('入力途中の「1e-」は確定せず、読めないことを表示する', async () => {
    const onCommit = vi.fn()
    render(<Harness def={batchNormType.params.eps} initial={1e-5} onCommit={onCommit} />)
    const input = screen.getByLabelText(/ε|eps/)
    await userEvent.clear(input)
    await userEvent.type(input, '1e-')
    expect(screen.getByText('数値として読めません。')).toBeInTheDocument()
    await userEvent.type(input, '3')
    expect(onCommit).toHaveBeenLastCalledWith(1e-3)
  })

  it('制約違反は、欄の下にすぐ表示する(値は確定する)', async () => {
    const onCommit = vi.fn()
    render(<Harness def={conv2dType.params.kernel_size} initial={3} onCommit={onCommit} />)
    const input = screen.getByLabelText(/カーネルサイズ/)
    await userEvent.clear(input)
    await userEvent.type(input, '0')
    expect(onCommit).toHaveBeenLastCalledWith(0)
    expect(screen.getByText('整数(1 以上)にしてください。')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('フォーカスを外すと、入力途中の文字列を捨てて確定済みの値の表示に戻す', async () => {
    render(<Harness def={conv2dType.params.stride} initial={2} />)
    const input = screen.getByLabelText(/ストライド/)
    await userEvent.clear(input)
    await userEvent.tab()
    expect(input).toHaveValue('2')
  })
})

describe('ParamField - 列挙と真偽値', () => {
  it('enum はカタログの選択肢のセレクトになり、proto の名前で確定する', async () => {
    const onCommit = vi.fn()
    render(
      <Harness
        def={activationType.params.activation_type}
        initial="ACTIVATION_TYPE_RELU"
        onCommit={onCommit}
      />,
    )
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Sigmoid')
    expect(onCommit).toHaveBeenCalledWith('ACTIVATION_TYPE_SIGMOID')
  })

  it('bool はチェックボックスになる', async () => {
    const onCommit = vi.fn()
    const def: ParamDef = { kind: 'bool', label: 'バイアス', default: true }
    render(<Harness def={def} initial={true} onCommit={onCommit} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /バイアス/ }))
    expect(onCommit).toHaveBeenCalledWith(false)
  })
})
