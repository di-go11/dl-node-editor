// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_EDITOR_CONTEXT } from '../../entity/editor-context/editor-context'
import { nodeId } from '../../entity/model-graph/node-id'
import { defaultNodeCatalog } from '../../entity/node-catalog/entries'
import { LOSS_TYPES } from '../../entity/training/loss'
import { defaultTrainingSettings } from '../../entity/training/training-settings'
import { defaultVariant } from '../../entity/training/variant'
import type { ValidationResult } from '../../entity/validation/issue'
import { issueWarning } from '../../entity/validation/issue'
import { buildGraph, validSegnetGraph } from '../../entity/validation/test-fixtures'
import type { ApiResult } from '../ports/api-result'
import type { ModelGraphValidationApi } from '../ports/model-graph-validation-api'

import type { IntegrityCheckInput } from './check-integrity'
import { checkIntegrity } from './check-integrity'

/** サーバー側のチェックの偽物。何回呼ばれたかも数える */
function fakeValidationApi(result: ApiResult<ValidationResult>) {
  const validate = vi.fn<ModelGraphValidationApi['validate']>(() => Promise.resolve(result))
  return { api: { validate } satisfies ModelGraphValidationApi, validate }
}

const SERVER_OK: ApiResult<ValidationResult> = { ok: true, value: { ok: true, issues: [] } }

/** そのまま学習を始められる入力(SegNet は最後が Conv2D なので、loss は CrossEntropy) */
function validInput(patch: Partial<IntegrityCheckInput> = {}): IntegrityCheckInput {
  return {
    graph: validSegnetGraph(),
    context: DEFAULT_EDITOR_CONTEXT,
    catalog: defaultNodeCatalog,
    settings: { ...defaultTrainingSettings(), datasetPath: '/data/voc', device: 'cpu' },
    ...patch,
  }
}

const codesOf = (result: ValidationResult) => result.issues.map((issue) => issue.code)

describe('checkIntegrity', () => {
  it('3 段階とも問題がなければ OK', async () => {
    const { api, validate } = fakeValidationApi(SERVER_OK)
    const result = await checkIntegrity({ validationApi: api }, validInput())
    expect(result).toEqual({ ok: true, issues: [] })
    expect(validate).toHaveBeenCalledOnce()
  })

  it('モデル構造・学習設定・サーバーの問題を 1 つの一覧にまとめ、error を先に並べる', async () => {
    const { api } = fakeValidationApi({
      ok: true,
      value: {
        ok: true,
        issues: [issueWarning('server/reported', 'C++ からの警告', { nodeId: nodeId('conv1') })],
      },
    })
    const result = await checkIntegrity(
      { validationApi: api },
      validInput({ settings: { ...validInput().settings, epoch: 0 } }),
    )
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toEqual(['training/out-of-range', 'server/reported'])
  })

  it('モデル構造にエラーがあれば、サーバーには問い合わせない(同じ問題が 2 回並ばないように)', async () => {
    const { api, validate } = fakeValidationApi(SERVER_OK)
    const graph = buildGraph([{ id: 'conv1', kind: 'conv2d' }]) // 入力も出力もつながっていない
    const result = await checkIntegrity({ validationApi: api }, validInput({ graph }))
    expect(result.ok).toBe(false)
    expect(validate).not.toHaveBeenCalled()
  })

  it('学習設定のエラーだけなら、サーバーには問い合わせる', async () => {
    const { api, validate } = fakeValidationApi(SERVER_OK)
    await checkIntegrity(
      { validationApi: api },
      validInput({ settings: { ...validInput().settings, datasetPath: '' } }),
    )
    expect(validate).toHaveBeenCalledOnce()
  })

  it('サーバーに届かなければ error(チェックできなかったことを OK とみなさない)', async () => {
    const { api } = fakeValidationApi({
      ok: false,
      error: { kind: 'network', message: 'サーバーに接続できません' },
    })
    const result = await checkIntegrity({ validationApi: api }, validInput())
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toEqual(['server/unreachable'])
  })

  it('Output の直前の活性化と loss が合わなければ warning(実行は止めない)', async () => {
    const { api } = fakeValidationApi(SERVER_OK)
    // SegNet の最後は Conv2D(logits)。Dice は確率を受け取るので Softmax が要る
    const settings = { ...validInput().settings, loss: defaultVariant(LOSS_TYPES, 'dice') }
    const result = await checkIntegrity({ validationApi: api }, validInput({ settings }))
    expect(result.ok).toBe(true)
    expect(codesOf(result)).toEqual(['training/output-activation'])
  })

  it('capabilities の一覧を渡すと、device がその中にあるかも確かめる', async () => {
    const { api } = fakeValidationApi(SERVER_OK)
    const result = await checkIntegrity(
      { validationApi: api },
      validInput({ availableDevices: ['cuda:0'] }),
    )
    expect(codesOf(result)).toEqual(['training/unknown-device'])
  })
})
