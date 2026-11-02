import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { apiError, apiOk } from '../../application/ports/api-result'
import type { CapabilitiesApi } from '../../application/ports/capabilities-api'
import type { NodeCatalogSource } from '../../application/ports/node-catalog-source'
import { defaultNodeCatalog } from '../../entity/node-catalog/entries'

import { AppRoutes } from './AppRoutes'
import type { Dependencies } from './dependencies'
import { DependenciesContext } from './dependencies'
import { fakeDependencies } from '../test-utils/fake-dependencies'

/**
 * ルーティングと、依存性注入(DI)の配線のテスト。
 *
 * ポートの偽物(フェイク)を Context に渡している。画面は Context から受け取った
 * 実装を使うだけなので、HTTP も MSW も起動せずに「カタログの読み込みに失敗したら
 * どう表示されるか」まで確かめられる。これが DI の利点である。
 */

const fakeCapabilitiesApi: CapabilitiesApi = {
  getCapabilities: () => Promise.resolve(apiOk({ cudaAvailable: false, devices: [] })),
}

const catalogSource = (ok: boolean): NodeCatalogSource => ({
  load: () =>
    Promise.resolve(
      ok
        ? apiOk(defaultNodeCatalog)
        : apiError({ kind: 'network', message: 'サーバーに接続できません' }),
    ),
})

function renderAt(path: string, dependencies: Partial<Dependencies> = {}) {
  const value: Dependencies = fakeDependencies({
    nodeCatalogSource: catalogSource(true),
    capabilitiesApi: fakeCapabilitiesApi,
    ...dependencies,
  })
  return render(
    <DependenciesContext value={value}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </DependenciesContext>,
  )
}

describe('AppRoutes', () => {
  it('カタログを読み込んでから、エディタ画面を出す', async () => {
    renderAt('/')
    // 読み込みは非同期なので、最初は読み込み中の表示になる
    expect(screen.getByRole('status')).toHaveTextContent('読み込んでいます')
    // エディタ画面の 4 つの領域が並ぶ
    expect(await screen.findByRole('main', { name: 'ノードエディタ' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'ノードの一覧' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'ログ' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'プロパティパネル' })).toBeInTheDocument()
  })

  it('カタログを読み込めなければ、理由を出す', async () => {
    renderAt('/', { nodeCatalogSource: catalogSource(false) })
    expect(await screen.findByRole('alert')).toHaveTextContent('サーバーに接続できません')
  })

  it('/training は学習設定画面(仮置き)', async () => {
    renderAt('/training')
    expect(await screen.findByRole('heading', { name: '学習設定' })).toBeInTheDocument()
  })

  it('/progress/:jobId は進捗画面', async () => {
    renderAt('/progress/job-1')
    expect(await screen.findByRole('heading', { name: '進捗' })).toBeInTheDocument()
  })

  it('知らないパスでは「見つかりません」と、エディタへのリンクを出す', async () => {
    renderAt('/nowhere')
    expect(
      await screen.findByRole('heading', { name: 'ページが見つかりません' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'エディタに戻る' })).toHaveAttribute('href', '/')
  })
})
