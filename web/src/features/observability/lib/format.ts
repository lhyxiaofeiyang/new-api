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
import { formatCompactNumber, formatNumber } from '@/lib/format'

/**
 * Token counts use thousands separators plus K/M shorthand, per the UI spec.
 * `formatTokens` upstream renders `-` for zero which reads as "missing" in a
 * metric tile, so totals fall back to compact notation instead.
 */
export function formatTokenCount(value: number | null | undefined): string {
  const tokens = Number(value ?? 0)
  if (!Number.isFinite(tokens)) return '-'
  if (tokens < 1000) return formatNumber(tokens)
  return formatCompactNumber(tokens)
}

/** Latency is always rendered in milliseconds, rounded, per the UI spec. */
export function formatLatencyMs(value: number | null | undefined): string {
  const ms = Number(value ?? 0)
  if (!Number.isFinite(ms)) return '-'
  if (ms <= 0) return '-'
  if (ms >= 1000) return `${formatNumber(ms / 1000, 'en')}s`
  return `${formatNumber(Math.round(ms))}ms`
}

/** Share arrives as a 0-1 ratio and is displayed as a percentage. */
export function formatShare(value: number | null | undefined): string {
  const ratio = Number(value ?? 0)
  if (!Number.isFinite(ratio)) return '-'
  return `${(ratio * 100).toFixed(2)}%`
}

export function formatSuccessRate(value: number | null | undefined): string {
  const rate = Number(value ?? 0)
  if (!Number.isFinite(rate)) return '-'
  return `${rate.toFixed(2)}%`
}
