import { z } from 'zod'

import { apiError } from '../../application/ports/api-result'
import type { DatasetApi, DatasetUpload } from '../../application/ports/dataset-api'
import type { DatasetSummary } from '../../entity/dataset/dataset'
import { ANNOTATION_TYPES } from '../../entity/training/data-spec'

import type { ApiClient, HttpErrorMessages } from './api-client'
import { callApi, callApiByStatus } from './api-client'

/**
 * DatasetApi の HTTP 実装(GET /datasets、POST /datasets/upload)。
 */

const datasetSummaryJsonSchema = z.object({
  dataset_id: z.string().min(1),
  dataset_name: z.string(),
  dataset_type: z.string(),
  created_at: z.string(),
})

export const datasetSummariesJsonSchema = z.object({
  datasets: z.array(datasetSummaryJsonSchema),
})

export type DatasetSummaryJson = z.infer<typeof datasetSummaryJsonSchema>

function summaryFromJson(json: DatasetSummaryJson): DatasetSummary {
  return {
    datasetId: json.dataset_id,
    name: json.dataset_name,
    type: json.dataset_type,
    createdAt: json.created_at,
  }
}

/** アップロードの状態コードの説明(422 だけは本文があり、uploadLayoutMessage で足りないものを並べる) */
const UPLOAD_MESSAGES: HttpErrorMessages = {
  400: 'zip・名前・形式のどれかが足りません。',
  413: 'ファイルが大きすぎます(サーバーの受信上限を超えています)。',
  422: 'zip の中身が、選んだ形式のフォルダ構成になっていません。',
  500: 'データセットを保存できませんでした。zip が壊れている、解凍後のサイズが上限を超えている、などの可能性があります。',
}

/** 422(形式のフォルダ構成になっていない)の本文。契約の DatasetLayoutMismatch */
const layoutMismatchJsonSchema = z.object({
  format: z.string(),
  missing: z.array(z.string()),
})

/** 422 の本文から、足りないものを並べた説明を作る。本文が契約の形でなければ undefined(状態コードの説明を使う) */
export function uploadLayoutMessage(body: unknown): string | undefined {
  const parsed = layoutMismatchJsonSchema.safeParse(body)
  if (!parsed.success || parsed.data.missing.length === 0) return undefined
  const { format, missing } = parsed.data
  const label =
    format in ANNOTATION_TYPES
      ? ANNOTATION_TYPES[format as keyof typeof ANNOTATION_TYPES].label
      : format
  return `zip の中身が「${label}」形式のフォルダ構成になっていません。足りないもの: ${missing.join('、')}`
}

/** multipart/form-data の本文を作る(項目名は契約の file / name / type) */
function toFormData(upload: DatasetUpload): FormData {
  const form = new FormData()
  form.append('file', upload.file, upload.fileName)
  form.append('name', upload.name)
  form.append('type', upload.type)
  return form
}

export function createHttpDatasetApi(client: ApiClient): DatasetApi {
  return {
    list: () =>
      callApi(
        () => client.GET('/datasets'),
        datasetSummariesJsonSchema,
        (json) => json.datasets.map(summaryFromJson),
      ),

    upload: async (upload) => {
      // 422 のときだけ本文(足りないファイル)を読み、説明に使う
      let layoutMessage: string | undefined
      const result = await callApiByStatus(
        async () => {
          const fetched = await client.POST('/datasets/upload', {
            // 生成型は binary の file を string にするが、実際に送るのは Blob である。
            // 本文は bodySerializer が作る FormData で、body は型を満たすためだけに渡す
            body: { file: upload.fileName, name: upload.name, type: upload.type },
            // FormData を返すと、openapi-fetch は Content-Type を付けず、ブラウザが境界文字列ごと付ける
            bodySerializer: () => toFormData(upload),
          })
          if (fetched.response.status === 422) layoutMessage = uploadLayoutMessage(fetched.error)
          return fetched
        },
        { 201: null },
        UPLOAD_MESSAGES,
      )
      if (!result.ok && layoutMessage !== undefined) {
        return apiError({ ...result.error, message: layoutMessage })
      }
      return result
    },
  }
}
