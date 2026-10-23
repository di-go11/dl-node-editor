import type { Issue } from '../../../entity/validation/issue'

import styles from './LogPanel.module.css'

/**
 * ログ(指示書 4.2 の画面下部)。整合性チェックの結果や警告を、テキストで並べる。
 *
 * 表示する Issue は EditorPage が検証から計算して渡す。ログ自身は何も計算しない。
 * 並び順は検証の結果のまま(error が先)。行をクリックしてノードにフォーカスする機能は
 * フェーズ 5 で作る。
 */

export type LogPanelProps = {
  readonly issues: readonly Issue[]
}

const SEVERITY_MARK = { error: '✖', warning: '⚠' } as const
const SEVERITY_LABEL = { error: 'エラー', warning: '警告' } as const

export function LogPanel({ issues }: LogPanelProps) {
  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.length - errorCount

  return (
    <section className={styles.panel} aria-label="ログ">
      <h2 className={styles.heading}>
        ログ
        <span className={styles.counts}>
          エラー {errorCount} / 警告 {warningCount}
        </span>
      </h2>
      {issues.length === 0 ? (
        <p className={styles.empty}>問題は見つかっていません。</p>
      ) : (
        <ul className={styles.list}>
          {issues.map((issue, index) => (
            <li
              // 同じ内容の Issue が並ぶことはありうるので、位置も含めてキーにする
              key={`${index}:${issue.code}:${issue.nodeId ?? ''}:${issue.port ?? ''}`}
              className={issue.severity === 'error' ? styles.error : styles.warning}
            >
              <span className={styles.mark} aria-label={SEVERITY_LABEL[issue.severity]}>
                {SEVERITY_MARK[issue.severity]}
              </span>
              {issue.nodeId !== undefined && <span className={styles.nodeId}>{issue.nodeId}</span>}
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
