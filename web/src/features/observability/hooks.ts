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
import { useQuery } from '@tanstack/react-query'

import { requireServerSuccess } from '@/lib/server-error-message'

import {
  getObservabilityRequests,
  getObservabilitySummary,
  getObservabilityUsage,
  type ObservabilityRangeParams,
  type ObservabilityRequestsParams,
  type ObservabilityUsageParams,
} from './api'
import type {
  ObservabilityRequestsResponse,
  ObservabilitySummaryResponse,
  ObservabilityUsageResponse,
} from './types'

/** All observability query keys live under one root for targeted invalidation. */
export const OBSERVABILITY_QUERY_ROOT = 'observability'

function staleTimeFor(autoRefresh: boolean): number {
  return autoRefresh ? 0 : 30_000
}

export function useObservabilitySummary(
  params: ObservabilityRangeParams,
  options?: {
    autoRefresh?: boolean
    enabled?: boolean
  }
) {
  const autoRefresh = options?.autoRefresh ?? false
  return useQuery<ObservabilitySummaryResponse>({
    queryKey: [OBSERVABILITY_QUERY_ROOT, 'summary', params],
    queryFn: async () =>
      requireServerSuccess(await getObservabilitySummary(params)).data ??
      EMPTY_SUMMARY_RESPONSE,
    placeholderData: (previousData) => previousData,
    staleTime: staleTimeFor(autoRefresh),
    refetchInterval: autoRefresh ? 30_000 : false,
    enabled: options?.enabled ?? true,
  })
}

export function useObservabilityRequests(
  params: ObservabilityRequestsParams,
  options?: {
    enabled?: boolean
  }
) {
  return useQuery<ObservabilityRequestsResponse>({
    queryKey: [OBSERVABILITY_QUERY_ROOT, 'requests', params],
    queryFn: async () =>
      requireServerSuccess(await getObservabilityRequests(params)).data ??
      EMPTY_REQUESTS_RESPONSE,
    placeholderData: (previousData) => previousData,
    enabled: options?.enabled ?? true,
  })
}

export function useObservabilityUsage(
  params: ObservabilityUsageParams,
  options?: {
    enabled?: boolean
  }
) {
  return useQuery<ObservabilityUsageResponse>({
    queryKey: [OBSERVABILITY_QUERY_ROOT, 'usage', params],
    queryFn: async () =>
      requireServerSuccess(await getObservabilityUsage(params)).data ??
      EMPTY_USAGE_RESPONSE,
    placeholderData: (previousData) => previousData,
    enabled: options?.enabled ?? true,
  })
}

/**
 * `error_log_enabled` lives on the summary endpoint, not on `/requests`. Reading
 * it through the same query key means the monitoring page shares the cached
 * summary response instead of issuing a second request.
 */
export function useObservabilityDataSource(params: ObservabilityRangeParams) {
  const query = useObservabilitySummary(params)
  return {
    dataSource: query.data?.data_source,
    isLoading: query.isLoading,
  }
}

export const EMPTY_SUMMARY_RESPONSE: ObservabilitySummaryResponse = {
  range: { start: 0, end: 0, range: '' },
  data_source: {
    error_log_enabled: false,
    failure_source: 'none',
    log_rows: 0,
  },
  summary: {
    total_calls: 0,
    success_calls: 0,
    failure_calls: 0,
    success_rate: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    cached_tokens: 0,
    total_tokens: 0,
    total_quota: 0,
    total_cost_usd: 0,
    average_latency_ms: 0,
    average_ttft_ms: 0,
    stream_calls: 0,
    unique_tokens: 0,
    unique_channels: 0,
    unique_models: 0,
  },
  rolling: { rpm: 0, tpm: 0 },
  top_models: [],
  top_tokens: [],
  top_channels: [],
  traffic: [],
  hourly_activity: [],
  health_timeline: [],
}

export const EMPTY_REQUESTS_RESPONSE: ObservabilityRequestsResponse = {
  items: [],
  total: 0,
  page: 1,
  page_size: 20,
  aggregate: { calls: 0, total_tokens: 0, quota: 0, average_latency_ms: 0 },
}

export const EMPTY_USAGE_RESPONSE: ObservabilityUsageResponse = {
  rows: [],
  trend: [],
  totals: { calls: 0, total_tokens: 0, quota: 0, cost_usd: 0 },
  data_source: {
    error_log_enabled: false,
    failure_source: 'none',
    log_rows: 0,
  },
}
