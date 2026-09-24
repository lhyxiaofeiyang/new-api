/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { api } from '@/lib/api'

import { OBSERVABILITY_BASE_PATH } from './constants'
import type {
  ObservabilityRequestsResponse,
  ObservabilitySummaryResponse,
  ObservabilityUsageResponse,
  RequestSort,
  SortOrder,
  UsageDimension,
  UsageGranularity,
  UsageMatrix,
} from './types'

/** Query params for the time-range bearing endpoints. */
export interface ObservabilityRangeParams {
  range?: string
  start?: number
  end?: number
}

export interface ObservabilityRequestsParams extends ObservabilityRangeParams {
  page?: number
  page_size?: number
  token_id?: number
  channel_id?: number
  channel_type?: number
  model_name?: string
  group?: string
  is_stream?: boolean
  only_failed?: boolean
  keyword?: string
  sort?: RequestSort
  order?: SortOrder
}

export interface ObservabilityUsageParams extends ObservabilityRangeParams {
  dimension?: UsageDimension
  matrix?: UsageMatrix
  granularity?: UsageGranularity
  limit?: number
}

type ObservableResponse<TData> = {
  success: boolean
  message?: string
  data?: TData
}

function toParams<TParams extends object>(
  params: TParams
): Record<string, unknown> {
  return params as Record<string, unknown>
}

export async function getObservabilitySummary(
  params: ObservabilityRangeParams
): Promise<ObservableResponse<ObservabilitySummaryResponse>> {
  const res = await api.get<ObservableResponse<ObservabilitySummaryResponse>>(
    `${OBSERVABILITY_BASE_PATH}/summary`,
    { params: toParams(params) }
  )
  return res.data
}

export async function getObservabilityRequests(
  params: ObservabilityRequestsParams
): Promise<ObservableResponse<ObservabilityRequestsResponse>> {
  const res = await api.get<ObservableResponse<ObservabilityRequestsResponse>>(
    `${OBSERVABILITY_BASE_PATH}/requests`,
    { params: toParams(params) }
  )
  return res.data
}

export async function getObservabilityUsage(
  params: ObservabilityUsageParams
): Promise<ObservableResponse<ObservabilityUsageResponse>> {
  const res = await api.get<ObservableResponse<ObservabilityUsageResponse>>(
    `${OBSERVABILITY_BASE_PATH}/usage`,
    { params: toParams(params) }
  )
  return res.data
}

/** Downloaded export plus the metadata the download path needs to warn the user. */
export interface ObservabilityExportDownload {
  blob: Blob
  /** True when the server capped the export; `total` is the untruncated count. */
  truncated: boolean
  /** Rows the server matched before applying its cap. */
  total: number
  /** Rows actually written into the file. */
  exported: number
}

// 服务端在 CSV 末尾追加 `# truncated: total=<n> exported=<m>` 标记行。之所以
// 解析正文而不是读自定义响应头：跨域部署时未 Expose-Headers 的头在浏览器里读不到。
const TRUNCATED_TRAILER = /^# truncated: total=(\d+) exported=(\d+)$/m

/**
 * Export reuses the shared api client so the request carries the same bearer
 * token (the endpoint is under `AdminAuth`) and the failure handling is
 * identical to the other observability GETs. The response body is opaque to
 * us — the server owns the CSV/JSON shape and strips API keys.
 */
export async function downloadObservabilityRequests(
  params: ObservabilityRequestsParams,
  format: 'csv' | 'json'
): Promise<ObservabilityExportDownload> {
  const res = await api.get<Blob>(
    `${OBSERVABILITY_BASE_PATH}/requests/export`,
    {
      params: toParams({ ...params, format }),
      responseType: 'blob',
    }
  )
  if (format === 'json') {
    // JSON 分支同样带 truncated/total 字段，且响应体很小，直接解析即可。
    const payload = JSON.parse(await res.data.text()) as {
      data?: { truncated?: boolean; total?: number; rows?: unknown[] }
    }
    return {
      blob: res.data,
      truncated: payload.data?.truncated === true,
      total: payload.data?.total ?? 0,
      exported: payload.data?.rows?.length ?? 0,
    }
  }
  const trailer = (await res.data.text()).match(TRUNCATED_TRAILER)
  return {
    blob: res.data,
    truncated: trailer !== null,
    total: trailer ? Number(trailer[1]) : 0,
    exported: trailer ? Number(trailer[2]) : 0,
  }
}
