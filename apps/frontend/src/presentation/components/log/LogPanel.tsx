import type { Issue } from '../../../entity/validation/issue'
import type { LogMessage } from '../../stores/editor-store'

import styles from './LogPanel.module.css'

/**
 * ログ(指示書 4.2 の画面下部)。2 種類の内容を並べる。
 *
 *   操作の結果  … 保存しました / 読み込めませんでした など、過去に起きた出来事。
 *                 利用者が消すまで残る。新しいものを上に出す
 *   整合性チェック … 今のグラフの問題(検証の結果)。グラフを直せば自動で消える
 *
 * どちらもこの部品では計算しない。EditorPage から受け取って描くだけである。
 * 行をクリックしてノードにフォーカスする機能はフェーズ 5 で作る。
 */

export type LogPanelProps = {
  readonly issues: readonly Issue[]
  readonly messages?: readonly LogMessage[]
  readonly onClearMessages?: () => void
}

const SEVERITY_MARK = { error: '✖', warning: '⚠', info: 'ℹ' } as const
const SEVERITY_LABEL = { error: 'エラー', warning: '警告', info: 'お知らせ' } as const

function levelClass(level: keyof typeof SEVERITY_MARK): string | undefined {
  if (level === 'error') return styles.error
  if (level === 'warning') return styles.warning
  return styles.info
}

export function LogPanel({ issues, messages = [], onClearMessages }: LogPanelProps) {
  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.length - errorCount

  return (
    <section className={styles.panel} aria-label="ログ">
      <h2 className={styles.heading}>
        ログ
        <span className={styles.counts}>
          エラー {errorCount} / 警告 {warningCount}
        </span>
        {messages.length > 0 && onClearMessages !== undefined && (
          <button type="button" className={styles.clear} onClick={onClearMessages}>
            操作の記録を消す
          </button>
        )}
      </h2>
      <div className={styles.body}>
        {messages.length > 0 && (
          <ul className={styles.list} aria-label="操作の結果">
            {[...messages].reverse().map((message) => (
              <li key={message.id} className={levelClass(message.level)}>
                <span className={styles.mark} aria-label={SEVERITY_LABEL[message.level]}>
                  {SEVERITY_MARK[message.level]}
                </span>
                <span>{message.text}</span>
              </li>
            ))}
          </ul>
        )}
        {issues.length === 0 ? (
          <p className={styles.empty}>問題は見つかっていません。</p>
        ) : (
          <ul className={styles.list} aria-label="整合性チェック">
            {issues.map((issue, index) => (
              <li
                // 同じ内容の Issue が並ぶことはありうるので、位置も含めてキーにする
                key={`${index}:${issue.code}:${issue.nodeId ?? ''}:${issue.port ?? ''}`}
                className={levelClass(issue.severity)}
              >
                <span className={styles.mark} aria-label={SEVERITY_LABEL[issue.severity]}>
                  {SEVERITY_MARK[issue.severity]}
                </span>
                {issue.nodeId !== undefined && (
                  <span className={styles.nodeId}>{issue.nodeId}</span>
                )}
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
