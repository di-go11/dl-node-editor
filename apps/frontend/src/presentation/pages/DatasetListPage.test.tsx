import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { apiError, apiOk } from '../../application/ports/api-result'
import type { DatasetApi } from '../../application/ports/dataset-api'
import type { DatasetSummary } from '../../entity/dataset/dataset'
import { DependenciesContext } from '../app/dependencies'
import { FAKE_DATASETS, fakeDependencies } from '../test-utils/fake-dependencies'

import { DatasetListPage } from './DatasetListPage'

/**
 * データセット一覧画面(/datasets)を、偽物の DatasetApi で描いて確かめる。
 *   - 登録済みのデータセットを並べる(0 件・取得失敗の表示も)
 *   - [+ 追加] で zip を選んでアップロードすると、一覧を取得し直す
 *   - アップロードに失敗したら理由を出し、フォームは残す
 */

function renderPage(api: Partial<DatasetApi> = {}) {
  const list = vi.fn<DatasetApi['list']>(() => Promise.resolve(apiOk(FAKE_DATASETS)))
  const upload = vi.fn<DatasetApi['upload']>(() => Promise.resolve(apiOk(null)))
  const datasetApi: DatasetApi = { list, upload, ...api }
  render(
    <DependenciesContext value={fakeDependencies({ datasetApi })}>
      <MemoryRouter initialEntries={['/datasets']}>
        <Routes>
          <Route path="/datasets" element={<DatasetListPage />} />
          <Route path="/" element={<h1>エディタ</h1>} />
        </Routes>
      </MemoryRouter>
    </DependenciesContext>,
  )
  return { list, upload }
}

const addButton = () => screen.getByRole('button', { name: '+ 追加' })
const uploadButton = () => screen.getByRole('button', { name: 'アップロード' })
const zipFile = (name = 'voc2012.zip') => new File(['zip-bytes'], name, { type: 'application/zip' })

describe('データセットの一覧', () => {
  it('登録済みのデータセットを、名前・形式・登録日時で並べる', async () => {
    renderPage()
    const table = await screen.findByRole('table', { name: 'データセット' })
    expect(table).toHaveTextContent('VOC2012')
    // 形式は表示名にする
    expect(table).toHaveTextContent('Pascal VOC')
  })

  it('0 件なら、[+ 追加] からアップロードするよう案内する', async () => {
    renderPage({ list: () => Promise.resolve(apiOk([])) })
    expect(await screen.findByText(/データセットはまだありません/)).toBeInTheDocument()
  })

  it('取得に失敗したら理由を出す', async () => {
    renderPage({
      list: () =>
        Promise.resolve(apiError({ kind: 'network', message: 'サーバーに接続できません' })),
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('サーバーに接続できません')
  })
})

describe('データセットの追加', () => {
  it('zip を選ぶと名前の初期値が入り、アップロードすると一覧を取得し直す', async () => {
    const added: DatasetSummary = {
      datasetId: 'dataset-new',
      name: 'voc2012',
      type: 'pascal_voc',
      createdAt: '2026-11-17T00:00:00Z',
    }
    const list = vi
      .fn<DatasetApi['list']>()
      .mockResolvedValueOnce(apiOk(FAKE_DATASETS))
      .mockResolvedValue(apiOk([...FAKE_DATASETS, added]))
    const { upload } = renderPage({ list })
    await screen.findByRole('table', { name: 'データセット' })

    await userEvent.click(addButton())
    const form = screen.getByRole('form', { name: 'データセットの追加' })
    await userEvent.upload(within(form).getByLabelText('zip ファイル'), zipFile())
    expect(within(form).getByLabelText('名前')).toHaveValue('voc2012')
    await userEvent.click(uploadButton())

    expect(upload).toHaveBeenCalledOnce()
    expect(upload.mock.calls[0]?.[0]).toMatchObject({
      fileName: 'voc2012.zip',
      name: 'voc2012',
      type: 'pascal_voc',
    })
    expect(await screen.findByText('「voc2012」を追加しました。')).toBeInTheDocument()
    // 追加した後は一覧を取得し直し、フォームを閉じる
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(FAKE_DATASETS.length + 2))
    expect(list).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('form', { name: 'データセットの追加' })).not.toBeInTheDocument()
  })

  it('名前は変えられる', async () => {
    const { upload } = renderPage()
    await userEvent.click(addButton())
    await userEvent.upload(screen.getByLabelText('zip ファイル'), zipFile())
    await userEvent.clear(screen.getByLabelText('名前'))
    await userEvent.type(screen.getByLabelText('名前'), 'my-voc')
    await userEvent.click(uploadButton())

    expect(upload.mock.calls[0]?.[0]).toMatchObject({ name: 'my-voc' })
  })

  it('形式を Original にすると、labelmap.txt が必要と案内し、original で送る', async () => {
    const { upload } = renderPage()
    await userEvent.click(addButton())
    const form = screen.getByRole('form', { name: 'データセットの追加' })
    expect(within(form).queryByText(/labelmap\.txt$/)).not.toBeInTheDocument()

    await userEvent.selectOptions(within(form).getByLabelText('形式'), 'original')
    expect(within(form).getByText(/必要なもの: .*、labelmap\.txt$/)).toBeInTheDocument()

    await userEvent.upload(within(form).getByLabelText('zip ファイル'), zipFile())
    await userEvent.click(uploadButton())
    expect(upload.mock.calls[0]?.[0]).toMatchObject({ type: 'original' })
  })

  it('zip を選ぶまで、名前が空なら、アップロードできない', async () => {
    renderPage()
    await userEvent.click(addButton())
    expect(uploadButton()).toBeDisabled()

    await userEvent.upload(screen.getByLabelText('zip ファイル'), zipFile())
    await userEvent.clear(screen.getByLabelText('名前'))
    expect(uploadButton()).toBeDisabled()
  })

  it('zip 以外のファイルは送らない', async () => {
    renderPage()
    await userEvent.click(addButton())
    // accept の指定をすり抜けたファイル(すべてのファイルを表示して選んだ場合など)
    await userEvent.upload(screen.getByLabelText('zip ファイル'), zipFile('voc2012.tar'), {
      applyAccept: false,
    })
    expect(screen.getByText('zip ファイルを選んでください。')).toBeInTheDocument()
    expect(uploadButton()).toBeDisabled()
  })

  it('アップロードに失敗したら理由を出し、フォームは残す(直して送り直せる)', async () => {
    renderPage({
      upload: () =>
        Promise.resolve(apiError({ kind: 'http', status: 413, message: 'ファイルが大きすぎます' })),
    })
    await userEvent.click(addButton())
    await userEvent.upload(screen.getByLabelText('zip ファイル'), zipFile())
    await userEvent.click(uploadButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('ファイルが大きすぎます')
    expect(screen.getByRole('form', { name: 'データセットの追加' })).toBeInTheDocument()
    expect(uploadButton()).toBeEnabled()
  })

  it('キャンセルでフォームを閉じる', async () => {
    renderPage()
    await userEvent.click(addButton())
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('form', { name: 'データセットの追加' })).not.toBeInTheDocument()
  })
})
