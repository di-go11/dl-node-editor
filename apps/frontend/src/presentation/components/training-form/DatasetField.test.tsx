import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { FAKE_DATASETS } from '../../test-utils/fake-dependencies'

import type { DatasetFieldProps } from './DatasetField'
import { DatasetField } from './DatasetField'

/**
 * データセットの選択欄のテスト。一覧の状態(読み込み中・取得済み・0 件・失敗)ごとの表示と、
 * 選んだときに ID が渡ることを確かめる。
 */

function renderField(props: Partial<DatasetFieldProps> = {}) {
  const onChange = vi.fn<(datasetId: string) => void>()
  const onReload = vi.fn<() => void>()
  render(
    <DatasetField
      value=""
      onChange={onChange}
      datasets={{ status: 'ready', datasets: FAKE_DATASETS }}
      onReload={onReload}
      messages={[]}
      {...props}
    />,
  )
  return { onChange, onReload, select: screen.getByRole('combobox', { name: /データセット/ }) }
}

describe('DatasetField', () => {
  it('一覧から選ぶと、そのデータセットの ID を渡す', async () => {
    const { onChange, select } = renderField()
    const dataset = FAKE_DATASETS[0]
    if (dataset === undefined) throw new Error('偽物のデータセットがありません')

    // 選択肢には名前と形式を出す(パスは出さない)
    const option = within(select).getByRole('option', { name: new RegExp(dataset.name) })
    expect(option).toHaveTextContent(dataset.type)

    await userEvent.selectOptions(select, dataset.datasetId)
    expect(onChange).toHaveBeenCalledWith(dataset.datasetId)
  })

  it('読み込み中は選べない', () => {
    const { select } = renderField({ datasets: { status: 'loading' } })
    expect(select).toBeDisabled()
    expect(select).toHaveTextContent('読み込み中')
  })

  it('取得に失敗したら理由を出し、再読み込みできる', async () => {
    const { onReload } = renderField({
      datasets: { status: 'error', message: 'サーバーに接続できません' },
    })
    expect(screen.getByText(/サーバーに接続できません/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '再読み込み' }))
    expect(onReload).toHaveBeenCalledOnce()
  })

  it('0 件なら、先にアップロードするよう案内する', () => {
    const { select } = renderField({ datasets: { status: 'ready', datasets: [] } })
    expect(select).toBeDisabled()
    expect(screen.getByText(/先にデータセットをアップロードしてください/)).toBeInTheDocument()
  })

  it('選んでいた ID が一覧になければ(削除済み)、選び直すよう知らせる', () => {
    const { select } = renderField({ value: 'deleted-dataset' })
    expect(select).toHaveValue('deleted-dataset')
    expect(screen.getByText(/選び直してください/)).toBeInTheDocument()
  })

  it('検証の結果(未選択など)を出す', () => {
    renderField({ messages: ['データセットを選んでください。'] })
    expect(screen.getByText('データセットを選んでください。')).toBeInTheDocument()
  })
})
