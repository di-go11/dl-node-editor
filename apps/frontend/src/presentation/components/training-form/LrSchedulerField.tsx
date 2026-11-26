import { useId } from 'react'

import type {
  LrSchedulerKind,
  LrSchedulerSettings,
  LrUpdateInterval,
} from '../../../entity/training/lr-scheduler'
import {
  defaultUpdateIntervalOf,
  LR_SCHEDULER_TYPES,
  LR_UPDATE_INTERVAL_LABELS,
  LR_UPDATE_INTERVALS,
  WARMUP_EPOCHS_DEF,
} from '../../../entity/training/lr-scheduler'
import { ParamField } from '../param-form/ParamField'

import styles from './TrainingForm.module.css'
import { VariantField } from './VariantField'

/**
 * 学習率スケジューラの欄(issue「学習の安定化」の段階 3b)。
 *
 * 種類とそのパラメータは VariantField(optimizer と同じ部品)、更新の単位と warmup はこの部品が出す。
 * none のときは、更新の単位と warmup を出さない(学習率を変えないので意味がない)。
 * 種類を選び直したら、更新の単位はその種類の初期値にする(poly / cosine → バッチごと、step → エポックごと)。
 *
 * 学習再開では変えられない(保存した設定で再開する)ので、内容を表示するだけにする。
 */

export type LrSchedulerFieldProps = {
  readonly value: LrSchedulerSettings
  readonly onChange: (update: (value: LrSchedulerSettings) => LrSchedulerSettings) => void
  /** 欄の下に出す問題(ほかの項目との組み合わせ、再開で曲線がつながらない warning など) */
  readonly messages: readonly string[]
  /** 学習再開のときは表示だけにする */
  readonly readOnly?: boolean
}

/** 「Poly(power 0.9)、バッチごと、warmup 1 エポック」のような要約 */
function summaryOf(value: LrSchedulerSettings): string {
  const def = LR_SCHEDULER_TYPES[value.scheduler.kind]
  if (value.scheduler.kind === 'none') return def.label
  const params = Object.entries(value.scheduler.params)
    .map(([name, param]) => `${name} ${String(param)}`)
    .join('、')
  const warmup = value.warmupEpochs === 0 ? 'warmup なし' : `warmup ${value.warmupEpochs} エポック`
  return `${def.label}(${params})、${LR_UPDATE_INTERVAL_LABELS[value.updateInterval]}、${warmup}`
}

function isUpdateInterval(value: string): value is LrUpdateInterval {
  return (LR_UPDATE_INTERVALS as readonly string[]).includes(value)
}

export function LrSchedulerField({ value, onChange, messages, readOnly = false }: LrSchedulerFieldProps) {
  const intervalId = useId()

  if (readOnly) {
    return (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>
          学習率スケジューラ
          <span className={styles.name}>lr_scheduler</span>
        </legend>
        <p className={styles.description}>{summaryOf(value)}</p>
        <p className={styles.hint}>再開では変えられません(前回の学習と同じ設定を使います)。</p>
        {messages.map((message) => (
          <p key={message} className={styles.error}>
            {message}
          </p>
        ))}
      </fieldset>
    )
  }

  const scheduling = value.scheduler.kind !== 'none'
  const extraFields = scheduling ? (
    <>
      <div className={styles.field}>
        <label htmlFor={intervalId} className={styles.label}>
          更新の単位
          <span className={styles.name}>update_interval</span>
        </label>
        <select
          id={intervalId}
          className={styles.select}
          value={value.updateInterval}
          onChange={(event) => {
            const next = event.target.value
            if (isUpdateInterval(next)) onChange((current) => ({ ...current, updateInterval: next }))
          }}
        >
          {LR_UPDATE_INTERVALS.map((interval) => (
            <option key={interval} value={interval}>
              {LR_UPDATE_INTERVAL_LABELS[interval]}
            </option>
          ))}
        </select>
      </div>
      <ParamField
        name="warmup_epochs"
        def={WARMUP_EPOCHS_DEF}
        value={value.warmupEpochs}
        onCommit={(next) => {
          if (typeof next === 'number') onChange((current) => ({ ...current, warmupEpochs: next }))
        }}
      />
    </>
  ) : undefined

  return (
    <VariantField<LrSchedulerKind>
      legend="学習率スケジューラ"
      name="lr_scheduler"
      catalog={LR_SCHEDULER_TYPES}
      variant={value.scheduler}
      onChange={(scheduler) =>
        onChange((current) =>
          scheduler.kind === current.scheduler.kind
            ? { ...current, scheduler }
            : {
                scheduler,
                // 種類を選び直したら、更新の単位はその種類の初期値にする。none では warmup しない
                updateInterval: defaultUpdateIntervalOf(scheduler.kind),
                warmupEpochs: scheduler.kind === 'none' ? 0 : current.warmupEpochs,
              },
        )
      }
      messages={messages}
      hint={
        <>
          <p className={styles.hint}>
            基準の学習率は optimizer の学習率です。進捗の画面で、エポックごとの学習率をグラフで確かめられます。
          </p>
          {extraFields}
        </>
      }
    />
  )
}
