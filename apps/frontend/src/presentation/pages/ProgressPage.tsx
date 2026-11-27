import { useNavigate, useParams } from 'react-router'

import { finishRun } from '../../application/run-state/run-state'
import { hasMetrics, metricsChartTitle } from '../../entity/training/metric-points'
import type { ProgressMetrics } from '../../entity/training/progress'
import { hasLearningRate, TRAINING_STATUS_LABELS } from '../../entity/training/progress'
import { LearningRateChart } from '../components/progress/LearningRateChart'
import { LossChart } from '../components/progress/LossChart'
import { MetricsChart } from '../components/progress/MetricsChart'
import { useEditorStoreApi } from '../stores/editor-store-context'

import styles from './ProgressPage.module.css'
import { useTrainingProgress } from './use-training-progress'

/**
 * 進捗画面(指示書 4.6)。
 *
 * 再読み込みしても URL の job_id で同じ学習を見られる。ただし過去のエポックの履歴は
 * サーバーから取れないので、グラフは受信を始めた後の点だけになる。
 */
export function ProgressPage() {
  const { jobId } = useParams()
  if (jobId === undefined) return null
  // job_id が変わったら画面の状態ごと作り直す(前の学習のグラフを引き継がないように)
  return <TrainingProgressView key={jobId} jobId={jobId} />
}

const formatValue = (value: number | null) => (value === null ? '—' : value.toFixed(4))

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes === 0 ? `${seconds} 秒` : `${minutes} 分 ${seconds} 秒`
}

function MetricsView({ metrics }: { readonly metrics: ProgressMetrics }) {
  const [rows, perClassLabel, perClass] =
    metrics.kind === 'segmentation'
      ? ([
          [
            ['pixel_acc', metrics.pixelAcc],
            ['mIoU', metrics.miou],
            ['fw_IoU', metrics.fwIou],
            ['mean_class_accuracy', metrics.meanClassAccuracy],
          ],
          'IoU',
          metrics.perClassIou,
        ] as const)
      : ([
          [
            ['accuracy', metrics.accuracy],
            ['macro_f1', metrics.macroF1],
          ],
          '正解率',
          metrics.perClassAccuracy,
        ] as const)

  return (
    <section className={styles.section} aria-label="メトリクス">
      <h2>メトリクス</h2>
      <dl className={styles.stats}>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{formatValue(value)}</dd>
          </div>
        ))}
      </dl>
      <h3>クラスごとの {perClassLabel}</h3>
      <dl className={styles.stats}>
        {perClass.map((value, index) => (
          <div key={index}>
            <dt>クラス {index}</dt>
            <dd>{formatValue(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function TrainingProgressView({ jobId }: { readonly jobId: string }) {
  const navigate = useNavigate()
  const store = useEditorStoreApi()
  const {
    latest,
    lossPoints,
    learningRatePoints,
    metricPoints,
    problem,
    ended,
    stopping,
    stopError,
    stop,
  } = useTrainingProgress(jobId)
  const metricsTitle = metricsChartTitle(metricPoints)

  const statusLabel = stopping
    ? '停止中(エポックの区切りで止まります)'
    : latest === null
      ? '受信待ち'
      : TRAINING_STATUS_LABELS[latest.status]

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>進捗</h1>
        <span className={styles.jobId}>job_id: {jobId}</span>
        <span role="status">状態: {statusLabel}</span>
        {!ended && (
          <button
            type="button"
            disabled={stopping}
            onClick={() => {
              void stop()
            }}
          >
            停止
          </button>
        )}
        {ended && (
          <button
            type="button"
            onClick={() => {
              const state = store.getState()
              state.setRunState(finishRun(state.runState))
              void navigate('/')
            }}
          >
            エディタに戻る
          </button>
        )}
      </header>

      {latest?.errorMessage != null && (
        <p role="alert" className={styles.error}>
          学習に失敗しました: {latest.errorMessage}
        </p>
      )}
      {problem !== null && (
        <p role="alert" className={styles.error}>
          {problem.message}
        </p>
      )}
      {stopError !== null && (
        <p role="alert" className={styles.error}>
          停止できませんでした: {stopError}
        </p>
      )}

      {latest !== null && (
        <dl className={styles.stats} aria-label="概要">
          <div>
            <dt>epoch</dt>
            <dd>{latest.epoch}</dd>
          </div>
          <div>
            <dt>train_loss</dt>
            <dd>{formatValue(latest.trainLoss)}</dd>
          </div>
          <div>
            <dt>val_loss</dt>
            <dd>{formatValue(latest.valLoss)}</dd>
          </div>
          <div>
            <dt>エポックの所要時間</dt>
            <dd>{formatDuration(latest.epochElapsedMs)}</dd>
          </div>
          <div>
            <dt>累計時間</dt>
            <dd>{formatDuration(latest.totalElapsedMs)}</dd>
          </div>
        </dl>
      )}

      <section className={styles.section} aria-label="loss の推移">
        <h2>loss の推移</h2>
        {lossPoints.length === 0 ? (
          <p className={styles.muted}>最初のエポックが終わると表示します。</p>
        ) : (
          <LossChart points={lossPoints} />
        )}
      </section>

      {/* メトリクスは検証のあとに届く。1 エポックも届いていなければグラフを出さない */}
      {hasMetrics(metricPoints) && (
        <section className={styles.section} aria-label={metricsTitle}>
          <h2>{metricsTitle}</h2>
          <MetricsChart points={metricPoints} />
        </section>
      )}

      {/* 学習率を送らない古いサーバー・古い学習では、全エポックで分からないのでグラフを出さない */}
      {hasLearningRate(learningRatePoints) && (
        <section className={styles.section} aria-label="学習率の推移">
          <h2>学習率の推移</h2>
          <LearningRateChart points={learningRatePoints} />
        </section>
      )}

      {latest?.metrics != null && <MetricsView metrics={latest.metrics} />}
    </main>
  )
}
