import { z } from 'zod'

import type { StartedTraining, TrainingApi } from '../../application/ports/training-api'
import {
  toStartTrainingRequestJson,
  trainingStatusFromJson,
} from '../../entity/training/proto-json/convert'
import { trainingStatusJsonSchema } from '../../entity/training/proto-json/schema'

import type { ApiClient } from './api-client'
import { callApi } from './api-client'

/**
 * TrainingApi の HTTP 実装(POST /trainings)。進捗(SSE)と停止はフェーズ 6 で足す。
 */

const startResponseSchema = z.object({
  job_id: z.string().min(1),
  status: trainingStatusJsonSchema,
})

function toStartedTraining(json: z.infer<typeof startResponseSchema>): StartedTraining {
  return { jobId: json.job_id, status: trainingStatusFromJson(json.status) }
}

export function createHttpTrainingApi(client: ApiClient): TrainingApi {
  return {
    start: (graph, settings) =>
      callApi(
        () =>
          client.POST('/trainings', {
            body: toStartTrainingRequestJson(graph, settings),
          }),
        startResponseSchema,
        toStartedTraining,
      ),
  }
}
