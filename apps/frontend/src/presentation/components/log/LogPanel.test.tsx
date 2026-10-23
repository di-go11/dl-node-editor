import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { nodeId } from '../../../entity/model-graph/node-id'
import { issueError, issueWarning } from '../../../entity/validation/issue'

import { LogPanel } from './LogPanel'

describe('LogPanel', () => {
  it('問題がなければ、そう表示する', () => {
    render(<LogPanel issues={[]} />)
    expect(screen.getByText('問題は見つかっていません。')).toBeInTheDocument()
    expect(screen.getByText('エラー 0 / 警告 0')).toBeInTheDocument()
  })

  it('件数と、各行の重さ・ノード ID・メッセージを、渡された順に並べる', () => {
    render(
      <LogPanel
        issues={[
          issueError('port/not-connected', '入力ポート x が未接続です', {
            nodeId: nodeId('conv2'),
            port: 'x',
          }),
          issueError('graph/no-output', 'Output に何もつながっていません'),
          issueWarning('channel/mismatch', 'チャンネル数が一致しません', {
            nodeId: nodeId('conv3'),
          }),
        ]}
      />,
    )
    expect(screen.getByText('エラー 2 / 警告 1')).toBeInTheDocument()

    const rows = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      '✖conv2入力ポート x が未接続です',
      '✖Output に何もつながっていません',
      '⚠conv3チャンネル数が一致しません',
    ])
    expect(within(rows[2] as HTMLElement).getByLabelText('警告')).toBeInTheDocument()
  })
})
