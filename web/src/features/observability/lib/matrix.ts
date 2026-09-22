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
import { quotaUnitsToDollars } from '@/lib/format'

import type { UsageMatrixData, UsageMatrixCell } from '../types'

/**
 * Heat intensity is mapped onto a Tailwind semantic token's opacity. The token
 * itself (not a hex color) carries the hue, so the matrix follows the theme.
 * The opacity ladder is a fixed set of Tailwind classes rather than an inline
 * style so the values stay inside the utility system.
 */
const HEAT_STEPS = [
  'bg-chart-1/10',
  'bg-chart-1/25',
  'bg-chart-1/40',
  'bg-chart-1/60',
  'bg-chart-1/80',
] as const

export const HEAT_EMPTY_CLASS = 'bg-muted/40'

type MatrixIndex = {
  max: number
  byPosition: Map<string, UsageMatrixCell>
}

export type MatrixMetric = 'calls' | 'total_tokens' | 'quota'

function cellMetric(cell: UsageMatrixCell, metric: MatrixMetric): number {
  return Number(cell[metric]) || 0
}

export function indexMatrix(
  matrix: UsageMatrixData | undefined,
  metric: MatrixMetric
): MatrixIndex {
  const byPosition = new Map<string, UsageMatrixCell>()
  let max = 0
  for (const cell of matrix?.cells ?? []) {
    byPosition.set(`${cell.x}:${cell.y}`, cell)
    max = Math.max(max, cellMetric(cell, metric))
  }
  return { max, byPosition }
}

/**
 * Bucket a value into the opacity ladder. Zero (or a missing cell) returns the
 * empty class so absent combinations read as "no data" instead of "coldest".
 */
export function getHeatClass(value: number, max: number): string {
  if (!Number.isFinite(value) || value <= 0 || max <= 0) return HEAT_EMPTY_CLASS
  const ratio = value / max
  const index = Math.min(
    HEAT_STEPS.length - 1,
    Math.max(0, Math.ceil(ratio * HEAT_STEPS.length) - 1)
  )
  return HEAT_STEPS[index]
}

export function getCellAt(
  index: MatrixIndex,
  x: number,
  y: number
): UsageMatrixCell | undefined {
  return index.byPosition.get(`${x}:${y}`)
}

/** Label shown inside a cell; crowded matrices keep the tooltip authoritative. */
export function formatMatrixCellValue(
  value: number,
  metric: MatrixMetric
): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  if (metric === 'calls') {
    return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : `${value}`
  }
  if (metric === 'total_tokens') {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
    return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : `${value}`
  }
  return `$${quotaUnitsToDollars(value).toFixed(2)}`
}
