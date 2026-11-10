import type { ParamValue } from '../model-graph/node-spec'
import type { ParamDef } from '../param/param-def'
import { paramErrorOf } from '../param/param-def'
import { ANNOTATION_TYPES, IMAGE_SIZE_DEFS, IMAGE_TASK_TYPES } from '../training/data-spec'
import { LOSS_TYPES } from '../training/loss'
import { OPTIMIZER_TYPES } from '../training/optimizer'
import type { TrainingSettings } from '../training/training-settings'
import {
  DEVICE_PATTERN,
  MODEL_NAME_PATTERN,
  TRAINING_NUMBER_DEFS,
} from '../training/training-settings'
import type { Variant, VariantCatalog } from '../training/variant'

import type { Issue, IssueCode, ValidationResult } from './issue'
import { issueError, sortIssuesBySeverity, toValidationResult } from './issue'

/**
 * 学習設定のチェック(指示書 8 章 (2))。
 *
 * モデル構造のチェック(validate-model-graph.ts)と同じく「ルールの配列」で組み立て、
 * 1 件目で打ち切らずに全件を報告する。
 *
 * ## 制約をどこから取るか
 *
 * 数値の制約は、カタログの ParamDef(OPTIMIZER_TYPES、TRAINING_NUMBER_DEFS など)から
 * paramSchemaOf で導く。ここに `if (epoch < 1)` のような条件を書き直さない。
 * 学習設定画面の入力欄も同じ ParamDef を読むので、画面と検証の制約がずれない。
 *
 * ## エラーメッセージ
 *
 * Zod の既定のメッセージ(英語)は使わず、ParamDef の label と制約から
 * 日本語の文を組み立てる(param-def.ts の requirementMessage)。ログを読むのは利用者であり、
 * 「Too small: expected number to be >0」より「学習率は 0 より大きい数値にしてください」
 * のほうが、何をすればよいかが分かる。
 *
 * Issue の field には JSON 表記のパス(例 'optimizer.adam.learning_rate')を入れる。
 * C++ 側(TrainingProtoMapper.cpp)のエラーメッセージと同じ書き方である。
 */

export type TrainingValidationInput = {
  readonly settings: TrainingSettings
  /**
   * capabilities API で得たデバイス名の一覧(例 ['cpu', 'cuda:0'])。
   *
   * エンティティ層は API を呼べないので、一覧の取得は外側(application 層)に任せ、
   * 結果だけを受け取る。まだ取得できていなければ undefined にし、そのときは
   * 書式だけを確かめる。
   */
  readonly availableDevices?: readonly string[]
}

export type TrainingValidationRule = (input: TrainingValidationInput) => readonly Issue[]

// ------------------------------------------------------------
// 共通の部品
// ------------------------------------------------------------

function checkValue(
  value: ParamValue | undefined,
  def: ParamDef,
  label: string,
  field: string,
  code: IssueCode,
): Issue | null {
  const message = paramErrorOf(def, value, label)
  return message === null ? null : issueError(code, message, { field })
}

function requireNonEmpty(value: string, label: string, field: string): Issue | null {
  // 空白だけの文字列も「未入力」とみなす。パスの入れ忘れを見逃さないため
  if (value.trim() !== '') return null
  return issueError('training/required', `${label} を入力してください。`, { field })
}

/**
 * oneof 1 つぶん(optimizer、loss など)のパラメータを、カタログの定義で確かめる。
 *
 * 次の 3 種類を区別して報告する。
 *   - param-unknown … 定義にないパラメータ(綴り間違い、古い保存ファイルの残り)
 *   - param-missing … 定義にあるのに値がない
 *   - param-invalid … 値が制約を満たさない
 */
function checkVariant<K extends string>(
  catalog: VariantCatalog<K>,
  variant: Variant<K>,
  sectionLabel: string,
  fieldPrefix: string,
): readonly Issue[] {
  const def = catalog[variant.kind]
  const issues: Issue[] = []
  const at = (name: string): string => `${fieldPrefix}.${variant.kind}.${name}`
  const labelOf = (name: string): string =>
    `${sectionLabel}(${def.label})の ${def.params[name]?.label ?? name}`

  for (const name of Object.keys(variant.params)) {
    if (!Object.hasOwn(def.params, name)) {
      issues.push(
        issueError(
          'training/param-unknown',
          `${sectionLabel}(${def.label})に ${name} というパラメータはありません。`,
          { field: at(name) },
        ),
      )
    }
  }

  for (const [name, paramDef] of Object.entries(def.params)) {
    if (!Object.hasOwn(variant.params, name)) {
      issues.push(
        issueError('training/param-missing', `${labelOf(name)} が設定されていません。`, {
          field: at(name),
        }),
      )
      continue
    }
    const issue = checkValue(
      variant.params[name],
      paramDef,
      labelOf(name),
      at(name),
      'training/param-invalid',
    )
    if (issue !== null) issues.push(issue)
  }

  return issues
}

const compact = (issues: readonly (Issue | null)[]): readonly Issue[] =>
  issues.filter((issue): issue is Issue => issue !== null)

// ------------------------------------------------------------
// ルール
// ------------------------------------------------------------

/** model_name: 必須。checkpoint のファイル名になるので、使える文字が限られる */
export const validateModelName: TrainingValidationRule = ({ settings }) => {
  const missing = requireNonEmpty(settings.modelName, 'モデル名', 'model_name')
  if (missing !== null) return [missing]
  if (MODEL_NAME_PATTERN.test(settings.modelName)) return []
  return [
    issueError(
      'training/invalid-format',
      'モデル名に使えるのは英数字と - _ だけです(checkpoint のファイル名に使われるため)。',
      { field: 'model_name' },
    ),
  ]
}

/** dataset_path: 必須。存在するかはサーバーにしか分からないので、ここでは確かめない */
export const validateDatasetPath: TrainingValidationRule = ({ settings }) =>
  compact([requireNonEmpty(settings.datasetPath, 'データセットのパス', 'dataset_path')])

/**
 * device: 必須。一覧があればその中から選ばれているか、なければ書式を確かめる。
 *
 * 一覧があるときに書式ではなく「一覧に含まれるか」で判定するのは、'cuda:1' は
 * 書式として正しくても、GPU が 1 枚しかないサーバーでは使えないためである。
 */
export const validateDevice: TrainingValidationRule = ({ settings, availableDevices }) => {
  const missing = requireNonEmpty(settings.device, 'デバイス', 'device')
  if (missing !== null) return [missing]

  if (availableDevices !== undefined) {
    if (availableDevices.includes(settings.device)) return []
    const choices = availableDevices.length > 0 ? availableDevices.join(' / ') : '(なし)'
    return [
      issueError(
        'training/unknown-device',
        `デバイス ${settings.device} はこのサーバーでは使えません。使えるのは次のとおりです: ${choices}`,
        { field: 'device' },
      ),
    ]
  }

  if (DEVICE_PATTERN.test(settings.device)) return []
  return [
    issueError(
      'training/invalid-format',
      `デバイスは cpu / cuda / cuda:0 のような形で指定してください(${settings.device})。`,
      { field: 'device' },
    ),
  ]
}

/** epoch / batch / save_last_every / seed の範囲 */
export const validateTrainingNumbers: TrainingValidationRule = ({ settings }) => {
  const defs = TRAINING_NUMBER_DEFS
  const check = (value: number, def: ParamDef, field: string): Issue | null =>
    checkValue(value, def, def.label, field, 'training/out-of-range')

  return compact([
    check(settings.epoch, defs.epoch, 'epoch'),
    check(settings.batch, defs.batch, 'batch'),
    check(settings.saveLastEvery, defs.save_last_every, 'save_last_every'),
    // null は「固定しない」という正当な選択なので、値があるときだけ確かめる
    settings.seed === null ? null : check(settings.seed, defs.seed, 'seed.value'),
  ])
}

export const validateOptimizer: TrainingValidationRule = ({ settings }) =>
  checkVariant(OPTIMIZER_TYPES, settings.optimizer, 'optimizer', 'optimizer')

export const validateLoss: TrainingValidationRule = ({ settings }) =>
  checkVariant(LOSS_TYPES, settings.loss, 'loss', 'loss')

export const validateDataSpec: TrainingValidationRule = ({ settings }) => {
  const spec = settings.dataSpec
  // データの種類が増えたら、ここの switch が網羅性の検査で知らせてくれる
  switch (spec.kind) {
    case 'image': {
      const at = (name: string): string => `data_spec.image.${name}`
      return [
        ...compact([
          checkValue(
            spec.inputWidth,
            IMAGE_SIZE_DEFS.input_width,
            IMAGE_SIZE_DEFS.input_width.label,
            at('input_width'),
            'training/out-of-range',
          ),
          checkValue(
            spec.inputHeight,
            IMAGE_SIZE_DEFS.input_height,
            IMAGE_SIZE_DEFS.input_height.label,
            at('input_height'),
            'training/out-of-range',
          ),
        ]),
        ...checkVariant(ANNOTATION_TYPES, spec.annotation, 'アノテーション', at('annotation')),
        ...checkVariant(IMAGE_TASK_TYPES, spec.task, 'タスク', at('task_specs')),
      ]
    }
  }
}

/**
 * タスクが学習エンジンで使えるか(IMAGE_TASK_TYPES の available)。
 * 選べるようにはしているが、未対応のタスクのまま学習を始めると、C++ がデータセットの
 * 読み込みで失敗する。始める前に止める。
 */
export const validateTaskAvailability: TrainingValidationRule = ({ settings }) => {
  const task = settings.dataSpec.task
  const def = IMAGE_TASK_TYPES[task.kind]
  if (def.available) return []
  return [
    issueError(
      'training/task-unavailable',
      `タスク「${def.label}」はまだ使えません(${def.note ?? '未対応です'})。`,
      { field: `data_spec.image.task_specs.${task.kind}` },
    ),
  ]
}

/**
 * loss とタスクの組み合わせ(未決事項 1。ユーザーと合意済み)。
 * 使える組み合わせは LOSS_TYPES の tasks にデータとして書いてあり、ここはそれを読むだけ。
 */
export const validateLossTask: TrainingValidationRule = ({ settings }) => {
  const loss = LOSS_TYPES[settings.loss.kind]
  const taskKind = settings.dataSpec.task.kind
  if ((loss.tasks as readonly string[]).includes(taskKind)) return []

  const task = IMAGE_TASK_TYPES[taskKind]
  const usable = loss.tasks.map((kind) => IMAGE_TASK_TYPES[kind].label)
  const hint =
    usable.length === 0 ? '今はどのタスクでも使えません。' : `使えるタスク: ${usable.join('、')}。`
  return [
    issueError(
      'training/loss-task-mismatch',
      `loss「${loss.label}」はタスク「${task.label}」では使えません。${hint}`,
      { field: `loss.${settings.loss.kind}` },
    ),
  ]
}

/**
 * 並びは学習設定画面の項目の並び(≒ proto のフィールド順)に合わせている。
 * ログに出る順と画面の上からの順がそろい、どこを直せばよいかを探しやすい。
 *
 * loss とタスクの組み合わせ(未決事項 1)は validateLossTask が見る。
 */
export const TRAINING_RULES: readonly TrainingValidationRule[] = [
  validateModelName,
  validateOptimizer,
  validateLoss,
  validateTrainingNumbers,
  validateDatasetPath,
  validateDevice,
  validateDataSpec,
  validateTaskAvailability,
  validateLossTask,
]

export function validateTrainingSettings(input: TrainingValidationInput): ValidationResult {
  const issues = TRAINING_RULES.flatMap((rule) => rule(input))
  return toValidationResult(sortIssuesBySeverity(issues))
}
