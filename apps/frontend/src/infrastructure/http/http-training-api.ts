import { z } from 'zod'

import { apiError } from '../../application/ports/api-result'
import type { StartedTraining, TrainingApi } from '../../application/ports/training-api'
import { toStartTrainingRequestJson } from '../../entity/training/proto-json/convert'

import type { ApiClient } from './api-client'
import { API_BASE_PATH, callApi } from './api-client'
import type { ProgressEventSource } from './http-training-progress'
import { listenTrainingProgress, trainingStatusResponseSchema } from './http-training-progress'
import { toRustStartTrainingRequest } from './rust-training-request'

/**
 * TrainingApi の HTTP 実装(POST /trainings、進捗の SSE、停止)。
 */

const startResponseSchema = z.object({
  job_id: z.string().min(1),
})

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
    start: async (graph, settings) => {
      const request = toRustStartTrainingRequest(toStartTrainingRequestJson(graph, settings))
      if (!request.ok) return apiError({ kind: 'invalid-request', message: request.message })
      return callApi(
        () => client.POST('/trainings', { body: request.value }),
        startResponseSchema,
        toStartedTraining,
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
