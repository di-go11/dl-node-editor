import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import type { ApiError, ApiResult } from '../../application/ports/api-result'
import { resumeTraining } from '../../application/usecases/resume-training'
import { selectableDeviceIds } from '../../entity/capabilities/capabilities'
import type { TrainedModelSummary } from '../../entity/trained-model/trained-model'
import { IMAGE_TASK_TYPES } from '../../entity/training/data-spec'
import { OPTIMIZER_TYPES } from '../../entity/training/optimizer'
import type { TrainingSettings } from '../../entity/training/training-settings'
import { validateResumeSettings } from '../../entity/validation/validate-resume'
import { useDependencies } from '../app/dependencies'
import { useCapabilities } from '../components/header/use-capabilities'
import { TrainingForm } from '../components/training-form/TrainingForm'

import styles from './TrainedModelPage.module.css'

/**
 * 学習済みモデルの詳細画面(/models/:modelId。今は学習再開の設定のみ。issue doc 作業 7)。
 *
 *   [← 一覧]  学習再開: <モデル名>   状態   [学習再開]
 *   モデル名・タスク・完了エポック数(表示だけ)
 *   ┌──── フォーム(新規学習と同じ部品から、変えられない欄を外したもの) ────┐
 *
 * 前回の学習設定(GET /models/{model_id}/config)を初期値にし、状態はこの画面の中だけで持つ
 * (エディタの文書は変えない)。完了エポック数は一覧の API から取る。
 *
 * 整合性チェックのボタンはない。フォームの検証で問題がなければ再開でき、DB との整合性は
 * サーバーが再開 API の中で確かめる。再開できたら進捗画面に移る。
 */
export function TrainedModelDetailPage() {
  const { modelId } = useParams()
  // ルートの定義上 modelId は必ずある。ないのはルーティングの誤り
  if (modelId === undefined) return <p role="alert">モデルが指定されていません。</p>
  // モデルが変わったら、読み込みと入力の状態を捨てて作り直す
  return <ResumeSettingsLoader key={modelId} modelId={modelId} />
}

type LoadState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      readonly summary: TrainedModelSummary
      readonly settings: TrainingSettings
    }
  | { readonly status: 'error'; readonly message: string }

function errorMessage(error: ApiError): string {
  return `再開の準備ができませんでした: ${error.message}`
}

/** 一覧(完了エポック数のため)と前回の設定の取得結果を、画面の状態にまとめる */
function loadStateOf(
  modelId: string,
  list: ApiResult<readonly TrainedModelSummary[]>,
  config: ApiResult<TrainingSettings>,
): LoadState {
  if (!list.ok) return { status: 'error', message: errorMessage(list.error) }
  if (!config.ok) return { status: 'error', message: errorMessage(config.error) }
  const summary = list.value.find((model) => model.modelId === modelId)
  if (summary === undefined) {
    return { status: 'error', message: '指定されたモデルが一覧にありません。' }
  }
  return { status: 'ready', summary, settings: config.value }
}

function ResumeSettingsLoader({ modelId }: { readonly modelId: string }) {
  const { trainedModelApi } = useDependencies()
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    // 取得の途中で画面が外れたら、結果を捨てる(外れた部品の state を書き換えないため)
    let cancelled = false
    void Promise.all([trainedModelApi.list(), trainedModelApi.getConfig(modelId)]).then(
      ([list, config]) => {
        if (cancelled) return
        setState(loadStateOf(modelId, list, config))
      },
    )
    return () => {
      cancelled = true
    }
  }, [trainedModelApi, modelId])

  if (state.status === 'ready') {
    return <ResumeSettingsContent summary={state.summary} initialSettings={state.settings} />
  }
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/models" className={styles.back}>
          ← 一覧
        </Link>
        <h1 className={styles.title}>学習再開</h1>
      </header>
      <main className={styles.main}>
        {state.status === 'loading' ? (
          <p role="status">前回の学習設定を読み込んでいます…</p>
        ) : (
          <p role="alert" className={styles.error}>
            {state.message}
          </p>
        )}
      </main>
    </div>
  )
}

type SubmitState =
  | { readonly status: 'editing' }
  | { readonly status: 'submitting' }
  | {
      readonly status: 'failed'
      readonly message: string
      /**
       * サーバーが見つけた設定・モデル構造の誤り(422 の違反の一覧)。保存したモデル構造が
       * データセットに合わない、など、手元の検証では分からないものを 1 件ずつ出す
       */
      readonly details: readonly string[]
    }

function ResumeSettingsContent({
  summary,
  initialSettings,
}: {
  readonly summary: TrainedModelSummary
  readonly initialSettings: TrainingSettings
}) {
  const navigate = useNavigate()
  const { trainedModelApi } = useDependencies()
  const [settings, setSettings] = useState(initialSettings)
  const [submit, setSubmit] = useState<SubmitState>({ status: 'editing' })

  const capabilities = useCapabilities()
  const deviceIds = useMemo(
    () => (capabilities.status === 'ready' ? selectableDeviceIds(capabilities.capabilities) : null),
    [capabilities],
  )

  // 入力のたびに検証し、問題は欄の横に出す。問題がある間は再開できない
  const validation = useMemo(
    () =>
      validateResumeSettings({
        settings,
        completedEpochs: summary.completedEpochs,
        ...(deviceIds === null ? {} : { availableDevices: deviceIds }),
      }),
    [settings, summary.completedEpochs, deviceIds],
  )

  const canResume = validation.ok && submit.status !== 'submitting'

  const onResume = async () => {
    setSubmit({ status: 'submitting' })
    const result = await resumeTraining(
      { trainedModelApi },
      {
        modelId: summary.modelId,
        settings,
        completedEpochs: summary.completedEpochs,
        ...(deviceIds === null ? {} : { availableDevices: deviceIds }),
      },
    )
    if (result.ok) {
      void navigate(`/progress/${encodeURIComponent(result.jobId)}`)
      return
    }
    setSubmit({
      status: 'failed',
      message:
        result.reason === 'api'
          ? `学習を再開できませんでした: ${result.error.message}`
          : '設定に問題があります。欄の横の表示を確認してください。',
      details:
        result.reason === 'api'
          ? (result.error.issues ?? []).map((issue) =>
              issue.field === undefined || issue.field === 'model_graph'
                ? issue.message
                : `${issue.field}: ${issue.message}`,
            )
          : [],
    })
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/models" className={styles.back}>
          ← 一覧
        </Link>
        <h1 className={styles.title}>学習再開: {summary.modelName}</h1>
        <span className={styles.status} role="status">
          {submit.status === 'submitting'
            ? '学習を再開しています…'
            : validation.ok
              ? '再開できます'
              : '設定に問題があります'}
        </span>
        <div className={styles.spacer} />
        <button
          type="button"
          className={styles.primary}
          disabled={!canResume}
          title={canResume ? undefined : '設定の問題を直すと再開できます'}
          onClick={() => {
            void onResume()
          }}
        >
          学習再開
        </button>
      </header>

      <main className={styles.main}>
        {submit.status === 'failed' && (
          <div role="alert" className={styles.error}>
            <p>{submit.message}</p>
            {submit.details.length > 0 && (
              <ul>
                {submit.details.map((detail) => (
                  // C++ のメッセージは改行で問題を並べるので、改行をそのまま見せる
                  <li key={detail} style={{ whiteSpace: 'pre-wrap' }}>
                    {detail}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <dl className={styles.summary} aria-label="再開するモデル">
          <dt>モデル名</dt>
          <dd>{summary.modelName}</dd>
          <dt>タスク</dt>
          <dd>{IMAGE_TASK_TYPES[summary.task].label}</dd>
          <dt>optimizer</dt>
          <dd>{OPTIMIZER_TYPES[settings.optimizer.kind].label}</dd>
          <dt>完了エポック数</dt>
          <dd>{summary.completedEpochs}</dd>
        </dl>
        <TrainingForm
          settings={settings}
          onChange={(update) => {
            setSettings(update)
            // 直したら、前回の失敗の表示は消す
            setSubmit((current) => (current.status === 'failed' ? { status: 'editing' } : current))
          }}
          issues={validation.issues}
          deviceIds={deviceIds}
          resume={{ completedEpochs: summary.completedEpochs }}
        />
      </main>
    </div>
  )
}
