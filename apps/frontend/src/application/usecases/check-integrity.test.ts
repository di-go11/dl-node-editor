// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_EDITOR_CONTEXT } from '../../entity/editor-context/editor-context'
import { defaultNodeCatalog } from '../../entity/node-catalog/entries'
import { LOSS_TYPES } from '../../entity/training/loss'
import { defaultTrainingSettings } from '../../entity/training/training-settings'
import { defaultVariant } from '../../entity/training/variant'
import type { ValidationResult } from '../../entity/validation/issue'
import { buildGraph, validSegnetGraph } from '../../entity/validation/test-fixtures'
import type { ApiResult } from '../ports/api-result'
import { apiError, apiOk } from '../ports/api-result'
import type { ServerCheck, TrainingApi } from '../ports/training-api'

import type { IntegrityCheckInput } from './check-integrity'
import { checkIntegrity, checkIntegrityWithServer } from './check-integrity'

/** そのまま学習を始められる入力(SegNet は最後が Conv2D なので、loss は CrossEntropy) */
function validInput(patch: Partial<IntegrityCheckInput> = {}): IntegrityCheckInput {
  return {
    graph: validSegnetGraph(),
    context: DEFAULT_EDITOR_CONTEXT,
    catalog: defaultNodeCatalog,
    settings: { ...defaultTrainingSettings(), datasetId: 'dataset-voc', device: 'cpu' },
    ...patch,
  }
}

const codesOf = (result: ValidationResult) => result.issues.map((issue) => issue.code)

describe('checkIntegrity', () => {
  it('どの段階にも問題がなければ OK', () => {
    expect(checkIntegrity(validInput())).toEqual({ ok: true, issues: [] })
  })

  it('モデル構造と学習設定の問題を 1 つの一覧にまとめ、error を先に並べる', () => {
    const graph = buildGraph([{ id: 'conv1', kind: 'conv2d' }]) // 入力も出力もつながっていない
    const settings = { ...validInput().settings, epoch: 0 }
    const result = checkIntegrity(validInput({ graph, settings }))
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('training/out-of-range')
    expect(result.issues.length).toBeGreaterThan(1)
    const firstWarning = result.issues.findIndex((issue) => issue.severity === 'warning')
    const lastError = result.issues.findLastIndex((issue) => issue.severity === 'error')
    if (firstWarning !== -1) expect(lastError).toBeLessThan(firstWarning)
  })

  it('Output の直前の活性化と loss が合わなければ warning(実行は止めない)', () => {
    // SegNet の最後は Conv2D(logits)。Dice は確率を受け取るので Softmax が要る
    const settings = { ...validInput().settings, loss: defaultVariant(LOSS_TYPES, 'dice') }
    const result = checkIntegrity(validInput({ settings }))
    expect(result.ok).toBe(true)
    expect(codesOf(result)).toEqual(['training/output-activation'])
  })

  it('capabilities の一覧を渡すと、device がその中にあるかも確かめる', () => {
    const result = checkIntegrity(validInput({ availableDevices: ['cuda:0'] }))
    expect(codesOf(result)).toEqual(['training/unknown-device'])
  })
})

describe('checkIntegrityWithServer', () => {
  function fakeValidate(result: ApiResult<ServerCheck>) {
    const validate = vi.fn<TrainingApi['validate']>(() => Promise.resolve(result))
    return { deps: { trainingApi: { validate } }, validate }
  }

  it('手元のチェックもサーバーも問題なければ OK', async () => {
    const { deps, validate } = fakeValidate(apiOk({ kind: 'ok' }))
    const input = validInput()
    expect(await checkIntegrityWithServer(deps, input)).toEqual({ ok: true, issues: [] })
    expect(validate).toHaveBeenCalledWith(input.graph, input.settings)
  })

  it('手元のチェックで error があれば、サーバーには問い合わせない', async () => {
    const { deps, validate } = fakeValidate(apiOk({ kind: 'ok' }))
    const settings = { ...validInput().settings, epoch: 0 }
    const result = await checkIntegrityWithServer(deps, validInput({ settings }))
    expect(result.ok).toBe(false)
    expect(validate).not.toHaveBeenCalled()
  })

  it('名前が使用済みなら、model_name を指す error にする', async () => {
    const { deps } = fakeValidate(apiOk({ kind: 'model-name-used' }))
    const result = await checkIntegrityWithServer(deps, validInput())
    expect(result.ok).toBe(false)
    expect(result.issues).toMatchObject([
      { severity: 'error', code: 'training/model-name-used', field: 'model_name' },
    ])
  })

  it('サーバーで確かめられなければ error にする(確かめていない内容では実行させない)', async () => {
    const { deps } = fakeValidate(
      apiError({ kind: 'network', message: 'サーバーに接続できません: down' }),
    )
    const result = await checkIntegrityWithServer(deps, validInput())
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toEqual(['training/server-check-failed'])
  })

  it('warning はサーバーの結果と一緒に残す', async () => {
    const { deps } = fakeValidate(apiOk({ kind: 'model-name-used' }))
    const settings = { ...validInput().settings, loss: defaultVariant(LOSS_TYPES, 'dice') }
    const result = await checkIntegrityWithServer(deps, validInput({ settings }))
    // error を先に並べる
    expect(codesOf(result)).toEqual(['training/model-name-used', 'training/output-activation'])
  })
})
