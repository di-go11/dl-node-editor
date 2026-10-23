// @vitest-environment node
import { HttpResponse, http } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { nodeId } from '../../entity/model-graph/node-id'
import { defaultTrainingSettings } from '../../entity/training/training-settings'
import { validSegnetGraph } from '../../entity/validation/test-fixtures'
import { TEST_BASE_URL, createMockServer } from '../mock/server'

import { createApiClient } from './api-client'
import { createHttpModelGraphValidationApi } from './http-model-graph-validation-api'
import { createHttpTrainingApi } from './http-training-api'

/**
 * サーバー側のチェック(POST /model-graphs/validate)と学習開始(POST /trainings)の
 * HTTP 実装を、MSW のモック API に対して動かして確かめる。
 *
 * モックはリクエストの JSON をエンティティ層の Zod(C++ が読む形)で検証するので、
 * ここが通れば「送っている JSON が契約の形をしている」ことも同時に確かめられる。
 */

const server = createMockServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const client = () => createApiClient(TEST_BASE_URL)
const settings = { ...defaultTrainingSettings(), datasetPath: '/data/voc', device: 'cpu' }

describe('createHttpModelGraphValidationApi', () => {
  it('モデル構造を送り、検証の結果を受け取る', async () => {
    const result = await createHttpModelGraphValidationApi(client()).validate(validSegnetGraph())
    expect(result).toEqual({ ok: true, value: { ok: true, issues: [] } })
  })

  it('サーバーの問題を、位置付きのエンティティの Issue にする', async () => {
    server.use(
      http.post(`${TEST_BASE_URL}/model-graphs/validate`, () =>
        HttpResponse.json({
          ok: false,
          issues: [
            { severity: 'error', node_id: 'conv1', port: 'x', message: 'C++ での問題' },
            { severity: 'warning', node_id: 'bad id', message: '位置の読めない問題' },
          ],
        }),
      ),
    )
    const result = await createHttpModelGraphValidationApi(client()).validate(validSegnetGraph())
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.ok).toBe(false)
    expect(result.value.issues).toEqual([
      {
        severity: 'error',
        code: 'server/reported',
        message: 'C++ での問題',
        nodeId: nodeId('conv1'),
        port: 'x',
      },
      // ノード ID として読めない node_id は捨て、メッセージだけを残す
      { severity: 'warning', code: 'server/reported', message: '位置の読めない問題' },
    ])
  })
})

describe('createHttpTrainingApi', () => {
  it('StartTrainingRequest の形で送り、job_id を受け取る', async () => {
    const result = await createHttpTrainingApi(client()).start(validSegnetGraph(), settings)
    expect(result).toEqual({ ok: true, value: { jobId: 'mock-job-1', status: 'running' } })
  })

  it('400 の応答の issues を、ログに出せる Issue にする', async () => {
    server.use(
      http.post(`${TEST_BASE_URL}/trainings`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'INVALID_ARGUMENT',
              message: '不正なリクエスト',
              issues: [{ severity: 'error', message: 'dataset_path が空です' }],
            },
          },
          { status: 400 },
        ),
      ),
    )
    const result = await createHttpTrainingApi(client()).start(validSegnetGraph(), settings)
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: 'http',
        status: 400,
        code: 'INVALID_ARGUMENT',
        issues: [{ severity: 'error', code: 'server/reported', message: 'dataset_path が空です' }],
      },
    })
  })
})

describe('モックの学習開始は、リクエストの形を検証する', () => {
  it('形の正しくない JSON には 400 を返す(本物と同じ厳しさ)', async () => {
    const response = await fetch(`${TEST_BASE_URL}/trainings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_name: 'x' }),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { issues: unknown[] } }
    expect(body.error.issues.length).toBeGreaterThan(0)
  })
})
