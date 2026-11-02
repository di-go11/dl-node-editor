// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { emptyEditorDocument } from '../../entity/document/document'
import type { EditorDocument } from '../../entity/document/document'
import { defaultTrainingSettings } from '../../entity/training/training-settings'
import type { ValidationResult } from '../../entity/validation/issue'
import { issueError } from '../../entity/validation/issue'
import { validSegnetGraph } from '../../entity/validation/test-fixtures'

import type { CheckTarget, RunState } from './run-state'
import {
  INITIAL_RUN_STATE,
  beginCheck,
  beginStart,
  canStart,
  checkTargetOf,
  effectiveRunState,
  finishCheck,
  finishRun,
  finishStart,
  isStaleResult,
} from './run-state'

const OK: ValidationResult = { ok: true, issues: [] }
const NG: ValidationResult = { ok: false, issues: [issueError('graph/no-output', 'x')] }

function documentWithTraining(): EditorDocument {
  return {
    ...emptyEditorDocument(),
    graph: validSegnetGraph(),
    training: defaultTrainingSettings(),
  }
}

function targetOf(document: EditorDocument): CheckTarget {
  const target = checkTargetOf(document)
  if (target === null) throw new Error('学習設定がありません')
  return target
}

/** チェックして OK になったところまで進める */
function checkedState(target: CheckTarget): RunState {
  return finishCheck(beginCheck(INITIAL_RUN_STATE, target), target, OK)
}

describe('状態機械 - 正常な流れ', () => {
  it('editing → checking → checked → starting → running', () => {
    const target = targetOf(documentWithTraining())
    let state = beginCheck(INITIAL_RUN_STATE, target)
    expect(state.kind).toBe('checking')
    state = finishCheck(state, target, OK)
    expect(state.kind).toBe('checked')
    expect(canStart(state, target)).toBe(true)
    state = beginStart(state, target)
    expect(state.kind).toBe('starting')
    state = finishStart(state, { ok: true, jobId: 'job-1' })
    expect(state).toEqual({ kind: 'running', jobId: 'job-1' })
    expect(finishRun(state)).toEqual(INITIAL_RUN_STATE)
  })

  it('チェックが NG なら editing に戻り、結果を残す(ログに出すため)', () => {
    const target = targetOf(documentWithTraining())
    const state = finishCheck(beginCheck(INITIAL_RUN_STATE, target), target, NG)
    expect(state).toEqual({ kind: 'editing', lastResult: NG, lastTarget: target })
    expect(canStart(state, target)).toBe(false)
  })
})

describe('状態機械 - 変更したら再チェックが必要(指示書 4.5)', () => {
  it('チェックの後にグラフを変えたら editing とみなし、実行できない', () => {
    const document = documentWithTraining()
    const target = targetOf(document)
    const state = checkedState(target)

    // ノードのパラメータを変えた(イミュータブルな更新なので graph の参照が変わる)
    const edited = { ...document, graph: { ...document.graph } }
    expect(effectiveRunState(state, targetOf(edited)).kind).toBe('editing')
    expect(canStart(state, targetOf(edited))).toBe(false)
  })

  it('学習設定や条件を変えても同じく再チェックが必要', () => {
    const document = documentWithTraining()
    const state = checkedState(targetOf(document))
    const settingsChanged = { ...document, training: { ...defaultTrainingSettings(), epoch: 99 } }
    const contextChanged = { ...document, context: { dataDim: '1d', method: 'cnn' } as const }
    expect(canStart(state, targetOf(settingsChanged))).toBe(false)
    expect(canStart(state, targetOf(contextChanged))).toBe(false)
  })

  it('表示だけの変更(座標)では、チェック済みのまま', () => {
    const document = documentWithTraining()
    const state = checkedState(targetOf(document))
    const moved = {
      ...document,
      layout: { ...document.layout, positions: new Map([['conv1', { x: 1, y: 1 }]]) },
    }
    expect(canStart(state, targetOf(moved))).toBe(true)
  })

  it('変更して editing になったとき、前回の結果は残す', () => {
    const document = documentWithTraining()
    const state = checkedState(targetOf(document))
    const edited = { ...document, graph: { ...document.graph } }
    expect(effectiveRunState(state, targetOf(edited))).toEqual({
      kind: 'editing',
      lastResult: OK,
      lastTarget: targetOf(document),
    })
  })

  it('チェックの途中で変更したら、返ってきた結果は捨てる(古い内容の結果で checked にしない)', () => {
    const document = documentWithTraining()
    const before = targetOf(document)
    const checking = beginCheck(INITIAL_RUN_STATE, before)

    // 途中で編集し、新しい内容でチェックし直した
    const after = targetOf({ ...document, graph: { ...document.graph } })
    const rechecking = beginCheck(checking, after)

    // 古いチェックの結果が遅れて届いても無視する
    expect(finishCheck(rechecking, before, OK)).toBe(rechecking)
    expect(finishCheck(rechecking, after, OK).kind).toBe('checked')
  })
})

describe('状態機械 - 押せない操作', () => {
  it('チェックしていなければ実行できない(beginStart は何も変えない)', () => {
    const target = targetOf(documentWithTraining())
    expect(beginStart(INITIAL_RUN_STATE, target)).toBe(INITIAL_RUN_STATE)
  })

  it('学習設定がまだなければ実行できない', () => {
    const target = targetOf(documentWithTraining())
    expect(canStart(checkedState(target), null)).toBe(false)
  })

  it('学習を始めている最中・学習中は、チェックし直せない', () => {
    const target = targetOf(documentWithTraining())
    const starting = beginStart(checkedState(target), target)
    expect(beginCheck(starting, target)).toBe(starting)
    const running = finishStart(starting, { ok: true, jobId: 'j' })
    expect(beginCheck(running, target)).toBe(running)
  })

  it('学習の開始に失敗したら checked に戻す(そのまま再実行できる)', () => {
    const target = targetOf(documentWithTraining())
    const starting = beginStart(checkedState(target), target)
    const failed = finishStart(starting, { ok: false })
    expect(failed.kind).toBe('checked')
    expect(canStart(failed, target)).toBe(true)
  })

  it('リクエストを送った後の変更では starting のまま(送ったのはチェック済みの内容)', () => {
    const document = documentWithTraining()
    const starting = beginStart(checkedState(targetOf(document)), targetOf(document))
    const edited = targetOf({ ...document, graph: { ...document.graph } })
    expect(effectiveRunState(starting, edited).kind).toBe('starting')
  })
})

describe('isStaleResult', () => {
  it('NG の直後は古くない。その後に変更したら古い', () => {
    const document = documentWithTraining()
    const target = targetOf(document)
    const ng = finishCheck(beginCheck(INITIAL_RUN_STATE, target), target, NG)
    expect(isStaleResult(ng, target)).toBe(false)
    const edited = targetOf({ ...document, graph: { ...document.graph } })
    expect(isStaleResult(ng, edited)).toBe(true)
  })

  it('一度もチェックしていなければ古くない', () => {
    expect(isStaleResult(INITIAL_RUN_STATE, targetOf(documentWithTraining()))).toBe(false)
  })
})
