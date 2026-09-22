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
/**
 * Mirrors the observability API contract (`observability/plan/02-api-contract.md`).
 * Timestamps are unix seconds in the server's local timezone.
 */

export type ObservabilityRange = 'today' | '24h' | '7d' | '30d' | 'custom'

export type FailureSource = 'none' | 'error_log' | 'perf_metrics'

export type UsageDimension =
  | 'token'
  | 'channel'
  | 'channel_type'
  | 'model'
  | 'group'

export type UsageMatrix = 'token_model' | 'channel_model' | 'channel_type_model'

export type UsageGranularity = 'hour' | 'day'

export type RequestSort = 'created_at' | 'quota' | 'use_time' | 'total_tokens'

export type SortOrder = 'asc' | 'desc'

export interface ObservabilityRangeInfo {
  start: number
  end: number
  range: string
}

export interface ObservabilityDataSource {
  error_log_enabled: boolean
  failure_source: FailureSource
  log_rows: number
}

export interface ObservabilitySummary {
  total_calls: number
  success_calls: number
  failure_calls: number
  success_rate: number
  prompt_tokens: number
  completion_tokens: number
  cached_tokens: number
  total_tokens: number
  total_quota: number
  total_cost_usd: number
  average_latency_ms: number
  average_ttft_ms: number
  stream_calls: number
  unique_tokens: number
  unique_channels: number
  unique_models: number
}

export interface ObservabilityRolling {
  rpm: number
  tpm: number
}

export interface TopModelRow {
  model_name: string
  calls: number
  total_tokens: number
  quota: number
}

export interface TopTokenRow {
  token_id: number
  token_name: string
  calls: number
  total_tokens: number
  quota: number
}

export interface TopChannelRow {
  channel_id: number
  channel_name: string
  calls: number
  total_tokens: number
  quota: number
}

export interface TrafficPoint {
  ts: number
  calls: number
  prompt_tokens: number
  completion_tokens: number
  quota: number
}

export interface HourlyActivityPoint {
  hour: number
  calls: number
}

export interface HealthTimelinePoint {
  ts: number
  calls: number
  failures: number
}

export interface ObservabilitySummaryResponse {
  range: ObservabilityRangeInfo
  data_source: ObservabilityDataSource
  summary: ObservabilitySummary
  rolling: ObservabilityRolling
  top_models: TopModelRow[]
  top_tokens: TopTokenRow[]
  top_channels: TopChannelRow[]
  traffic: TrafficPoint[]
  hourly_activity: HourlyActivityPoint[]
  health_timeline: HealthTimelinePoint[]
}

export interface RequestRetryAttempt {
  index: number
  channel_id: number
  elapsed_ms: number
  action: string
}

export interface ObservabilityRequestItem {
  id: number
  created_at: number
  request_id: string
  token_id: number
  token_name: string
  channel_id: number
  channel_name: string
  channel_type: number
  model_name: string
  group: string
  user_id: number
  quota: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cached_tokens: number
  cache_ratio: number
  use_time_ms: number
  ttft_ms: number
  is_stream: boolean
  retry_chain: RequestRetryAttempt[]
  is_failed: boolean
  fail_status_code: number | null
  fail_summary: string | null
}

export interface RequestAggregate {
  calls: number
  total_tokens: number
  quota: number
  average_latency_ms: number
}

export interface ObservabilityRequestsResponse {
  items: ObservabilityRequestItem[]
  total: number
  page: number
  page_size: number
  aggregate: RequestAggregate
}

export interface UsageRow {
  key: string
  label: string
  calls: number
  success_calls: number
  failure_calls: number
  prompt_tokens: number
  completion_tokens: number
  cached_tokens: number
  total_tokens: number
  quota: number
  cost_usd: number
  average_latency_ms: number
  average_ttft_ms: number
  share: number
}

export interface UsageTrendPoint {
  ts: number
  calls: number
  total_tokens: number
  quota: number
  failure_calls: number
}

export interface UsageMatrixCell {
  x: number
  y: number
  calls: number
  total_tokens: number
  quota: number
}

/** Heat-matrix payload; `UsageMatrix` (below) is the selector union. */
export interface UsageMatrixData {
  x_labels: string[]
  y_labels: string[]
  cells: UsageMatrixCell[]
}

export interface UsageTotals {
  calls: number
  total_tokens: number
  quota: number
  cost_usd: number
}

export interface ObservabilityUsageResponse {
  rows: UsageRow[]
  trend: UsageTrendPoint[]
  matrix?: UsageMatrixData
  totals: UsageTotals
}

/** URL search state shared by the three pages. */
export interface ObservabilitySearch {
  range?: ObservabilityRange
  start?: number
  end?: number
  autoRefresh?: boolean
  page?: number
  pageSize?: number
  tokenId?: number
  channelId?: number
  channelType?: number
  model?: string
  group?: string
  isStream?: boolean
  onlyFailed?: boolean
  keyword?: string
  sort?: RequestSort
  order?: SortOrder
  dimension?: UsageDimension
  granularity?: UsageGranularity
  matrix?: UsageMatrix
}
