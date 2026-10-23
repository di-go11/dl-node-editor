// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { LossKind } from '../training/loss'
import { LOSS_TYPES } from '../training/loss'
import { defaultTrainingSettings } from '../training/training-settings'
import { defaultVariant } from '../training/variant'

import { validateOutputActivation } from './output-activation'
import { buildGraph } from './test-fixtures'

/** conv1 → (最後の層) → Output のグラフ。最後の層を差し替えて試す */
function graphEndingWith(last: 'conv' | 'softmax' | 'sigmoid' | 'relu', dim = 1) {
  const nodes = [{ id: 'conv1', kind: 'conv2d' as const, inputs: { x: 'graph-input' as const } }]
  if (last === 'conv') return buildGraph(nodes, [['conv1', 'y']])
  const activationType = {
    softmax: 'ACTIVATION_TYPE_SOFTMAX',
    sigmoid: 'ACTIVATION_TYPE_SIGMOID',
    relu: 'ACTIVATION_TYPE_RELU',
  }[last]
  return buildGraph(
    [
      ...nodes,
      {
        id: 'act1',
        kind: 'activation',
        params: { activation_type: activationType, dim },
        inputs: { x: ['conv1', 'y'] },
      },
    ],
    [['act1', 'y']],
  )
}

const settingsWith = (loss: LossKind) => ({
  ...defaultTrainingSettings(),
  loss: defaultVariant(LOSS_TYPES, loss),
})

const check = (graph: ReturnType<typeof graphEndingWith>, loss: LossKind) =>
  validateOutputActivation({ graph, settings: settingsWith(loss) })

describe('validateOutputActivation - CrossEntropy(logits を受け取る)', () => {
  it('最後が Conv2D(logits)なら何も言わない', () => {
    expect(check(graphEndingWith('conv'), 'cross_entropy')).toEqual([])
  })

  it('最後が Softmax なら、二重にかかると警告する', () => {
    const issues = check(graphEndingWith('softmax'), 'cross_entropy')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'warning',
      code: 'training/output-activation',
      nodeId: 'act1',
    })
    expect(issues[0]?.message).toContain('二重')
  })

  it('ReLU は確率を出さないので、警告しない', () => {
    expect(check(graphEndingWith('relu'), 'cross_entropy')).toEqual([])
  })
})

describe('validateOutputActivation - Dice / Focal / Combo / Boundary(確率を受け取る)', () => {
  it.each(['dice', 'focal', 'combo', 'boundary'] as const)(
    '%s で最後に Softmax がなければ、置くよう警告する',
    (loss) => {
      const issues = check(graphEndingWith('conv'), loss)
      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatchObject({ severity: 'warning', nodeId: 'conv1' })
      expect(issues[0]?.message).toContain('Softmax(dim = 1)')
    },
  )

  it('最後が Softmax(dim = 1)なら何も言わない', () => {
    expect(check(graphEndingWith('softmax'), 'dice')).toEqual([])
  })

  it('Softmax の dim が 1 でなければ、そのパラメータを指して警告する', () => {
    const issues = check(graphEndingWith('softmax', 2), 'dice')
    expect(issues[0]).toMatchObject({ nodeId: 'act1', paramName: 'dim' })
  })
})

describe('validateOutputActivation - 判定しない場合', () => {
  it('MSE は活性化への期待がない', () => {
    expect(check(graphEndingWith('softmax'), 'mse')).toEqual([])
  })

  it('Output が未接続なら何も言わない(別のルールが報告する)', () => {
    const graph = buildGraph([{ id: 'conv1', kind: 'conv2d' }])
    expect(check(graph, 'dice')).toEqual([])
  })
})
