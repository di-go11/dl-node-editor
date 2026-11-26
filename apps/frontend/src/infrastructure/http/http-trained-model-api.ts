import { z } from 'zod'

import { apiError, apiOk } from '../../application/ports/api-result'
import type { TrainedModelApi } from '../../application/ports/trained-model-api'
import type { TrainedModelSummary } from '../../entity/trained-model/trained-model'

import type { ApiClient, HttpErrorMessages } from './api-client'
import { callApi } from './api-client'
import { configViolationIssues } from './config-violations'
import { trainingStatusJsonSchema } from './http-training-progress'
import {
  fromRustModelConfig,
  rustModelConfigSchema,
  toRustResumeTrainingRequest,
} from './rust-training-request'

/**
 * TrainedModelApi の HTTP 実装(GET /models、GET /models/{model_id}/config、POST /models/{model_id}/resume)。
 */

const modelSummaryJsonSchema = z.object({
  model_id: z.string().min(1),
  model_name: z.string(),
  created_at: z.string(),
  task_type: z.enum(['segmentation', 'classification']),
  last_run: z.object({
    status: trainingStatusJsonSchema,
    reason: z.string().optional(),
    started_at: z.string(),
    finished_at: z.string().nullable(),
  }),
  completed_epochs: z.number().int().nonnegative(),
  resumable: z.boolean(),
})

const modelSummariesJsonSchema = z.object({
  models: z.array(modelSummaryJsonSchema),
})

function summaryFromJson(json: z.infer<typeof modelSummaryJsonSchema>): TrainedModelSummary {
  return {
    modelId: json.model_id,
    modelName: json.model_name,
    createdAt: json.created_at,
    task: json.task_type,
    lastRun: {
      status: json.last_run.status,
      failureReason: json.last_run.reason ?? null,
      startedAt: json.last_run.started_at,
      finishedAt: json.last_run.finished_at,
    },
    completedEpochs: json.completed_epochs,
    resumable: json.resumable,
  }
}

const startResponseSchema = z.object({
  job_id: z.string().min(1),
})

/** 状態コードの説明を、モデルの API の意味にする(既定の説明は学習ジョブ向け) */
const CONFIG_MESSAGES: HttpErrorMessages = {
  404: '指定されたモデルが見つかりません。',
  409: 'このモデルはモデル構造が保存されていないため、再開できません。',
}

const RESUME_MESSAGES: HttpErrorMessages = {
  404: '指定されたモデルが見つかりません。',
  409: '学習を再開できませんでした。実行中の学習がある、checkpoint がない、エポック数が完了済みの数以下、のいずれかです。',
  // 違反の一覧がある 422(設定の値、保存したモデル構造がデータセットに合わない)は、issues に内容が入る
  422: '再開の設定が受け付けられませんでした(optimizer の種類は前回から変えられません)。',
  502: '学習サーバーに接続できません。',
}

export function createHttpTrainedModelApi(client: ApiClient): TrainedModelApi {
  return {
    list: () =>
      callApi(
        () => client.GET('/models'),
        modelSummariesJsonSchema,
        (json) => json.models.map(summaryFromJson),
      ),

    getConfig: async (modelId) => {
      const result = await callApi(
        () => client.GET('/models/{model_id}/config', { params: { path: { model_id: modelId } } }),
        rustModelConfigSchema,
        fromRustModelConfig,
        CONFIG_MESSAGES,
      )
      if (!result.ok) return result
      // 形は正しいが、カタログにない種類などで学習設定にできなかった
      if (!result.value.ok) {
        return apiError({ kind: 'invalid-response', message: result.value.message })
      }
      return apiOk(result.value.value)
    },

    resume: async (modelId, settings) => {
      const request = toRustResumeTrainingRequest(settings)
      if (!request.ok) return apiError({ kind: 'invalid-request', message: request.message })
      return callApi(
        () =>
          client.POST('/models/{model_id}/resume', {
            params: { path: { model_id: modelId } },
            body: request.value,
          }),
        startResponseSchema,
        // 応答に状態は含まれない。受理された時点で学習は実行中である
        (json) => ({ jobId: json.job_id, status: 'running' as const }),
        RESUME_MESSAGES,
        (status, body) => (status === 422 ? configViolationIssues(body, request.value) : undefined),
      )
    },
  }
}
