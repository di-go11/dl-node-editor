import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'

import { apiError, apiOk } from '../../../application/ports/api-result'
import type { ApiResult } from '../../../application/ports/api-result'
import type { Capabilities } from '../../../entity/capabilities/capabilities'
import { defaultNodeCatalog } from '../../../entity/node-catalog/entries'
import type { Dependencies } from '../../app/dependencies'
import { DependenciesContext } from '../../app/dependencies'
import { createEditorStore } from '../../stores/editor-store'
import { EditorStoreContext } from '../../stores/editor-store-context'
import { fakeDependencies } from '../../test-utils/fake-dependencies'

import { Header } from './Header'

/**
 * ヘッダのテスト。capabilities API は偽物を Context で渡す(DI)。
 * 本物の通信をせずに、GPU あり / CPU のみ / 取得失敗の 3 通りの表示を確かめられる。
 */

function renderHeader(capabilities: ApiResult<Capabilities>) {
  const store = createEditorStore({ catalog: defaultNodeCatalog })
  const dependencies: Dependencies = fakeDependencies({
    capabilitiesApi: { getCapabilities: () => Promise.resolve(capabilities) },
  })
  render(
    <DependenciesContext value={dependencies}>
      <EditorStoreContext value={store}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<Header />} />
            <Route path="/training" element={<h1>学習設定</h1>} />
            <Route path="/resume" element={<h1>学習再開</h1>} />
          </Routes>
        </MemoryRouter>
      </EditorStoreContext>
    </DependenciesContext>,
  )
  return { store }
}

const gpuCapabilities: Capabilities = {
  cudaAvailable: true,
  devices: [
    { name: 'CPU', index: 0, type: 'cpu' },
    { name: 'RTX 4070', index: 0, type: 'cuda' },
  ],
}

describe('Header - デバイス表示', () => {
  it('GPU があれば「CUDA ✓ (cuda:0)」', async () => {
    renderHeader(apiOk(gpuCapabilities))
    expect(await screen.findByText('デバイス: CUDA ✓ (cuda:0)')).toHaveAttribute(
      'title',
      'RTX 4070',
    )
  })

  it('GPU がなければ「CPU のみ」', async () => {
    renderHeader(apiOk({ cudaAvailable: false, devices: [{ name: 'CPU', index: 0, type: 'cpu' }] }))
    expect(await screen.findByText('デバイス: CPU のみ(CUDA なし)')).toBeInTheDocument()
  })

  it('取得できなくても画面は止めず、理由をツールチップに出す', async () => {
    renderHeader(apiError({ kind: 'http', status: 502, message: '学習エンジンに接続できません' }))
    expect(await screen.findByText('デバイス: 取得できません')).toHaveAttribute(
      'title',
      '学習エンジンに接続できません',
    )
  })
})

describe('Header - 条件の選択', () => {
  it('データ形式を切り替えると、ストアの条件が変わる', async () => {
    const { store } = renderHeader(apiOk(gpuCapabilities))
    await userEvent.selectOptions(screen.getByLabelText('データ形式'), '1d')
    expect(store.getState().document.context).toEqual({ dataDim: '1d', method: 'cnn' })
  })

  it('未実装の選択肢も選べるが、「近日実装予定」と分かる', () => {
    renderHeader(apiOk(gpuCapabilities))
    expect(screen.getByRole('option', { name: '1D(近日実装予定)' })).toBeEnabled()
    expect(screen.getByRole('option', { name: 'Transformer(近日実装予定)' })).toBeEnabled()
  })
})

describe('Header - ボタン', () => {
  it('保存 / 読込を押せる', () => {
    renderHeader(apiOk(gpuCapabilities))
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '読込' })).toBeEnabled()
  })

  it('[学習開始] で学習設定画面へ移る', async () => {
    renderHeader(apiOk(gpuCapabilities))
    await userEvent.click(screen.getByRole('button', { name: '学習開始' }))
    expect(await screen.findByRole('heading', { name: '学習設定' })).toBeInTheDocument()
  })

  it('[学習再開] で学習再開の一覧へ移る', async () => {
    renderHeader(apiOk(gpuCapabilities))
    await userEvent.click(screen.getByRole('button', { name: '学習再開' }))
    expect(await screen.findByRole('heading', { name: '学習再開' })).toBeInTheDocument()
  })
})
