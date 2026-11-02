// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { nodeId } from '../model-graph/node-id'

import {
  hasError,
  issueError,
  issueWarning,
  issuesOfNode,
  sortIssuesBySeverity,
  toValidationResult,
} from './issue'

describe('issueError / issueWarning', () => {
  it('位置の情報を省ける(グラフ全体の問題)', () => {
    expect(issueError('graph/no-nodes', 'ノードがありません')).toEqual({
      severity: 'error',
      code: 'graph/no-nodes',
      message: 'ノードがありません',
    })
  })

  it('ノード・ポート・パラメータの位置を持たせられる', () => {
    expect(
      issueWarning('channel/mismatch', 'チャンネル数が違います', {
        nodeId: nodeId('conv2'),
        port: 'x',
        paramName: 'in_channels',
      }),
    ).toEqual({
      severity: 'warning',
      code: 'channel/mismatch',
      message: 'チャンネル数が違います',
      nodeId: 'conv2',
      port: 'x',
      paramName: 'in_channels',
    })
  })
})

describe('hasError / toValidationResult', () => {
  it('warning だけなら ok は true(実行を止めない)', () => {
    const issues = [issueWarning('channel/mismatch', 'w')]
    expect(hasError(issues)).toBe(false)
    expect(toValidationResult(issues).ok).toBe(true)
  })

  it('error が 1 件でもあれば ok は false', () => {
    const issues = [issueWarning('channel/mismatch', 'w'), issueError('graph/no-nodes', 'e')]
    expect(hasError(issues)).toBe(true)
    expect(toValidationResult(issues).ok).toBe(false)
  })

  it('問題が 1 件もなければ ok は true', () => {
    expect(toValidationResult([])).toEqual({ ok: true, issues: [] })
  })
})

describe('issuesOfNode', () => {
  it('ノードに紐づく問題だけを取り出す(プロパティパネルやノードの表示用)', () => {
    const issues = [
      issueError('port/not-connected', 'a', { nodeId: nodeId('conv1') }),
      issueError('port/not-connected', 'b', { nodeId: nodeId('conv2') }),
      issueError('graph/no-nodes', 'c'),
    ]
    expect(issuesOfNode(issues, nodeId('conv1')).map((issue) => issue.message)).toEqual(['a'])
  })
})

describe('sortIssuesBySeverity', () => {
  it('error を先に並べる', () => {
    const issues = [
      issueWarning('channel/mismatch', 'w1'),
      issueError('graph/no-nodes', 'e1'),
      issueWarning('channel/mismatch', 'w2'),
      issueError('graph/no-output', 'e2'),
    ]
    expect(sortIssuesBySeverity(issues).map((issue) => issue.message)).toEqual([
      'e1',
      'e2',
      'w1',
      'w2',
    ])
  })

  it('同じ severity の中では元の順序を保つ(安定ソート)', () => {
    // ログの並びが実行ごとに変わると、同じ問題を追いにくくなる
    const issues = [
      issueError('graph/no-input', '1'),
      issueError('graph/no-output', '2'),
      issueError('graph/cycle', '3'),
    ]
    expect(sortIssuesBySeverity(issues).map((issue) => issue.message)).toEqual(['1', '2', '3'])
  })

  it('元の配列を書き換えない', () => {
    const issues = [issueWarning('channel/mismatch', 'w'), issueError('graph/no-nodes', 'e')]
    sortIssuesBySeverity(issues)
    expect(issues[0]?.severity).toBe('warning')
  })
})
