import { useId } from 'react'

import type { ParamValue } from '../../../entity/model-graph/node-spec'
import type { IntParamDef } from '../../../entity/param/param-def'
import {
  ANNOTATION_TYPES,
  IMAGE_SIZE_DEFS,
  IMAGE_TASK_TYPES,
} from '../../../entity/training/data-spec'
import type { ImageTaskKind } from '../../../entity/training/data-spec'
import type { LossInput, LossKind } from '../../../entity/training/loss'
import { LOSS_TYPES } from '../../../entity/training/loss'
import { OPTIMIZER_TYPES } from '../../../entity/training/optimizer'
import type { TrainingSettings } from '../../../entity/training/training-settings'
import { TRAINING_NUMBER_DEFS } from '../../../entity/training/training-settings'
import type { Issue } from '../../../entity/validation/issue'
import { ParamField } from '../param-form/ParamField'

import { DatasetField } from './DatasetField'
import { LrSchedulerField } from './LrSchedulerField'
import styles from './TrainingForm.module.css'
import type { UseDatasets } from '../dataset/use-datasets'
import { VariantField } from './VariantField'

/**
 * 学習設定のフォーム(指示書 4.4)。training.proto の StartTrainingRequest の項目を編集する。
 *
 * 数値の欄はすべて、カタログの ParamDef から ParamField が作る(プロパティパネルと同じ部品)。
 * oneof(optimizer / loss / annotation / task)は VariantField が作る。
 * 制約や選択肢をこの部品に書き直さないので、カタログを変えればフォームも変わる。
 *
 * 入力のたびに onChange で学習設定を書き換える。書き換えると文書の training の参照が変わり、
 * 整合性チェックの状態機械が自動で「再チェックが必要」になる(application/run-state)。
 *
 * ## 学習再開(resume を渡したとき)
 *
 * 学習再開画面でも同じフォームを使い、再開で変えられない欄だけを外す(issue doc 作業 7)。
 *   - 外す欄: model_name、データセット、データ(入力サイズ・アノテーション・タスク)、seed
 *   - optimizer は種類の選択だけを無効にし、ハイパーパラメータは変えられる
 *   - epoch は合計エポック数なので、前回までに完了したエポック数を添える
 */

export type TrainingFormProps = {
  readonly settings: TrainingSettings
  readonly onChange: (update: (settings: TrainingSettings) => TrainingSettings) => void
  /** 学習設定のチェックの結果(欄の横に出す)。数値の制約違反は ParamField が自分で出す */
  readonly issues: readonly Issue[]
  /** 選べるデバイス。capabilities を取得できていなければ null(自由に入力させる) */
  readonly deviceIds: readonly string[] | null
  /** データセットの選択肢(useDatasets の結果)。新規学習でだけ使う(再開ではデータセットを変えられない) */
  readonly datasets?: UseDatasets
  /** 学習再開のフォームにする(省略すれば新規学習) */
  readonly resume?: {
    /** 前回までに完了したエポック数 */
    readonly completedEpochs: number
  }
}

/** 数値の項目 1 つぶんの欄(ParamField を使う)を作る関数 */
function numberFieldOf(onChange: TrainingFormProps['onChange']) {
  return (
    name: string,
    def: IntParamDef,
    value: number,
    apply: (settings: TrainingSettings, value: number) => TrainingSettings,
  ) => (
    <ParamField
      name={name}
      def={def}
      value={value}
      onCommit={(next: ParamValue) => {
        if (typeof next === 'number') onChange((current) => apply(current, next))
      }}
    />
  )
}

const OPTIMIZER_LOCKED_REASON =
  '再開では optimizer の種類を変えられません(checkpoint の optimizer の状態を引き継ぐため)。'

const LOSS_INPUT_HINT: Readonly<Record<LossInput, string>> = {
  logits:
    '入力: softmax をかける前の値(logits)。loss の中で softmax をかけるので、Output の直前に Softmax を置かない。',
  probabilities:
    '入力: 確率。loss の中では softmax をかけないので、Output の直前に Softmax(dim = 1)を置く。',
  raw: '入力: 値をそのまま比べる。',
}

/** field がこの名前か、その下(name. で始まる)の問題のメッセージ */
function messagesFor(issues: readonly Issue[], field: string): readonly string[] {
  return issues
    .filter((issue) => issue.field === field || issue.field?.startsWith(`${field}.`) === true)
    .map((issue) => issue.message)
}

function TextField({
  label,
  name,
  value,
  onChange,
  placeholder,
  messages,
}: {
  readonly label: string
  readonly name: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder?: string
  readonly messages: readonly string[]
}) {
  const id = useId()
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        <span className={styles.name}>{name}</span>
      </label>
      <input
        id={id}
        className={styles.input}
        value={value}
        placeholder={placeholder}
        aria-invalid={messages.length > 0}
        onChange={(event) => onChange(event.target.value)}
      />
      {messages.map((message) => (
        <p key={message} className={styles.error}>
          {message}
        </p>
      ))}
    </div>
  )
}

export function TrainingForm({
  settings,
  onChange,
  issues,
  deviceIds,
  datasets,
  resume,
}: TrainingFormProps) {
  const deviceId = useId()
  const seedId = useId()
  const task = settings.dataSpec.task.kind
  const resuming = resume !== undefined
  const numberField = numberFieldOf(onChange)

  // 一覧にないデバイス(保存ファイルに残っていた値など)も、選択肢に残して見えるようにする
  const deviceOptions =
    deviceIds === null || settings.device === '' || deviceIds.includes(settings.device)
      ? deviceIds
      : [...deviceIds, settings.device]

  return (
    <div className={styles.form}>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>基本</legend>
        {/* 再開ではモデル名は変えられない(画面の見出しに出す) */}
        {!resuming && (
          <TextField
            label="モデル名"
            name="model_name"
            value={settings.modelName}
            onChange={(modelName) => onChange((s) => ({ ...s, modelName }))}
            messages={messagesFor(issues, 'model_name')}
          />
        )}
        {/* 再開ではデータセットは変えられない(サーバーが前回のデータセットを使う) */}
        {resuming ? (
          <p className={styles.hint}>データセットは前回の学習と同じものを使います。</p>
        ) : (
          <DatasetField
            value={settings.datasetId}
            onChange={(datasetId) => onChange((s) => ({ ...s, datasetId }))}
            datasets={datasets?.state ?? { status: 'loading' }}
            onReload={() => datasets?.reload()}
            messages={messagesFor(issues, 'dataset_id')}
          />
        )}
        <div className={styles.field}>
          <label htmlFor={deviceId} className={styles.label}>
            デバイス
            <span className={styles.name}>device</span>
          </label>
          {deviceOptions === null ? (
            // capabilities を取得できないときは、自由に入力させる(書式は検証が確かめる)
            <input
              id={deviceId}
              className={styles.input}
              value={settings.device}
              placeholder="cpu / cuda:0"
              onChange={(event) => onChange((s) => ({ ...s, device: event.target.value }))}
            />
          ) : (
            <select
              id={deviceId}
              className={styles.select}
              value={settings.device}
              onChange={(event) => onChange((s) => ({ ...s, device: event.target.value }))}
            >
              <option value="">(選んでください)</option>
              {deviceOptions.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          )}
          {messagesFor(issues, 'device').map((message) => (
            <p key={message} className={styles.error}>
              {message}
            </p>
          ))}
        </div>
      </fieldset>

      <VariantField
        legend="optimizer"
        name="optimizer"
        catalog={OPTIMIZER_TYPES}
        variant={settings.optimizer}
        onChange={(optimizer) => onChange((s) => ({ ...s, optimizer }))}
        {...(resuming ? { kindLockedReason: OPTIMIZER_LOCKED_REASON } : {})}
      />

      <LrSchedulerField
        value={settings.lrScheduler}
        onChange={(update) => onChange((s) => ({ ...s, lrScheduler: update(s.lrScheduler) }))}
        // 数値の範囲は ParamField が自分で出すので、ほかの項目との組み合わせと、サーバー・再開の問題だけを出す
        messages={issues
          .filter(
            (issue) =>
              (issue.field === 'lr_scheduler' || issue.field?.startsWith('lr_scheduler.') === true) &&
              (issue.code === 'training/lr-scheduler-conflict' ||
                issue.code === 'training/lr-schedule-discontinuous' ||
                issue.code === 'training/server-rejected'),
          )
          .map((issue) => issue.message)}
        readOnly={resuming}
      />

      <VariantField<LossKind>
        legend="loss"
        name="loss"
        catalog={LOSS_TYPES}
        variant={settings.loss}
        onChange={(loss) => onChange((s) => ({ ...s, loss }))}
        // 今のタスクで使えない loss には印を付ける(選べるが、チェックで止まる)
        optionLabel={(kind) =>
          (LOSS_TYPES[kind].tasks as readonly string[]).includes(task)
            ? LOSS_TYPES[kind].label
            : `${LOSS_TYPES[kind].label}(このタスクでは使えません)`
        }
        messages={issues
          .filter((issue) => issue.code === 'training/loss-task-mismatch')
          .map((issue) => issue.message)}
        hint={
          <p className={styles.hint}>{LOSS_INPUT_HINT[LOSS_TYPES[settings.loss.kind].input]}</p>
        }
      />

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>学習の回数と保存</legend>
        {numberField('epoch', TRAINING_NUMBER_DEFS.epoch, settings.epoch, (s, epoch) => ({
          ...s,
          epoch,
        }))}
        {resume !== undefined && (
          <>
            <p className={styles.hint}>
              合計のエポック数です。前回までに {resume.completedEpochs}{' '}
              エポック完了しているので、続きの {resume.completedEpochs + 1}{' '}
              エポック目から学習します。
            </p>
            {issues
              .filter((issue) => issue.code === 'training/epoch-not-increased')
              .map((issue) => (
                <p key={issue.message} className={styles.error}>
                  {issue.message}
                </p>
              ))}
          </>
        )}
        {numberField('batch', TRAINING_NUMBER_DEFS.batch, settings.batch, (s, batch) => ({
          ...s,
          batch,
        }))}
        {numberField(
          'save_last_every',
          TRAINING_NUMBER_DEFS.save_last_every,
          settings.saveLastEvery,
          (s, saveLastEvery) => ({ ...s, saveLastEvery }),
        )}
        {/* 再開では seed は効かない(C++ が checkpoint の乱数の状態を書き戻す)ので出さない */}
        {!resuming && (
          <div className={styles.field}>
            <label htmlFor={seedId} className={styles.checkboxLabel}>
              <input
                id={seedId}
                type="checkbox"
                checked={settings.seed !== null}
                // 0 も有効なシードなので、「固定しない」は null で表す(training.proto の Seed)
                onChange={(event) =>
                  onChange((s) => ({
                    ...s,
                    seed: event.target.checked
                      ? (s.seed ?? TRAINING_NUMBER_DEFS.seed.default)
                      : null,
                  }))
                }
              />
              乱数シードを固定する(再現性のため)
            </label>
          </div>
        )}
        {!resuming &&
          settings.seed !== null &&
          numberField('seed', TRAINING_NUMBER_DEFS.seed, settings.seed, (s, seed) => ({
            ...s,
            seed,
          }))}
      </fieldset>

      {/* データの仕様は再開では変えられない(出力チャンネル数や前回の条件と合わなくなる) */}
      {!resuming && <DataSpecFields settings={settings} onChange={onChange} issues={issues} />}
    </div>
  )
}

/** データ(入力サイズ・アノテーション・タスク)の欄。新規学習でだけ出す */
function DataSpecFields({
  settings,
  onChange,
  issues,
}: Pick<TrainingFormProps, 'settings' | 'onChange' | 'issues'>) {
  const numberField = numberFieldOf(onChange)

  return (
    <>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>データ(画像)</legend>
        {numberField(
          'input_width',
          IMAGE_SIZE_DEFS.input_width,
          settings.dataSpec.inputWidth,
          (s, inputWidth) => ({ ...s, dataSpec: { ...s.dataSpec, inputWidth } }),
        )}
        {numberField(
          'input_height',
          IMAGE_SIZE_DEFS.input_height,
          settings.dataSpec.inputHeight,
          (s, inputHeight) => ({ ...s, dataSpec: { ...s.dataSpec, inputHeight } }),
        )}
      </fieldset>

      <VariantField
        legend="アノテーションの形式"
        name="annotation"
        catalog={ANNOTATION_TYPES}
        variant={settings.dataSpec.annotation}
        onChange={(annotation) =>
          onChange((s) => ({ ...s, dataSpec: { ...s.dataSpec, annotation } }))
        }
      />

      <VariantField<ImageTaskKind>
        legend="タスク"
        name="task_specs"
        catalog={IMAGE_TASK_TYPES}
        variant={settings.dataSpec.task}
        onChange={(next) => onChange((s) => ({ ...s, dataSpec: { ...s.dataSpec, task: next } }))}
        optionLabel={(kind) => {
          const def = IMAGE_TASK_TYPES[kind]
          return def.available ? def.label : `${def.label}(未対応)`
        }}
        messages={issues
          .filter((issue) => issue.code === 'training/task-unavailable')
          .map((issue) => issue.message)}
      />
    </>
  )
}
