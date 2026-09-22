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
import type { TFunction } from 'i18next'

import { CHANNEL_TYPES } from '@/features/channels/constants'
import dayjs from '@/lib/dayjs'

import type {
  ObservabilityRangeParams,
  ObservabilityRequestsParams,
  ObservabilityUsageParams,
} from '../api'
import { USAGE_DIMENSION_LIMIT } from '../constants'
import type {
  ObservabilityRange,
  ObservabilitySearch,
  RequestSort,
  SortOrder,
  UsageDimension,
  UsageGranularity,
  UsageMatrix,
} from '../types'

export const DEFAULT_REQUEST_SORT: RequestSort = 'created_at'
export const DEFAULT_SORT_ORDER: SortOrder = 'desc'
export const DEFAULT_DIMENSION: UsageDimension = 'token'
export const DEFAULT_GRANULARITY: UsageGranularity = 'day'

/** Resolve a preset range to the concrete unix seconds the API expects. */
export function resolveTimeRange(
  search: ObservabilitySearch,
  fallbackRange: ObservabilityRange
): { range: ObservabilityRange; start?: number; end?: number } {
  const range = search.range ?? fallbackRange
  if (range !== 'custom') return { range }
  // An incomplete custom range cannot be sent; fall back to the default.
  if (!search.start || !search.end) return { range: fallbackRange }
  return { range, start: search.start, end: search.end }
}

export function toSummaryParams(
  search: ObservabilitySearch,
  fallbackRange: ObservabilityRange
): ObservabilityRangeParams {
  return resolveTimeRange(search, fallbackRange)
}

export function toRequestsParams(
  search: ObservabilitySearch
): ObservabilityRequestsParams {
  const base = resolveTimeRange(search, '24h')
  return {
    ...base,
    page: search.page ?? 1,
    page_size: search.pageSize,
    token_id: search.tokenId,
    channel_id: search.channelId,
    channel_type: search.channelType,
    model_name: search.model || undefined,
    group: search.group || undefined,
    is_stream: search.isStream,
    only_failed: search.onlyFailed,
    keyword: search.keyword || undefined,
    sort: search.sort ?? DEFAULT_REQUEST_SORT,
    order: search.order ?? DEFAULT_SORT_ORDER,
  }
}

export function toUsageParams(
  search: ObservabilitySearch
): ObservabilityUsageParams {
  const base = resolveTimeRange(search, '7d')
  return {
    ...base,
    dimension: search.dimension ?? DEFAULT_DIMENSION,
    granularity: search.granularity ?? DEFAULT_GRANULARITY,
    matrix: search.matrix,
    limit: USAGE_DIMENSION_LIMIT,
  }
}

/** Human label for a channel type id; falls back to the unknown bucket. */
export function getChannelTypeLabel(type: number, t: TFunction): string {
  const labelKey = (CHANNEL_TYPES as Record<number, string | undefined>)[type]
  return labelKey ? t(labelKey) : t('Unknown')
}

/**
 * Option constants carry union-typed `value`s; `Combobox` needs a plain
 * `string` so the overload resolves ahead of its Base UI signature.
 */
export function toSelectOptions(
  options: ReadonlyArray<{ value: string; labelKey: string }>,
  t: TFunction
): Array<{ value: string; label: string }> {
  return options.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
  }))
}

export function formatBucketLabel(
  timestamp: number,
  granularity: UsageGranularity
): string {
  return dayjs(timestamp * 1000).format(
    granularity === 'hour' ? 'MM-DD HH:00' : 'MM-DD'
  )
}

export function isUsageMatrix(value: unknown): value is UsageMatrix {
  return (
    value === 'token_model' ||
    value === 'channel_model' ||
    value === 'channel_type_model'
  )
}

/** A drill-down from the usage table into the monitoring detail table. */
export function buildDrillDownSearch(
  dimension: UsageDimension,
  key: string
): Partial<ObservabilitySearch> {
  switch (dimension) {
    case 'token': {
      const tokenId = Number(key)
      return Number.isFinite(tokenId) ? { tokenId } : {}
    }
    case 'channel': {
      const channelId = Number(key)
      return Number.isFinite(channelId) ? { channelId } : {}
    }
    case 'channel_type': {
      const channelType = Number(key)
      return Number.isFinite(channelType) ? { channelType } : {}
    }
    case 'model':
      return { model: key }
    case 'group':
      return { group: key }
    default:
      return {}
  }
}
