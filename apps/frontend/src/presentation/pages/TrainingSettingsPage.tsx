import { useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router'

import type { RunState } from '../../application/run-state/run-state'
import { selectableDeviceIds } from '../../entity/capabilities/capabilities'
import type { TrainingSettings } from '../../entity/training/training-settings'
import { validateTrainingSettings } from '../../entity/validation/validate-training'
import { useCapabilities } from '../components/header/use-capabilities'
import { LogPanel } from '../components/log/LogPanel'
import { TrainingForm } from '../components/training-form/TrainingForm'
import { useEditorStore } from '../stores/editor-store-context'

import styles from './TrainingSettingsPage.module.css'
import { useTrainingRun } from './use-training-run'

/**
 * 学習設定画面(指示書 4.4 / 4.5)。
 *
 *   [← エディタ]  学習設定   状態: チェック済み   [整合性チェック] [学習実行]
 *   ┌───────────────── フォーム ─────────────────┐
 *   └─────────────────────────────────────────────┘
 *   ログ(チェックの結果。ノードの問題をクリックするとエディタに移って表示する)
 *
 * [学習実行] は、整合性チェックが OK になった直後(checked)にしか押せない。
 * チェックの後にフォームやグラフを変えると、自動で押せなくなる(application/run-state)。
 */
export function TrainingSettingsPage() {
  const ensureTrainingSettings = useEditorStore((state) => state.ensureTrainingSettings)
  const training = useEditorStore((state) => state.document.training)

  // 学習設定がまだなければ(初めてこの画面を開いたとき)、既定値で作る
  useEffect(() => {
    ensureTrainingSettings()
  }, [ensureTrainingSettings])

  if (training === null) return <p role="status">学習設定を準備しています…</p>
  return <TrainingSettingsContent settings={training} />
}

function statusLabel(state: RunState, stale: boolean): string {
  switch (state.kind) {
    case 'editing':
      if (state.lastResult === null || stale) return '未チェック'
      return 'NG(問題を直して、もう一度チェックしてください)'
    case 'checking':
      return 'チェック中…'
    case 'checked':
      return 'チェック済み(学習を実行できます)'
    case 'starting':
      return '学習を開始しています…'
    case 'running':
      return `学習中(job_id: ${state.jobId})`
  }
}

function TrainingSettingsContent({ settings }: { readonly settings: TrainingSettings }) {
  const navigate = useNavigate()
  const updateTraining = useEditorStore((state) => state.updateTraining)
  const focusNode = useEditorStore((state) => state.focusNode)
  const messages = useEditorStore((state) => state.messages)
  const clearMessages = useEditorStore((state) => state.clearMessages)

  const capabilities = useCapabilities()
  const deviceIds = useMemo(
    () => (capabilities.status === 'ready' ? selectableDeviceIds(capabilities.capabilities) : null),
    [capabilities],
  )

  // 入力欄の横に出す問題。チェックのボタンを押さなくても、入力のたびに計算して見せる
  const formIssues = useMemo(
    () =>
      validateTrainingSettings(
        deviceIds === null ? { settings } : { settings, availableDevices: deviceIds },
      ).issues,
    [settings, deviceIds],
  )

  const run = useTrainingRun(deviceIds ?? undefined)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.back}>
          ← エディタ
        </Link>
        <h1 className={styles.title}>学習設定</h1>
        <span
          className={`${styles.status} ${run.state.kind === 'checked' ? styles.statusOk : ''}`}
          role="status"
        >
          状態: {statusLabel(run.state, run.stale)}
        </span>
        <div className={styles.spacer} />
        {run.state.kind === 'running' && (
          <Link to={`/progress/${encodeURIComponent(run.state.jobId)}`}>進捗を見る</Link>
        )}
        <button
          type="button"
          disabled={!run.canCheck}
          onClick={() => {
            run.check()
          }}
        >
          整合性チェック
        </button>
        <button
          type="button"
          className={styles.primary}
          disabled={!run.canStart}
          title={run.canStart ? undefined : '整合性チェックが OK になると実行できます'}
          onClick={() => {
            void run.start()
          }}
        >
          学習実行
        </button>
      </header>

      <main className={styles.main}>
        <TrainingForm
          settings={settings}
          onChange={updateTraining}
          issues={formIssues}
          deviceIds={deviceIds}
        />
      </main>

      <div className={styles.log}>
        <LogPanel
          issues={run.issues}
          messages={messages}
          onClearMessages={clearMessages}
          {...(run.stale
            ? {
                staleNote:
                  'チェックの後に変更があります。この結果は古いので、もう一度チェックしてください。',
              }
            : {})}
          // ノードの問題は、エディタに移ってから該当するノードを中央に表示する
          // (修正は各画面に戻って行う。指示書 4.1)
          onIssueClick={(issue) => {
            if (issue.nodeId === undefined) return
            focusNode(issue.nodeId)
            void navigate('/')
          }}
        />
      </div>
    </div>
  )
}
