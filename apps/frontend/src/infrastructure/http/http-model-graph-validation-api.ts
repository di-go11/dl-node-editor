import { z } from 'zod'

import type { ModelGraphValidationApi } from '../../application/ports/model-graph-validation-api'
import { toProtoJson } from '../../entity/model-graph/proto-json/convert'
import type { ValidationResult } from '../../entity/validation/issue'

import type { ApiClient } from './api-client'
import { callApi, issueFromJson, issueJsonSchema } from './api-client'

/**
 * ModelGraphValidationApi の HTTP 実装(POST /model-graphs/validate)。
 */

const validateResponseSchema = z.object({
  ok: z.boolean(),
  issues: z.array(issueJsonSchema),
})

function toValidationResult(json: z.infer<typeof validateResponseSchema>): ValidationResult {
  return { ok: json.ok, issues: json.issues.map(issueFromJson) }
}

export function createHttpModelGraphValidationApi(client: ApiClient): ModelGraphValidationApi {
  return {
    validate: (graph) =>
      callApi(
        () =>
          client.POST('/model-graphs/validate', {
            body: { model_graph: toProtoJson(graph) },
          }),
        validateResponseSchema,
        toValidationResult,
      ),
  }
}
