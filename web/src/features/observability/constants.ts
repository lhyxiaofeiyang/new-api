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
import type {
  ObservabilityRange,
  RequestSort,
  SortOrder,
  UsageDimension,
  UsageGranularity,
  UsageMatrix,
} from './types'

export const OBSERVABILITY_BASE_PATH = '/api/observability'

export const OBSERVABILITY_SECTIONS = [
  { id: 'overview', titleKey: 'Dashboard' },
  { id: 'monitoring', titleKey: 'Request Monitoring' },
  { id: 'usage', titleKey: 'Usage Analytics' },
] as const

export type ObservabilitySectionId =
  (typeof OBSERVABILITY_SECTIONS)[number]['id']

export const OBSERVABILITY_DEFAULT_SECTION: ObservabilitySectionId = 'overview'

export const OBSERVABILITY_SECTION_IDS = OBSERVABILITY_SECTIONS.map(
  (section) => section.id
)

export const isObservabilitySectionId = (
  value: string
): value is ObservabilitySectionId =>
  OBSERVABILITY_SECTION_IDS.some((id) => id === value)

/** Default time range per page, matching the API contract defaults. */
export const DEFAULT_SUMMARY_RANGE: ObservabilityRange = '24h'
export const DEFAULT_REQUESTS_RANGE: ObservabilityRange = '24h'
export const DEFAULT_USAGE_RANGE: ObservabilityRange = '7d'

export const RANGE_OPTIONS: Array<{
  value: ObservabilityRange
  labelKey: string
}> = [
  { value: 'today', labelKey: 'Today' },
  { value: '24h', labelKey: 'Last 24 Hours' },
  { value: '7d', labelKey: 'Last 7 Days' },
  { value: '30d', labelKey: 'Last 30 Days' },
  { value: 'custom', labelKey: 'Custom' },
]

export const DIMENSION_OPTIONS: Array<{
  value: UsageDimension
  labelKey: string
}> = [
  { value: 'token', labelKey: 'API Key' },
  { value: 'channel', labelKey: 'Channel' },
  { value: 'channel_type', labelKey: 'Channel Type' },
  { value: 'model', labelKey: 'Model' },
  { value: 'group', labelKey: 'Group' },
]

export const GRANULARITY_OPTIONS: Array<{
  value: UsageGranularity
  labelKey: string
}> = [
  { value: 'hour', labelKey: 'Hourly' },
  { value: 'day', labelKey: 'Daily' },
]

export const MATRIX_OPTIONS: Array<{
  value: UsageMatrix
  labelKey: string
  xKey: string
  yKey: string
}> = [
  {
    value: 'token_model',
    labelKey: 'API Key × Model',
    xKey: 'API Key',
    yKey: 'Model',
  },
  {
    value: 'channel_model',
    labelKey: 'Channel × Model',
    xKey: 'Channel',
    yKey: 'Model',
  },
  {
    value: 'channel_type_model',
    labelKey: 'Channel Type × Model',
    xKey: 'Channel Type',
    yKey: 'Model',
  },
]

export const USAGE_METRIC_OPTIONS = [
  { value: 'calls', labelKey: 'Calls' },
  { value: 'total_tokens', labelKey: 'Tokens' },
  { value: 'quota', labelKey: 'Cost' },
] as const

export type UsageMetric = (typeof USAGE_METRIC_OPTIONS)[number]['value']

export const REQUEST_SORT_OPTIONS: Array<{
  value: RequestSort
  labelKey: string
}> = [
  { value: 'created_at', labelKey: 'Time' },
  { value: 'quota', labelKey: 'Quota' },
  { value: 'use_time', labelKey: 'Duration' },
  { value: 'total_tokens', labelKey: 'Tokens' },
]

export const SORT_ORDER_OPTIONS: Array<{
  value: SortOrder
  labelKey: string
}> = [
  { value: 'desc', labelKey: 'Descending' },
  { value: 'asc', labelKey: 'Ascending' },
]

export const TOP_LIST_LIMIT = 5
export const REQUESTS_DEFAULT_PAGE_SIZE = 20
export const REQUESTS_PAGE_SIZE_OPTIONS = [20, 50, 100, 500] as const
export const USAGE_DIMENSION_LIMIT = 50
export const AUTO_REFRESH_INTERVAL_MS = 30_000

/** 10-minute buckets, 144 of them, per the health timeline contract. */
export const HEALTH_BUCKET_SECONDS = 600
export const HEALTH_BUCKET_COUNT = 144
