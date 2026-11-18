import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { apiError, apiOk } from '../../application/ports/api-result'
import type { TrainingApi } from '../../application/ports/training-api'
import { emptyEditorDocument } from '../../entity/document/document'
import type { ModelGraph } from '../../entity/model-graph/model-graph'
import { defaultNodeCatalog } from '../../entity/node-catalog/entries'
import { buildGraph, validSegnetGraph } from '../../entity/validation/test-fixtures'
import type { Dependencies } from '../app/dependencies'
import { DependenciesContext } from '../app/dependencies'
import { createEditorStore } from '../stores/editor-store'
import { EditorStoreContext } from '../stores/editor-store-context'
import { FAKE_DATASETS, fakeDependencies } from '../test-utils/fake-dependencies'

import { TrainingSettingsPage } from './TrainingSettingsPage'

/**
 * フェーズ 5 の完了条件の結合テスト:
 *   - チェックで NG なら実行できず、OK なら実行できる
 *   - チェックの後に何か変更すると、再チェックが必要になる
 *
 * 学習設定画面を、本物のストア・状態機械・ユースケースと、偽物のポート(学習開始など)で描き、
 * 利用者の操作から確かめる。
 */

function ProgressStub() {
  const { jobId } = useParams()
  return <h1>進捗 {jobId}</h1>
}

function renderSettings(
  options: { readonly graph?: ModelGraph; readonly dependencies?: Partial<Dependencies> } = {},
) {
  const store = createEditorStore({
    catalog: defaultNodeCatalog,
    initialDocument: {
      ...emptyEditorDocument('segnet'),
      graph: options.graph ?? validSegnetGraph(),
    },
  })
  render(
    <DependenciesContext value={fakeDependencies(options.dependencies)}>
      <EditorStoreContext value={store}>
        <MemoryRouter initialEntries={['/training']}>
          <Routes>
            <Route path="/" element={<h1>エディタ</h1>} />
            <Route path="/training" element={<TrainingSettingsPage />} />
            <Route path="/progress/:jobId" element={<ProgressStub />} />
          </Routes>
        </MemoryRouter>
      </EditorStoreContext>
    </DependenciesContext>,
  )
  return { store }
}

const runButton = () => screen.getByRole('button', { name: '学習実行' })
const checkButton = () => screen.getByRole('button', { name: '整合性チェック' })
const status = () => screen.getByRole('status')
const log = () => screen.getByRole('region', { name: 'ログ' })

/** 既定値に足りない 2 項目(データセットのパスとデバイス)を埋める */
async function fillRequiredFields() {
  // データセットの偽物は FAKE_DATASETS の 1 件。選択肢が出るまで待つ
  const dataset = await screen.findByRole('combobox', { name: /データセット/ })
  await waitFor(() => expect(dataset).toBeEnabled())
  await userEvent.selectOptions(dataset, FAKE_DATASETS[0]?.datasetId ?? '')
  // capabilities の偽物は CPU だけを返す。選択肢が出るまで待つ
  const device = await screen.findByRole('combobox', { name: /デバイス/ })
  await waitFor(() => expect(within(device).getByRole('option', { name: 'cpu' })).toBeVisible())
  await userEvent.selectOptions(device, 'cpu')
}

async function checkAndWait() {
  await userEvent.click(checkButton())
  await waitFor(() => expect(status()).not.toHaveTextContent('チェック中'))
}

describe('学習設定画面 - 初めて開いたとき', () => {
  it('学習設定を既定値で作り、モデル名は文書の名前から取る', async () => {
    const { store } = renderSettings()
    expect(await screen.findByLabelText(/モデル名/)).toHaveValue('segnet')
    expect(store.getState().document.training?.optimizer.kind).toBe('adam')
    expect(runButton()).toBeDisabled()
    expect(status()).toHaveTextContent('未チェック')
  })
})

describe('整合性チェックと実行ボタン(フェーズ 5 の完了条件)', () => {
  it('チェックで NG なら、問題をログに出し、実行できない', async () => {
    renderSettings()
    await screen.findByLabelText(/モデル名/)
    await checkAndWait()

    expect(status()).toHaveTextContent('NG')
    expect(log()).toHaveTextContent('データセットを選んでください。')
    expect(log()).toHaveTextContent('デバイス を入力してください。')
    expect(runButton()).toBeDisabled()
  })

  it('問題を直してチェックが OK になれば、実行できる', async () => {
    renderSettings()
    await screen.findByLabelText(/モデル名/)
    await fillRequiredFields()
    await checkAndWait()

    expect(status()).toHaveTextContent('チェック済み')
    expect(runButton()).toBeEnabled()
  })

  it('チェックの後に何か変更すると、再チェックが必要になる', async () => {
    renderSettings()
    await screen.findByLabelText(/モデル名/)
    await fillRequiredFields()
    await checkAndWait()
    expect(runButton()).toBeEnabled()

    // エポック数を変える
    const epoch = screen.getByLabelText(/エポック数/)
    await userEvent.clear(epoch)
    await userEvent.type(epoch, '20')

    expect(runButton()).toBeDisabled()
    expect(status()).toHaveTextContent('未チェック')
    expect(log()).toHaveTextContent('この結果は古いので、もう一度チェックしてください')
  })

  it('エディタ側でグラフを変えても、再チェックが必要になる', async () => {
    const { store } = renderSettings()
    await screen.findByLabelText(/モデル名/)
    await fillRequiredFields()
    await checkAndWait()

    store.getState().addNode('linear', { x: 0, y: 0 })
    await waitFor(() => expect(runButton()).toBeDisabled())
  })

  it('モデル名がすでに使われていれば NG になり、実行できない', async () => {
    const validate = vi.fn<TrainingApi['validate']>(() =>
      Promise.resolve(apiOk({ kind: 'model-name-used' })),
    )
    renderSettings({
      dependencies: { trainingApi: { ...fakeDependencies().trainingApi, validate } },
    })
    await screen.findByLabelText(/モデル名/)
    await fillRequiredFields()
    await checkAndWait()

    expect(validate).toHaveBeenCalledOnce()
    expect(status()).toHaveTextContent('NG')
    expect(log()).toHaveTextContent('モデル名「segnet」はすでに使われています')
    expect(runButton()).toBeDisabled()
  })

  it('手元のチェックで NG なら、サーバーには問い合わせない', async () => {
    const validate = vi.fn<TrainingApi['validate']>(() => Promise.resolve(apiOk({ kind: 'ok' })))
    renderSettings({
      dependencies: { trainingApi: { ...fakeDependencies().trainingApi, validate } },
    })
    await screen.findByLabelText(/モデル名/)
    await checkAndWait()

    expect(status()).toHaveTextContent('NG')
    expect(validate).not.toHaveBeenCalled()
  })
})

describe('学習実行', () => {
  it('チェック済みの内容で学習を始め、進捗画面に移る', async () => {
    const start = vi.fn<TrainingApi['start']>(() =>
      Promise.resolve(apiOk({ jobId: 'job-42', status: 'running' })),
    )
    const { store } = renderSettings({
      dependencies: { trainingApi: { ...fakeDependencies().trainingApi, start } },
    })
    await screen.findByLabelText(/モデル名/)
    await fillRequiredFields()
    await checkAndWait()
    await userEvent.click(runButton())

    expect(await screen.findByRole('heading', { name: '進捗 job-42' })).toBeInTheDocument()
    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0]?.[1].datasetId).toBe(FAKE_DATASETS[0]?.datasetId)
    expect(store.getState().runState).toEqual({ kind: 'running', jobId: 'job-42' })
  })

  it('開始に失敗したら理由をログに出し、そのまま再実行できる', async () => {
    const start = vi.fn<TrainingApi['start']>(() =>
      Promise.resolve(
        apiError({ kind: 'http', status: 502, message: '学習エンジンに接続できません' }),
      ),
    )
    renderSettings({ dependencies: { trainingApi: { ...fakeDependencies().trainingApi, start } } })
    await screen.findByLabelText(/モデル名/)
    await fillRequiredFields()
    await checkAndWait()
    await userEvent.click(runButton())

    await waitFor(() => expect(log()).toHaveTextContent('学習エンジンに接続できません'))
    expect(runButton()).toBeEnabled()
  })
})

describe('ログ', () => {
  it('ノードの問題をクリックすると、エディタに移ってそのノードを表示する', async () => {
    // 入力がつながっていない Conv2D だけのグラフ
    const graph = buildGraph([{ id: 'conv1', kind: 'conv2d' }])
    const { store } = renderSettings({ graph })
    await screen.findByLabelText(/モデル名/)
    await checkAndWait()

    const link = within(log()).getAllByRole('button', { name: 'conv1' })[0]
    if (link === undefined) throw new Error('conv1 の問題がありません')
    await userEvent.click(link)

    expect(await screen.findByRole('heading', { name: 'エディタ' })).toBeInTheDocument()
    expect(store.getState().selection.nodeIds).toEqual(['conv1'])
    expect(store.getState().focusRequest).toEqual({ nodeId: 'conv1' })
  })
})

describe('loss とタスク(未決事項 1)', () => {
  it('今のタスクで使えない loss には印を付ける', async () => {
    renderSettings()
    await screen.findByLabelText(/モデル名/)
    expect(
      screen.getByRole('option', { name: 'MSE(このタスクでは使えません)' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'クラス分類(未対応)' })).toBeInTheDocument()
  })

  it('Dice を選ぶと、Output の直前に Softmax が要ることを案内し、チェックでは警告にとどめる', async () => {
    renderSettings()
    await screen.findByLabelText(/モデル名/)
    await fillRequiredFields()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'lossの種類' }), 'dice')
    expect(screen.getByText(/loss の中では softmax をかけないので/)).toBeInTheDocument()

    await checkAndWait()
    // SegNet の最後は Conv2D なので warning が出るが、実行は止めない
    expect(log()).toHaveTextContent('Softmax(dim = 1)の Activation を置いてください')
    expect(runButton()).toBeEnabled()
  })
})
