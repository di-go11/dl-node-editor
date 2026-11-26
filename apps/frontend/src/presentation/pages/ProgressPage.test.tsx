import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { apiError, apiOk } from '../../application/ports/api-result'
import type { ProgressListener, TrainingApi } from '../../application/ports/training-api'
import { emptyEditorDocument } from '../../entity/document/document'
import { defaultNodeCatalog } from '../../entity/node-catalog/entries'
import type { TrainingProgress } from '../../entity/training/progress'
import { DependenciesContext } from '../app/dependencies'
import { createEditorStore } from '../stores/editor-store'
import { EditorStoreContext } from '../stores/editor-store-context'
import { fakeDependencies } from '../test-utils/fake-dependencies'

import { ProgressPage } from './ProgressPage'

/**
 * フェーズ 6 の進捗画面を、偽物の TrainingApi で描いて確かめる。
 * 進捗はテストから listener を呼んで送る。
 */

const progress = (patch: Partial<TrainingProgress> = {}): TrainingProgress => ({
  epoch: 1,
  trainLoss: 0.5,
  valLoss: 0.6,
  status: 'running',
  metrics: null,
  epochElapsedMs: 1500,
  totalElapsedMs: 61000,
  errorMessage: null,
  learningRate: null,
  ...patch,
})

function renderProgress(api: Partial<TrainingApi> = {}) {
  let listener: ProgressListener | undefined
  const unsubscribe = vi.fn()
  const subscribeProgress = vi.fn<TrainingApi['subscribeProgress']>((_jobId, received) => {
    listener = received
    return unsubscribe
  })
  const stop = vi.fn<TrainingApi['stop']>(() => Promise.resolve(apiOk('running')))
  const store = createEditorStore({
    catalog: defaultNodeCatalog,
    initialDocument: emptyEditorDocument('segnet'),
  })
  store.getState().setRunState({ kind: 'running', jobId: 'job-1' })
  const defaults = fakeDependencies()
  const view = render(
    <DependenciesContext
      value={{
        ...defaults,
        trainingApi: { ...defaults.trainingApi, subscribeProgress, stop, ...api },
      }}
    >
      <EditorStoreContext value={store}>
        <MemoryRouter initialEntries={['/progress/job-1']}>
          <Routes>
            <Route path="/" element={<h1>エディタ</h1>} />
            <Route path="/progress/:jobId" element={<ProgressPage />} />
          </Routes>
        </MemoryRouter>
      </EditorStoreContext>
    </DependenciesContext>,
  )
  const send = (value: TrainingProgress) => {
    act(() => {
      listener?.onProgress(value)
    })
  }
  const sendProblem = (message: string, retrying: boolean) => {
    act(() => {
      listener?.onProblem({ message, retrying })
    })
  }
  return { view, store, subscribeProgress, unsubscribe, stop, send, sendProblem }
}

const status = () => screen.getByRole('status')
const stopButton = () => screen.queryByRole('button', { name: '停止' })
const backButton = () => screen.queryByRole('button', { name: 'エディタに戻る' })

describe('進捗の表示', () => {
  it('job_id の受信を始め、画面を離れると閉じる', () => {
    const { view, subscribeProgress, unsubscribe } = renderProgress()
    expect(subscribeProgress.mock.calls[0]?.[0]).toBe('job-1')
    expect(status()).toHaveTextContent('受信待ち')
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('epoch、loss、時間、状態を出す', () => {
    const { send } = renderProgress()
    send(progress({ epoch: 3 }))
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('0.5000')).toBeInTheDocument()
    expect(screen.getByText('0.6000')).toBeInTheDocument()
    expect(screen.getByText('1 秒')).toBeInTheDocument()
    expect(screen.getByText('1 分 1 秒')).toBeInTheDocument()
    expect(status()).toHaveTextContent('学習中')
  })

  it('loss の null(NaN や inf)は — と出す', () => {
    const { send } = renderProgress()
    send(progress({ trainLoss: null, valLoss: null }))
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('epoch 0 ではグラフを描かず、案内を出す', () => {
    const { send } = renderProgress()
    send(progress({ epoch: 0 }))
    expect(screen.getByText('最初のエポックが終わると表示します。')).toBeInTheDocument()
  })

  it('エポックが終わると案内が消える', () => {
    const { send } = renderProgress()
    send(progress({ epoch: 1 }))
    expect(screen.queryByText('最初のエポックが終わると表示します。')).not.toBeInTheDocument()
  })

  it('セグメンテーションのメトリクスとクラスごとの値を出す', () => {
    const { send } = renderProgress()
    send(
      progress({
        metrics: {
          kind: 'segmentation',
          pixelAcc: 0.91,
          miou: 0.71,
          fwIou: 0.81,
          meanClassAccuracy: 0.75,
          perClassIou: [0.92, 0.42],
        },
      }),
    )
    expect(screen.getByText('mIoU')).toBeInTheDocument()
    expect(screen.getByText('0.7100')).toBeInTheDocument()
    expect(screen.getByText('クラス 1')).toBeInTheDocument()
    expect(screen.getByText('0.4200')).toBeInTheDocument()
  })

  it('クラス分類のメトリクスを出す', () => {
    const { send } = renderProgress()
    send(
      progress({
        metrics: { kind: 'classification', accuracy: 0.81, macroF1: 0.72, perClassAccuracy: [1] },
      }),
    )
    expect(screen.getByText('macro_f1')).toBeInTheDocument()
    expect(screen.getByText('0.7200')).toBeInTheDocument()
  })
})

describe('学習の終了', () => {
  it.each([
    ['completed', '完了'],
    ['stopped', '停止'],
  ] as const)('%s なら戻るボタンを出し、状態機械を編集に戻す', async (value, label) => {
    const { store, send } = renderProgress()
    expect(backButton()).not.toBeInTheDocument()
    send(progress({ status: value }))

    expect(status()).toHaveTextContent(label)
    expect(stopButton()).not.toBeInTheDocument()
    expect(store.getState().runState.kind).toBe('editing')

    const back = backButton()
    if (back === null) throw new Error('戻るボタンがありません')
    await userEvent.click(back)
    expect(await screen.findByRole('heading', { name: 'エディタ' })).toBeInTheDocument()
  })

  it('failed なら原因を目立つ形で出す', () => {
    const { send } = renderProgress()
    send(progress({ status: 'failed', errorMessage: 'CUDA out of memory' }))
    expect(screen.getByRole('alert')).toHaveTextContent('CUDA out of memory')
    expect(backButton()).toBeInTheDocument()
  })
})

describe('停止', () => {
  it('stopped を受け取るまで「停止中」と出し、もう一度は押せない', async () => {
    const { stop, send } = renderProgress()
    send(progress())
    const button = stopButton()
    if (button === null) throw new Error('停止ボタンがありません')
    await userEvent.click(button)

    expect(stop).toHaveBeenCalledWith('job-1')
    expect(status()).toHaveTextContent('停止中')
    expect(stopButton()).toBeDisabled()

    // 応答の running のあとも、エポックの区切りまでは続く
    send(progress({ epoch: 2 }))
    expect(status()).toHaveTextContent('停止中')

    send(progress({ epoch: 2, status: 'stopped' }))
    expect(status()).toHaveTextContent('停止')
    expect(status()).not.toHaveTextContent('停止中')
  })

  it('停止に失敗したら理由を出し、もう一度押せる', async () => {
    const stop = vi.fn<TrainingApi['stop']>(() =>
      Promise.resolve(
        apiError({ kind: 'http', status: 502, message: '学習サーバーに接続できません。' }),
      ),
    )
    renderProgress({ stop })
    const button = stopButton()
    if (button === null) throw new Error('停止ボタンがありません')
    await userEvent.click(button)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('接続できません'))
    expect(stopButton()).toBeEnabled()
  })
})

describe('受信の問題', () => {
  it('再接続中は問題を出すが、戻るボタンは出さず、進捗が届けば消す', () => {
    const { send, sendProblem } = renderProgress()
    sendProblem('接続が切れました。再接続しています…', true)
    expect(screen.getByRole('alert')).toHaveTextContent('再接続')
    expect(backButton()).not.toBeInTheDocument()

    send(progress())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('もう進捗が届かないなら、戻るボタンを出す(戻らないと再チェックできないため)', async () => {
    const { store, sendProblem } = renderProgress()
    sendProblem('進捗を受信できません', false)
    expect(stopButton()).not.toBeInTheDocument()

    const back = backButton()
    if (back === null) throw new Error('戻るボタンがありません')
    await userEvent.click(back)
    expect(store.getState().runState.kind).toBe('editing')
  })
})
