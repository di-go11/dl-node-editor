import { z } from 'zod'

import { apiError } from '../../application/ports/api-result'
import type {
  ServerCheck,
  StartedTraining,
  TrainingApi,
} from '../../application/ports/training-api'
import { toStartTrainingRequestJson } from '../../entity/training/proto-json/convert'

import type { ApiClient, HttpErrorMessages } from './api-client'
import { API_BASE_PATH, callApi, callApiByStatus } from './api-client'
import { configViolationIssues } from './config-violations'
import type { ProgressEventSource } from './http-training-progress'
import { listenTrainingProgress, trainingStatusResponseSchema } from './http-training-progress'
import { toRustStartTrainingRequest } from './rust-training-request'

/**
 * TrainingApi の HTTP 実装(POST /trainings/validate、POST /trainings、進捗の SSE、停止)。
 */

const startResponseSchema = z.object({
  job_id: z.string().min(1),
})

/** 学習開始の 422 は、学習設定・モデル構造の拒否のほかに、選んだデータセットがない場合もある */
const START_MESSAGES: HttpErrorMessages = {
  422: '学習設定またはモデル構造が受け付けられませんでした。選んだデータセットが削除されている場合は、選び直してください。',
}

/**
 * 整合性チェックの、違反の一覧のない 422(データセットがない、色表が読めない)と 502(学習エンジンに届かない)。
 * 整合性チェックもグラフの確認のために学習エンジンを呼ぶ
 */
const VALIDATE_MESSAGES: HttpErrorMessages = {
  422: '選んだデータセットが見つからないか、読めません。データセットを選び直してください。',
  502: '学習サーバーに接続できないため、モデル構造を確認できません。',
}

function toStartedTraining(json: z.infer<typeof startResponseSchema>): StartedTraining {
  // 応答に状態は含まれない。受理された時点で学習は実行中である
  return { jobId: json.job_id, status: 'running' }
}

export type HttpTrainingApiOptions = {
  /** SSE の接続先のベース。openapi-fetch を通らないので、別に受け取る */
  readonly baseUrl?: string
  /** Node(テスト)には EventSource がないので、差し替えられるようにしている */
  readonly createEventSource?: (url: string) => ProgressEventSource
}

export function createHttpTrainingApi(
  client: ApiClient,
  options: HttpTrainingApiOptions = {},
): TrainingApi {
  const baseUrl = options.baseUrl ?? API_BASE_PATH
  const createEventSource = options.createEventSource ?? ((url) => new EventSource(url))

  return {
    validate: async (graph, settings) => {
      const request = toRustStartTrainingRequest(toStartTrainingRequestJson(graph, settings))
      if (!request.ok) return apiError({ kind: 'invalid-request', message: request.message })
      return callApiByStatus<ServerCheck>(
        () => client.POST('/trainings/validate', { body: request.value }),
        {
          204: { kind: 'ok' },
          409: { kind: 'model-name-used' },
        },
        VALIDATE_MESSAGES,
        // 設定の誤りの 422 は、違反の一覧という「結果」にする(通信の失敗ではない)
        (status, body) => {
          if (status !== 422) return undefined
          const issues = configViolationIssues(body, request.value)
          return issues === undefined ? undefined : { kind: 'invalid-config', issues }
        },
      )
    },

    start: async (graph, settings) => {
      const request = toRustStartTrainingRequest(toStartTrainingRequestJson(graph, settings))
      if (!request.ok) return apiError({ kind: 'invalid-request', message: request.message })
      return callApi(
        () => client.POST('/trainings', { body: request.value }),
        startResponseSchema,
        toStartedTraining,
        START_MESSAGES,
        (status, body) => (status === 422 ? configViolationIssues(body, request.value) : undefined),
      )
    },

    subscribeProgress: (jobId, listener) =>
      listenTrainingProgress(
        createEventSource(`${baseUrl}/trainings/${encodeURIComponent(jobId)}/progress`),
        listener,
      ),

    stop: (jobId) =>
      callApi(
        () => client.POST('/trainings/{job_id}/stop', { params: { path: { job_id: jobId } } }),
        trainingStatusResponseSchema,
        (json) => json.status,
      ),
  }
}
