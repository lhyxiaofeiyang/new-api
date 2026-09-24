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
import { dataScheme as vchartDataScheme } from '@visactor/vchart/esm/theme/color-scheme/builtin/default'
import type { TFunction } from 'i18next'

import dayjs from '@/lib/dayjs'
import { quotaUnitsToDollars } from '@/lib/format'

import type { UsageMetric } from '../constants'
import type {
  HourlyActivityPoint,
  TrafficPoint,
  UsageTrendPoint,
} from '../types'

const USAGE_METRIC_LABELS: Record<UsageMetric, string> = {
  calls: 'Calls',
  total_tokens: 'Tokens',
  quota: 'Cost',
}

export interface VChartSpec {
  type: string
  data: Array<{ id: string; values: Array<Record<string, unknown>> }>
  [key: string]: unknown
}

/**
 * Concrete palette for charts whose colours must be assigned per-series rather
 * than left to VChart's ordinal default. VChart draws to a <canvas>, so CSS
 * `var(--chart-*)` references never resolve there; instead this reads the same
 * built-in `dataScheme` the dashboard's `getDashboardChartColors` uses, picking
 * the first scheme whose domain capacity covers the series count. The light and
 * dark themes share one `dataScheme`, so a single call serves both.
 */
export function getObservabilityChartColors(count: number): string[] {
  const scheme =
    vchartDataScheme.find(
      (item) => !item.maxDomainLength || count <= item.maxDomainLength
    ) ?? vchartDataScheme.at(-1)
  if (!scheme) return []
  return scheme.scheme.filter(
    (color): color is string => typeof color === 'string'
  )
}

/** Stacked series need the metric folded into the row as a series field. */
function toSeriesValues(
  points: Array<{ Time: string; [key: string]: number | string }>,
  metrics: Array<{ key: string; label: string }>
) {
  return points.flatMap((point) =>
    metrics.map((metric) => ({
      Time: point.Time,
      Metric: metric.label,
      Value: Number(point[metric.key]) || 0,
    }))
  )
}

export function buildTrafficTrendSpec(
  traffic: TrafficPoint[],
  t: TFunction,
  options?: { showTokens?: boolean }
): VChartSpec {
  const showTokens = options?.showTokens ?? true
  const points = traffic.map((point) => ({
    Time: dayjs(point.ts * 1000).format('MM-DD HH:mm'),
    Calls: point.calls,
    Tokens: point.prompt_tokens + point.completion_tokens,
  }))
  const metrics = showTokens
    ? [
        { key: 'Calls', label: t('Calls') },
        { key: 'Tokens', label: t('Tokens') },
      ]
    : [{ key: 'Calls', label: t('Calls') }]
  const values = toSeriesValues(points, metrics)

  return {
    type: 'line',
    data: [{ id: 'traffic-trend', values }],
    xField: 'Time',
    yField: 'Value',
    seriesField: 'Metric',
    axes: [
      { orient: 'bottom', type: 'band' },
      { orient: 'left', type: 'linear' },
    ],
    legends: { visible: showTokens, orient: 'top' },
    title: {
      visible: true,
      text: t('Traffic Trend'),
      subtext: values.length === 0 ? t('No data available') : undefined,
    },
  }
}

export function buildHourlyActivitySpec(
  activity: HourlyActivityPoint[],
  t: TFunction
): VChartSpec {
  const values = activity.map((point) => ({
    Hour: `${String(point.hour).padStart(2, '0')}:00`,
    Calls: point.calls,
  }))

  return {
    type: 'bar',
    data: [{ id: 'hourly-activity', values }],
    xField: 'Hour',
    yField: 'Calls',
    axes: [
      { orient: 'bottom', type: 'band' },
      { orient: 'left', type: 'linear' },
    ],
    legends: { visible: false },
    title: {
      visible: true,
      text: t('Hourly distribution (hour of day)'),
      subtext: values.length === 0 ? t('No data available') : undefined,
    },
  }
}

export function buildUsageTrendSpec(
  trend: UsageTrendPoint[],
  metric: UsageMetric,
  granularity: 'hour' | 'day',
  t: TFunction
): VChartSpec {
  const timeFormat = granularity === 'hour' ? 'MM-DD HH:00' : 'MM-DD'
  const values = trend.map((point) => ({
    Time: dayjs(point.ts * 1000).format(timeFormat),
    Value: Number(point[metric]) || 0,
  }))
  const metricLabel = USAGE_METRIC_LABELS[metric]
    ? t(USAGE_METRIC_LABELS[metric])
    : t('Tokens')

  return {
    type: 'line',
    data: [{ id: 'usage-trend', values }],
    xField: 'Time',
    yField: 'Value',
    axes: [
      { orient: 'bottom', type: 'band' },
      { orient: 'left', type: 'linear' },
    ],
    legends: { visible: false },
    title: {
      visible: true,
      text: `${t('Trend')} · ${metricLabel}`,
      subtext: values.length === 0 ? t('No data available') : undefined,
    },
  }
}

/** Cost composition stacked by the dominant dimension values. */
export function buildCostCompositionSpec(
  rows: Array<{ label: string; quota: number }>,
  t: TFunction,
  topLimit = 8
): VChartSpec {
  const ranked = [...rows].sort((a, b) => b.quota - a.quota)
  const top = ranked.slice(0, topLimit)
  const rest = ranked.slice(topLimit)
  const buckets = [...top]
  if (rest.length > 0) {
    buckets.push({
      label: t('Other'),
      quota: rest.reduce((sum, row) => sum + row.quota, 0),
    })
  }
  const values = buckets.map((bucket) => ({
    Dimension: bucket.label,
    Cost: quotaUnitsToDollars(bucket.quota),
  }))

  return {
    type: 'bar',
    data: [{ id: 'cost-composition', values }],
    xField: 'Dimension',
    yField: 'Cost',
    stack: true,
    axes: [
      { orient: 'bottom', type: 'band' },
      { orient: 'left', type: 'linear' },
    ],
    legends: { visible: false },
    // One distinct colour per dimension bucket, assigned explicitly: without a
    // series field VChart paints every bar from the first palette slot, which
    // is what made the panel look monochrome.
    color: {
      type: 'ordinal',
      range: getObservabilityChartColors(Math.max(values.length, 1)),
    },
    title: {
      visible: true,
      text: t('Cost Composition'),
      subtext: values.length === 0 ? t('No data available') : undefined,
    },
  }
}
