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
import z from 'zod'

import type { ObservabilitySearch } from '../types'

const RANGE_VALUES = ['today', '24h', '7d', '30d', 'custom'] as const
const DIMENSION_VALUES = [
  'token',
  'channel',
  'channel_type',
  'model',
  'group',
] as const
const GRANULARITY_VALUES = ['hour', 'day'] as const
const MATRIX_VALUES = [
  'token_model',
  'channel_model',
  'channel_type_model',
] as const
const SORT_VALUES = ['created_at', 'quota', 'use_time', 'total_tokens'] as const
const ORDER_VALUES = ['asc', 'desc'] as const

/**
 * Every page filter lives in the URL query string, so the schema is the single
 * source of truth for the shape the pages read. `catch` keeps a hand-edited or
 * stale URL from throwing: an unparsable value falls back to the default and
 * the page renders as if the filter were absent.
 */
export const observabilitySearchSchema = z.object({
  range: z.enum(RANGE_VALUES).optional().catch(undefined),
  start: z.number().optional().catch(undefined),
  end: z.number().optional().catch(undefined),
  autoRefresh: z.boolean().optional().catch(undefined),

  page: z.number().int().min(1).optional().catch(1),
  pageSize: z.number().int().min(1).optional().catch(undefined),
  tokenId: z.number().int().optional().catch(undefined),
  channelId: z.number().int().optional().catch(undefined),
  channelType: z.number().int().optional().catch(undefined),
  model: z.string().optional().catch(undefined),
  group: z.string().optional().catch(undefined),
  isStream: z.boolean().optional().catch(undefined),
  onlyFailed: z.boolean().optional().catch(undefined),
  keyword: z.string().optional().catch(undefined),
  sort: z.enum(SORT_VALUES).optional().catch(undefined),
  order: z.enum(ORDER_VALUES).optional().catch(undefined),

  dimension: z.enum(DIMENSION_VALUES).optional().catch(undefined),
  granularity: z.enum(GRANULARITY_VALUES).optional().catch(undefined),
  matrix: z.enum(MATRIX_VALUES).optional().catch(undefined),
})

export type ObservabilityRouteSearch = z.infer<typeof observabilitySearchSchema>

export function toObservabilitySearch(
  search: ObservabilityRouteSearch
): ObservabilitySearch {
  return search
}
