// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { emptyEditorDocument } from '../../entity/document/document'
import type { EditorDocument } from '../../entity/document/document'
import { defaultTrainingSettings } from '../../entity/training/training-settings'
import { validSegnetGraph } from '../../entity/validation/test-fixtures'
import type { TrainingApi } from '../ports/training-api'
import { INITIAL_RUN_STATE, beginCheck, checkTargetOf, finishCheck } from '../run-state/run-state'
import type { RunState } from '../run-state/run-state'

import { startTraining } from './start-training'

function fakeTrainingApi(ok = true) {
  const start = vi.fn<TrainingApi['start']>(() =>
    Promise.resolve(
      ok
        ? { ok: true, value: { jobId: 'job-7', status: 'running' } }
        : {
            ok: false,
            error: { kind: 'http', status: 502, message: '学習エンジンに接続できません' },
          },
    ),
  )
  return {
    api: {
      start,
      subscribeProgress: () => () => undefined,
      stop: () => Promise.resolve({ ok: true, value: 'running' }),
    } satisfies TrainingApi,
    start,
  }
}

const document: EditorDocument = {
  ...emptyEditorDocument(),
  graph: validSegnetGraph(),
  training: defaultTrainingSettings(),
}

function checked(doc: EditorDocument): RunState {
  const target = checkTargetOf(doc)
  if (target === null) throw new Error('学習設定がありません')
  return finishCheck(beginCheck(INITIAL_RUN_STATE, target), target, { ok: true, issues: [] })
}

describe('startTraining', () => {
  it('チェック済みなら、チェックした内容で学習を始める', async () => {
    const { api, start } = fakeTrainingApi()
    const result = await startTraining({ trainingApi: api }, checked(document), document)
    expect(result).toEqual({ ok: true, jobId: 'job-7' })
    expect(start).toHaveBeenCalledWith(document.graph, document.training)
  })

  it('チェックしていなければ、サーバーに送らない(画面の守りが破れても実行しない)', async () => {
    const { api, start } = fakeTrainingApi()
    const result = await startTraining({ trainingApi: api }, INITIAL_RUN_STATE, document)
    expect(result).toEqual({ ok: false, reason: 'not-checked' })
    expect(start).not.toHaveBeenCalled()
  })

  it('チェックの後に変更していたら、サーバーに送らない', async () => {
    const { api, start } = fakeTrainingApi()
    const edited = { ...document, graph: { ...document.graph } }
    const result = await startTraining({ trainingApi: api }, checked(document), edited)
    expect(result).toEqual({ ok: false, reason: 'not-checked' })
    expect(start).not.toHaveBeenCalled()
  })

  it('サーバーが失敗したら、理由を返す', async () => {
    const { api } = fakeTrainingApi(false)
    const result = await startTraining({ trainingApi: api }, checked(document), document)
    expect(result).toMatchObject({ ok: false, reason: 'api', error: { status: 502 } })
  })
})
