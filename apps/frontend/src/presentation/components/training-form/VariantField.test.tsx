import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import type { ImageTaskKind } from '../../../entity/training/data-spec'
import { IMAGE_TASK_TYPES } from '../../../entity/training/data-spec'
import type { Variant } from '../../../entity/training/variant'
import { defaultVariant } from '../../../entity/training/variant'

import { VariantField } from './VariantField'

/**
 * バリアントの入力欄のテスト。enabledBy を持つパラメータ(無視する色の R/G/B)が、
 * 対応するチェックボックスがオンのときだけ出ることを確かめる。
 */

function Harness() {
  const [variant, setVariant] = useState<Variant<ImageTaskKind>>(
    defaultVariant(IMAGE_TASK_TYPES, 'segmentation'),
  )
  return (
    <VariantField
      legend="タスク"
      name="task_specs"
      catalog={IMAGE_TASK_TYPES}
      variant={variant}
      onChange={setVariant}
    />
  )
}

describe('VariantField', () => {
  it('無視する色がオンのときだけ R/G/B の入力欄を出す', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const toggle = screen.getByRole('checkbox', { name: /無視する色を指定する/ })
    // 既定はオンで、Pascal VOC の void(224, 224, 192)が入っている
    expect(toggle).toBeChecked()
    expect(screen.getByRole('textbox', { name: /無視する色の R/ })).toHaveValue('224')
    expect(screen.getByRole('textbox', { name: /無視する色の B/ })).toHaveValue('192')

    await user.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(screen.queryByRole('textbox', { name: /無視する色の R/ })).not.toBeInTheDocument()
    // 無視するラベル値は、色の指定とは関係なく常に出す
    expect(screen.getByRole('textbox', { name: /無視するラベル値/ })).toBeInTheDocument()

    // オンに戻すと、前の値のまま出る
    await user.click(toggle)
    expect(screen.getByRole('textbox', { name: /無視する色の G/ })).toHaveValue('224')
  })
})
