import { useEffect, useId, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Link, useParams } from 'react-router'

import type { ConfusionMatrixEpoch, TrainingHistory } from '../../entity/trained-model/history'
import {
  confusionMatrixEpochs,
  defaultConfusionMatrixEpoch,
  historyLearningRatePoints,
  historyLossPoints,
  historyMetricPoints,
  historyToCsv,
  perClassColumnsOf,
} from '../../entity/trained-model/history'
import { hasMetrics, metricsChartTitle, perClassValuesOf } from '../../entity/training/metric-points'
import { hasLearningRate, TRAINING_STATUS_LABELS } from '../../entity/training/progress'
import { useDependencies } from '../app/dependencies'
import {
  chartSvgOf,
  downloadBlob,
  downloadText,
  safeFileName,
  svgToPngBlob,
} from '../components/history/export-files'
import { ConfusionMatrixTable } from '../components/metrics/ConfusionMatrixTable'
import { LearningRateChart } from '../components/progress/LearningRateChart'
import { LossChart } from '../components/progress/LossChart'
import { MetricsChart } from '../components/progress/MetricsChart'

import styles from './TrainedModelPage.module.css'

/**
 * 学習の記録の画面(/models/:modelId/history)。モデル一覧から開く。
 *
 *   [← 一覧]  学習の記録: <モデル名>
 *   loss の推移        [SVG で保存] [PNG で保存]
 *   mIoU の推移        [SVG で保存] [PNG で保存](分類は accuracy)
 *   学習率の推移       [SVG で保存] [PNG で保存]
 *   混同行列           [エポック ▼](既定は最後のエポック)
 *   メトリクスの表     [CSV で保存]
 *
 * データは DB に記録した全 run のエポックごとの結果(GET /models/{model_id}/history)。
 * 学習中の画面(進捗)は学習エンジンから届いたストリームをそのまま描くが、こちらは記録から描くので、
 * 学習が終わった後や、サーバーを再起動した後でも見られる。
 *
 * グラフは学習中の画面と同じ部品で描き、画面に描いた SVG をそのままファイルにする(画面とファイルの見た目が同じ)。
 * PNG は、その SVG を canvas に描いて作る(スライドなど、SVG を貼れないところに使う)。
 * 同じエポック番号が 2 つの run にあるとき(再開でやり直したエポック)、グラフは後の run の値を使い、
 * 表と CSV は両方の行を残す。
 */
export function TrainedModelHistoryPage() {
  const { modelId } = useParams()
  if (modelId === undefined) return null
  return <HistoryLoader modelId={modelId} />
}

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly history: TrainingHistory }
  | { readonly status: 'error'; readonly message: string }

function HistoryLoader({ modelId }: { readonly modelId: string }) {
  const { trainedModelApi } = useDependencies()
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    // 取得の途中で画面が外れたら、結果を捨てる(外れた部品の state を書き換えないため)
    let cancelled = false
    void trainedModelApi.getHistory(modelId).then((result) => {
      if (cancelled) return
      setState(
        result.ok
          ? { status: 'ready', history: result.value }
          : { status: 'error', message: `学習の記録を読み込めませんでした: ${result.error.message}` },
      )
    })
    return () => {
      cancelled = true
    }
  }, [trainedModelApi, modelId])

  if (state.status === 'ready') return <HistoryContent history={state.history} />
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/models" className={styles.back}>
          ← 一覧
        </Link>
        <h1 className={styles.title}>学習の記録</h1>
      </header>
      <main className={styles.main}>
        {state.status === 'loading' ? (
          <p role="status">学習の記録を読み込んでいます…</p>
        ) : (
          <p role="alert" className={styles.error}>
            {state.message}
          </p>
        )}
      </main>
    </div>
  )
}

function formatValue(value: number | null, digits = 4): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits)
}

function formatLearningRate(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toExponential(3)
}

/**
 * 選んだエポックの混同行列。開いたときは defaultConfusionMatrixEpoch のエポックを選ぶ。
 * 全エポックを並べることはしない(200 個並べても見比べられない)
 */
function ConfusionMatrixSection({ epochs }: { readonly epochs: readonly ConfusionMatrixEpoch[] }) {
  const [selected, setSelected] = useState(() => defaultConfusionMatrixEpoch(epochs))
  const selectId = useId()
  const current = epochs.find((entry) => entry.epoch === selected)

  return (
    <section aria-label="混同行列">
      <h2>混同行列</h2>
      {current === undefined ? (
        <p className={styles.muted}>この学習には混同行列が記録されていません。</p>
      ) : (
        <>
          <label htmlFor={selectId}>エポック </label>
          <select
            id={selectId}
            value={current.epoch}
            onChange={(event) => setSelected(Number(event.target.value))}
          >
            {epochs.map((entry) => (
              <option key={entry.epoch} value={entry.epoch}>
                {entry.epoch}
              </option>
            ))}
          </select>
          <ConfusionMatrixTable
            matrix={current.matrix}
            caption={`検証データ・エポック ${current.epoch}`}
          />
        </>
      )}
    </section>
  )
}

function HistoryContent({ history }: { readonly history: TrainingHistory }) {
  const lossChartRef = useRef<HTMLDivElement>(null)
  const lrChartRef = useRef<HTMLDivElement>(null)
  const metricsChartRef = useRef<HTMLDivElement>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const lossPoints = historyLossPoints(history)
  const learningRatePoints = historyLearningRatePoints(history)
  const metricPoints = historyMetricPoints(history)
  const metricsTitle = metricsChartTitle(metricPoints)
  const baseName = safeFileName(history.modelName)
  const runNumber = new Map(history.runs.map((run, index) => [run.jobId, index + 1]))
  // クラスごとの値の列(segmentation は IoU、classification は accuracy)
  const perClass = perClassColumnsOf(history.epochs)
  const classIndexes = Array.from({ length: perClass.count }, (_, index) => index)

  // PNG も、画面に描いた SVG(chartSvgOf)から作る。SVG と PNG で見た目がそろう
  const saveChart = async (
    container: HTMLDivElement | null,
    kind: string,
    title: string,
    format: 'svg' | 'png',
  ) => {
    const svg = container === null ? null : chartSvgOf(container, title)
    if (svg === null) {
      setExportError('グラフがまだ描かれていないため、保存できませんでした。')
      return
    }
    if (format === 'svg') {
      setExportError(null)
      downloadText(`${baseName}_${kind}.svg`, 'image/svg+xml', svg)
      return
    }
    const png = await svgToPngBlob(svg)
    if (png === null) {
      setExportError('グラフを PNG に変換できませんでした。SVG で保存してください。')
      return
    }
    setExportError(null)
    downloadBlob(`${baseName}_${kind}.png`, png)
  }

  /** グラフの上に置く「SVG で保存」「PNG で保存」 */
  const saveButtons = (
    ref: RefObject<HTMLDivElement | null>,
    kind: string,
    title: string,
  ) => (
    <span className={styles.saveButtons}>
      <button type="button" onClick={() => void saveChart(ref.current, kind, title, 'svg')}>
        SVG で保存
      </button>
      <button type="button" onClick={() => void saveChart(ref.current, kind, title, 'png')}>
        PNG で保存
      </button>
    </span>
  )

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/models" className={styles.back}>
          ← 一覧
        </Link>
        <h1 className={styles.title}>学習の記録: {history.modelName}</h1>
      </header>

      <main className={styles.main}>
        {exportError !== null && (
          <p role="alert" className={styles.error}>
            {exportError}
          </p>
        )}

        <section aria-label="学習の回">
          <h2>学習の回</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col" className={styles.number}>
                  回
                </th>
                <th scope="col">開始</th>
                <th scope="col">終了</th>
                <th scope="col">状態</th>
              </tr>
            </thead>
            <tbody>
              {history.runs.map((run, index) => (
                <tr key={run.jobId}>
                  <td className={styles.number}>{index + 1}</td>
                  <td>{run.startedAt}</td>
                  <td>{run.finishedAt ?? '—'}</td>
                  <td>
                    {TRAINING_STATUS_LABELS[run.status]}
                    {run.failureReason !== null && (
                      <span className={styles.reason}>{run.failureReason}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {history.epochs.length === 0 ? (
          <p className={styles.muted}>まだ 1 エポックも記録されていません。</p>
        ) : (
          <>
            <section aria-label="loss の推移">
              <h2>loss の推移</h2>
              {saveButtons(lossChartRef, 'loss', `${history.modelName} の loss`)}
              <div ref={lossChartRef}>
                <LossChart points={lossPoints} />
              </div>
            </section>

            {hasMetrics(metricPoints) ? (
              <section aria-label={metricsTitle}>
                <h2>{metricsTitle}</h2>
                {saveButtons(metricsChartRef, 'metrics', `${history.modelName} の ${metricsTitle}`)}
                <div ref={metricsChartRef}>
                  <MetricsChart points={metricPoints} />
                </div>
              </section>
            ) : (
              <p className={styles.muted}>この学習にはメトリクスの記録がありません。</p>
            )}

            {/* 学習率を記録する前の学習では、全エポックで分からないのでグラフを出さない */}
            {hasLearningRate(learningRatePoints) ? (
              <section aria-label="学習率の推移">
                <h2>学習率の推移</h2>
                {saveButtons(lrChartRef, 'learning_rate', `${history.modelName} の学習率`)}
                <div ref={lrChartRef}>
                  <LearningRateChart points={learningRatePoints} />
                </div>
              </section>
            ) : (
              <p className={styles.muted}>この学習には学習率の記録がありません。</p>
            )}

            <ConfusionMatrixSection epochs={confusionMatrixEpochs(history)} />

            <section aria-label="メトリクス">
              <h2>メトリクス</h2>
              <p className={styles.muted}>
                全エポックを記録順に並べています。クラスごとの {perClass.label} は右に並びます(横にスクロールできます)。
              </p>
              {/* この表(と CSV にだけあるクラスごとの値の全列)を保存する。グラフの「SVG で保存」と同じく、対象の上に置く */}
              <button
                type="button"
                onClick={() => downloadText(`${baseName}_metrics.csv`, 'text/csv', historyToCsv(history))}
              >
                CSV で保存
              </button>
              {/* クラスが多いと(VOC は 21 クラス)表が画面より広くなるので、表だけを横にスクロールさせる */}
              <div style={{ overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col" className={styles.number}>
                      回
                    </th>
                    <th scope="col" className={styles.number}>
                      epoch
                    </th>
                    <th scope="col" className={styles.number}>
                      train_loss
                    </th>
                    <th scope="col" className={styles.number}>
                      val_loss
                    </th>
                    <th scope="col" className={styles.number}>
                      learning_rate
                    </th>
                    <th scope="col" className={styles.number}>
                      mIoU / accuracy
                    </th>
                    <th scope="col" className={styles.number}>
                      pixel_acc / macro_f1
                    </th>
                    {classIndexes.map((index) => (
                      <th key={index} scope="col" className={styles.number}>
                        {perClass.label}
                        <br />
                        クラス {index}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.epochs.map((epoch) => {
                    const metrics = epoch.metrics
                    const main =
                      metrics === null
                        ? null
                        : metrics.kind === 'segmentation'
                          ? metrics.miou
                          : metrics.accuracy
                    const sub =
                      metrics === null
                        ? null
                        : metrics.kind === 'segmentation'
                          ? metrics.pixelAcc
                          : metrics.macroF1
                    return (
                      <tr key={`${epoch.jobId}:${epoch.epoch}`}>
                        <td className={styles.number}>{runNumber.get(epoch.jobId) ?? '—'}</td>
                        <td className={styles.number}>{epoch.epoch}</td>
                        <td className={styles.number}>{formatValue(epoch.trainLoss)}</td>
                        <td className={styles.number}>{formatValue(epoch.valLoss)}</td>
                        <td className={styles.number}>{formatLearningRate(epoch.learningRate)}</td>
                        <td className={styles.number}>{formatValue(main)}</td>
                        <td className={styles.number}>{formatValue(sub)}</td>
                        {classIndexes.map((index) => (
                          // 記録していないクラス(NaN・列が足りない)は「—」
                          <td key={index} className={styles.number}>
                            {formatValue(perClassValuesOf(metrics)[index] ?? null)}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
