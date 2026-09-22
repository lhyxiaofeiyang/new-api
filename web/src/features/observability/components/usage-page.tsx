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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Combobox } from '@/components/ui/combobox'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  DEFAULT_USAGE_RANGE,
  DIMENSION_OPTIONS,
  GRANULARITY_OPTIONS,
  MATRIX_OPTIONS,
  USAGE_METRIC_OPTIONS,
  type UsageMetric,
} from '../constants'
import { useObservabilityUsage } from '../hooks'
import { buildCostCompositionSpec, buildUsageTrendSpec } from '../lib/charts'
import { formatLatencyMs, formatShare, formatTokenCount } from '../lib/format'
import {
  formatMatrixCellValue,
  getCellAt,
  getHeatClass,
  indexMatrix,
} from '../lib/matrix'
import {
  isUsageMatrix,
  resolveTimeRange,
  toSelectOptions,
  toUsageParams,
} from '../lib/query'
import type {
  ObservabilitySearch,
  UsageDimension,
  UsageGranularity,
  UsageMatrix,
  UsageMatrixData,
  UsageRow,
} from '../types'
import { ChartPanel } from './chart-panel'
import { RangeSelector } from './range-selector'

interface UsagePageProps {
  search: ObservabilitySearch
  onSearchChange: (patch: Partial<ObservabilitySearch>) => void
  onDrillDown: (dimension: UsageDimension, key: string) => void
}

const MATRIX_CELL_METRIC = 'calls' as const

export function UsagePage(props: UsagePageProps) {
  const { t } = useTranslation()
  const [metric, setMetric] = useState<UsageMetric>('calls')

  const range = resolveTimeRange(props.search, DEFAULT_USAGE_RANGE)
  const dimension = props.search.dimension ?? 'token'
  const granularity = props.search.granularity ?? 'day'
  const matrix = isUsageMatrix(props.search.matrix)
    ? props.search.matrix
    : undefined

  const params = toUsageParams(props.search)
  const { data, isLoading } = useObservabilityUsage(params)

  const granularityOptions = useMemo(
    () => toSelectOptions(GRANULARITY_OPTIONS, t),
    [t]
  )

  const rows = data?.rows ?? []
  const trend = data?.trend ?? []

  return (
    <SectionPageLayout stackActionsOnMobile>
      <SectionPageLayout.Title>{t('Usage Analytics')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <RangeSelector
          range={range.range}
          start={range.start}
          end={range.end}
          onRangeChange={(nextRange, bounds) =>
            props.onSearchChange({
              range: nextRange,
              start: bounds?.start,
              end: bounds?.end,
            })
          }
        />
      </SectionPageLayout.Actions>

      <SectionPageLayout.Content>
        <div className='space-y-3 sm:space-y-4'>
          <div className='bg-card flex flex-wrap items-center gap-3 rounded-2xl border p-3 shadow-xs sm:gap-4 sm:p-4'>
            <ToggleGroup
              value={[dimension]}
              onValueChange={(values) => {
                const next = values[0] as UsageDimension | undefined
                if (!next) return
                props.onSearchChange({ dimension: next })
              }}
              variant='outline'
              size='sm'
            >
              {DIMENSION_OPTIONS.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <div className='flex items-center gap-2'>
              <span className='text-muted-foreground text-xs'>
                {t('Granularity')}
              </span>
              <Combobox
                options={granularityOptions}
                value={granularity}
                onValueChange={(value: string | null) =>
                  props.onSearchChange({
                    granularity: (value as UsageGranularity) ?? undefined,
                  })
                }
                className='w-32'
                aria-label={t('Granularity')}
              />
            </div>

            <div className='ms-auto flex flex-wrap items-center gap-3'>
              <span className='text-muted-foreground text-xs'>
                {t('Total')}:
              </span>
              <Badge variant='secondary' className='tabular-nums'>
                {t('Calls')} {formatTokenCount(data?.totals.calls ?? 0)}
              </Badge>
              <Badge variant='secondary' className='tabular-nums'>
                {t('Tokens')} {formatTokenCount(data?.totals.total_tokens ?? 0)}
              </Badge>
              <Badge variant='secondary' className='tabular-nums'>
                {t('Cost')} {formatQuota(data?.totals.quota ?? 0)}
              </Badge>
            </div>
          </div>

          <DimensionTable
            rows={rows}
            dimension={dimension}
            loading={isLoading}
            emptyMessage={t('No data available')}
            onRowClick={(row) => props.onDrillDown(dimension, row.key)}
          />

          <ChartPanel
            title={t('Trend')}
            spec={buildUsageTrendSpec(trend, metric, granularity, t)}
            headerActions={
              <ToggleGroup
                value={[metric]}
                onValueChange={(values) => {
                  const next = values[0] as UsageMetric | undefined
                  if (next) setMetric(next)
                }}
                variant='outline'
                size='sm'
              >
                {USAGE_METRIC_OPTIONS.map((option) => (
                  <ToggleGroupItem key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            }
            loading={isLoading}
            empty={!isLoading && trend.length === 0}
            emptyMessage={t('No data available')}
            height='h-72'
          />

          <div className='grid gap-3 sm:gap-4 lg:grid-cols-2'>
            <ChartPanel
              title={t('Cost Composition')}
              spec={buildCostCompositionSpec(rows, t)}
              loading={isLoading}
              empty={!isLoading && rows.length === 0}
              emptyMessage={t('No data available')}
              height='h-64'
            />
            <MatrixPanel
              matrix={data?.matrix}
              selected={matrix}
              loading={isLoading}
              onSelect={(next) => props.onSearchChange({ matrix: next })}
            />
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

interface DimensionTableProps {
  rows: UsageRow[]
  dimension: UsageDimension
  loading: boolean
  emptyMessage: string
  onRowClick: (row: UsageRow) => void
}

function DimensionTable(props: DimensionTableProps) {
  const { t } = useTranslation()
  const dimensionLabel =
    DIMENSION_OPTIONS.find((option) => option.value === props.dimension)
      ?.labelKey ?? 'Name'

  return (
    <div className='bg-card overflow-hidden rounded-2xl border shadow-xs'>
      <div className='flex items-center justify-between gap-2 border-b px-4 py-3 sm:px-5'>
        <div className='text-sm font-semibold'>{t(dimensionLabel)}</div>
        <span className='text-muted-foreground text-xs'>
          {t('Select a row to inspect its requests')}
        </span>
      </div>

      <DimensionTableBody {...props} />
    </div>
  )
}

function DimensionTableBody(props: DimensionTableProps) {
  const { t } = useTranslation()
  const dimensionLabel =
    DIMENSION_OPTIONS.find((option) => option.value === props.dimension)
      ?.labelKey ?? 'Name'

  if (props.loading) {
    return (
      <div className='space-y-2 p-4'>
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={`row-${index}`} className='h-9 w-full' />
        ))}
      </div>
    )
  }

  if (props.rows.length === 0) {
    return (
      <div className='text-muted-foreground flex h-52 items-center justify-center text-sm'>
        {props.emptyMessage}
      </div>
    )
  }

  return (
    <div className='overflow-x-auto'>
      <table className='w-full caption-bottom text-sm'>
        <thead className='[background-color:var(--table-header)]'>
          <tr className='border-b'>
            <Th>{t(dimensionLabel)}</Th>
            <Th align='right'>{t('Calls')}</Th>
            <Th align='right'>{t('Success')}</Th>
            <Th align='right'>{t('Failed')}</Th>
            <Th align='right'>{t('Tokens')}</Th>
            <Th align='right'>{t('Cost')}</Th>
            <Th align='right'>{t('Average Latency')}</Th>
            <Th align='right'>{t('Share')}</Th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr
              key={row.key}
              className='hover:bg-muted/40 cursor-pointer border-b transition-colors'
              onClick={() => props.onRowClick(row)}
            >
              <td className='max-w-64 px-3 py-2'>
                <span className='block truncate font-medium' title={row.label}>
                  {row.label || row.key}
                </span>
              </td>
              <Td>{formatTokenCount(row.calls)}</Td>
              <Td>{formatTokenCount(row.success_calls)}</Td>
              <Td>
                {row.failure_calls > 0 ? (
                  <span className='text-destructive'>
                    {formatTokenCount(row.failure_calls)}
                  </span>
                ) : (
                  <span className='text-muted-foreground'>-</span>
                )}
              </Td>
              <Td
                title={`${formatTokenCount(row.prompt_tokens)} / ${formatTokenCount(row.completion_tokens)} / ${formatTokenCount(row.cached_tokens)}`}
              >
                {formatTokenCount(row.total_tokens)}
              </Td>
              <Td>{formatQuota(row.quota)}</Td>
              <Td>{formatLatencyMs(row.average_latency_ms)}</Td>
              <Td>{formatShare(row.share)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Th(props: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={cn(
        'text-muted-foreground h-10 px-3 text-xs font-medium whitespace-nowrap',
        props.align === 'right' ? 'text-right' : 'text-left'
      )}
    >
      {props.children}
    </th>
  )
}

function Td(props: { children: React.ReactNode; title?: string }) {
  return (
    <td
      className='px-3 py-2 text-right font-mono text-xs tabular-nums'
      title={props.title}
    >
      {props.children}
    </td>
  )
}

interface MatrixPanelProps {
  matrix?: UsageMatrixData
  selected?: UsageMatrix
  loading: boolean
  onSelect: (matrix: UsageMatrix) => void
}

function MatrixPanel(props: MatrixPanelProps) {
  const { t } = useTranslation()
  const option =
    MATRIX_OPTIONS.find((entry) => entry.value === props.selected) ??
    MATRIX_OPTIONS[0]
  const matrixOptions = useMemo(() => toSelectOptions(MATRIX_OPTIONS, t), [t])
  const index = indexMatrix(props.matrix, MATRIX_CELL_METRIC)
  const xLabels = props.matrix?.x_labels ?? []
  const yLabels = props.matrix?.y_labels ?? []
  const yMax = 12

  return (
    <div className='bg-card overflow-hidden rounded-2xl border shadow-xs'>
      <div className='flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-5'>
        <div className='text-sm font-semibold'>{t('Usage Matrix')}</div>
        <Combobox
          options={matrixOptions}
          value={option.value}
          onValueChange={(value: string | null) =>
            props.onSelect((value as UsageMatrix) ?? option.value)
          }
          className='w-48'
          aria-label={t('Usage Matrix')}
        />
      </div>

      <div className='p-3 sm:p-4'>
        <MatrixBody
          index={index}
          xLabels={xLabels}
          yLabels={yLabels}
          yMax={yMax}
          loading={props.loading}
          label={t(option.labelKey)}
        />
        <div className='text-muted-foreground mt-2 text-xs'>
          {t('{{y}} × {{x}} · cells show {{metric}}', {
            y: t(option.yKey),
            x: t(option.xKey),
            metric: t('Calls'),
          })}
        </div>
      </div>
    </div>
  )
}

function MatrixBody(props: {
  index: ReturnType<typeof indexMatrix>
  xLabels: string[]
  yLabels: string[]
  yMax: number
  loading: boolean
  label: string
}) {
  const { t } = useTranslation()

  if (props.loading) {
    return <Skeleton className='h-56 w-full' />
  }

  if (props.xLabels.length === 0 || props.yLabels.length === 0) {
    return (
      <div className='text-muted-foreground flex h-56 items-center justify-center text-sm'>
        {t('No data available')}
      </div>
    )
  }

  return (
    <MatrixGrid
      index={props.index}
      xLabels={props.xLabels}
      yLabels={props.yLabels}
      yMax={props.yMax}
      label={props.label}
    />
  )
}

function MatrixGrid(props: {
  index: ReturnType<typeof indexMatrix>
  xLabels: string[]
  yLabels: string[]
  yMax: number
  label: string
}) {
  const { t } = useTranslation()
  const { index, xLabels, yLabels, yMax } = props
  const overflow = yLabels.length - yMax

  return (
    <div className='overflow-x-auto'>
      <table className='border-separate border-spacing-0.5 text-xs'>
        <caption className='text-muted-foreground sr-only'>
          {props.label}
        </caption>
        <thead>
          <tr>
            <th className='sticky left-0' />
            {xLabels.map((label) => (
              <th
                key={label}
                className='text-muted-foreground max-w-20 truncate px-1.5 pb-1 text-left text-[11px] font-medium'
                title={label}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {yLabels.slice(0, yMax).map((yLabel, y) => (
            <tr key={yLabel}>
              <th
                className='text-muted-foreground bg-card sticky left-0 max-w-28 truncate px-1.5 pr-2 text-right text-[11px] font-medium'
                title={yLabel}
              >
                {yLabel}
              </th>
              {xLabels.map((xLabel, x) => {
                const cell = getCellAt(index, x, y)
                const value = cell?.[MATRIX_CELL_METRIC] ?? 0
                return (
                  <td
                    key={xLabel}
                    className={cn(
                      'h-7 min-w-9 rounded-sm text-center align-middle font-mono text-[10px] tabular-nums',
                      getHeatClass(value, index.max)
                    )}
                    title={`${xLabel} × ${yLabel}: ${formatMatrixCellValue(value, MATRIX_CELL_METRIC)} ${t('Calls')}`}
                  >
                    {formatMatrixCellValue(value, MATRIX_CELL_METRIC)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {overflow > 0 && (
        <div className='text-muted-foreground mt-2 text-xs'>
          {t('{{count}} more rows not shown', { count: overflow })}
        </div>
      )}
    </div>
  )
}
