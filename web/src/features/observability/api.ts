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

/**
 * Export reuses the shared api client so the request carries the same bearer
 * token (the endpoint is under `AdminAuth`) and the failure handling is
 * identical to the other observability GETs. The response body is opaque to
 * us — the server owns the CSV/JSON shape and strips API keys.
 */
export async function downloadObservabilityRequests(
  params: ObservabilityRequestsParams,
  format: 'csv' | 'json'
): Promise<Blob> {
  const res = await api.get<Blob>(
    `${OBSERVABILITY_BASE_PATH}/requests/export`,
    {
      params: toParams({ ...params, format }),
      responseType: 'blob',
    }
  )
  return res.data
}
