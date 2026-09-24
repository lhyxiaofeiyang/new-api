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
import { useNavigate } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Download, KeyRound, RefreshCw } from 'lucide-react'
import { Fragment, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DataTablePage,
  DataTableRow,
  TruncatedCell,
  useDataTable,
} from '@/components/data-table'
import { GroupBadge } from '@/components/group-badge'
import { SectionPageLayout } from '@/components/layout'
import { StatusBadge } from '@/components/status-badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { TableCell, TableRow } from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getChannels } from '@/features/channels/api'
import { CHANNEL_TYPES } from '@/features/channels/constants'
import { searchApiKeys } from '@/features/keys/api'
import { ModelBadge } from '@/features/usage-logs/components/model-badge'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import {
  formatDateTimeStr,
  formatNumber,
  formatQuota,
  formatTokens,
} from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { downloadObservabilityRequests } from '../api'
import {
  DEFAULT_REQUESTS_RANGE,
  REQUEST_SORT_OPTIONS,
  REQUESTS_DEFAULT_PAGE_SIZE,
  REQUESTS_PAGE_SIZE_OPTIONS,
  SORT_ORDER_OPTIONS,
} from '../constants'
import { useObservabilityDataSource, useObservabilityRequests } from '../hooks'
import { formatLatencyMs, formatTokenCount } from '../lib/format'
import {
  getChannelTypeLabel,
  resolveTimeRange,
  toSelectOptions,
} from '../lib/query'
import type {
  ObservabilityRequestItem,
  ObservabilitySearch,
  RequestSort,
  SortOrder,
} from '../types'
import { RangeSelector } from './range-selector'
import { RequestsPagination } from './requests-pagination'

interface MonitoringPageProps {
  search: ObservabilitySearch
  onSearchChange: (patch: Partial<ObservabilitySearch>) => void
}

type ChannelOption = { label: string; value: string }

const ALL_VALUE = '__all__'
const BOOLEAN_OPTIONS = [
  { value: ALL_VALUE, label: 'All' },
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]

function toSortedIdOptions(entries: Array<[number, string]>): ChannelOption[] {
  return entries
    .map(([id, name]) => ({ value: String(id), label: name }))
    .sort((a, b) => Number(a.value) - Number(b.value))
}

function FilterField(props: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', props.className)}>
      <Label className='text-muted-foreground text-xs font-medium'>
        {props.label}
      </Label>
      {props.children}
    </div>
  )
}

function SummaryBadge(props: { label: string; value: string; accent: string }) {
  return (
    <span className='border-border/60 bg-muted/25 inline-flex h-7 items-center gap-2 rounded-md border px-2.5 text-xs shadow-xs'>
      <span className={cn('h-3.5 w-0.5 rounded-full', props.accent)} />
      <span className='text-muted-foreground'>{props.label}</span>
      <span className='text-foreground/85 font-mono font-semibold tabular-nums'>
        {props.value}
      </span>
    </span>
  )
}

function RequestDetail(props: { item: ObservabilityRequestItem }) {
  const { t } = useTranslation()
  const { item } = props
  const hasRetryChain = item.retry_chain.length > 0

  return (
    <div className='grid gap-3 sm:grid-cols-2'>
      <div className='space-y-2'>
        <div className='text-muted-foreground text-xs font-medium'>
          {t('Retry Chain')}
        </div>
        {hasRetryChain ? (
          <ol className='space-y-1.5'>
            {item.retry_chain.map((attempt) => (
              <li
                key={`${attempt.index}-${attempt.channel_id}`}
                className='bg-muted/40 flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs'
              >
                <span className='font-mono tabular-nums'>
                  #{attempt.index + 1}
                </span>
                <span className='truncate'>
                  {t('Channel')} {attempt.channel_id}
                </span>
                <span className='text-muted-foreground font-mono tabular-nums'>
                  {formatLatencyMs(attempt.elapsed_ms)}
                </span>
                <Badge variant='outline'>{attempt.action || '-'}</Badge>
              </li>
            ))}
          </ol>
        ) : (
          <div className='text-muted-foreground text-xs'>{t('No retries')}</div>
        )}
      </div>

      <div className='space-y-2'>
        <div className='text-muted-foreground text-xs font-medium'>
          {t('Billing')}
        </div>
        <dl className='divide-border/60 space-y-0 divide-y text-xs'>
          <DetailRow
            label={t('Prompt Tokens')}
            value={formatNumber(item.prompt_tokens)}
          />
          <DetailRow
            label={t('Completion Tokens')}
            value={formatNumber(item.completion_tokens)}
          />
          <DetailRow
            label={t('Cached Tokens')}
            value={formatNumber(item.cached_tokens)}
          />
          <DetailRow
            label={t('Cache Ratio')}
            value={item.cache_ratio ? item.cache_ratio.toFixed(4) : '-'}
          />
          <DetailRow label={t('Quota')} value={formatQuota(item.quota)} />
          <DetailRow
            label={t('First Byte')}
            value={formatLatencyMs(item.ttft_ms)}
          />
          <DetailRow
            label={t('Duration')}
            value={formatLatencyMs(item.use_time_ms)}
          />
          {item.is_failed && (
            <DetailRow
              label={t('Failure')}
              value={
                item.fail_summary ||
                (item.fail_status_code
                  ? String(item.fail_status_code)
                  : t('Failed'))
              }
            />
          )}
        </dl>
      </div>
    </div>
  )
}

/** 与「使用日志」保持一致：用户列 = 头像 + 用户名。 */
function UserCell(props: { item: ObservabilityRequestItem }) {
  const name = props.item.username
  if (!name) {
    return props.item.user_id > 0 ? (
      <span className='text-muted-foreground font-mono text-xs tabular-nums'>
        #{props.item.user_id}
      </span>
    ) : (
      <span className='text-muted-foreground'>-</span>
    )
  }
  return (
    <div className='flex min-w-0 items-center gap-2'>
      <Avatar className='ring-border/60 size-6 ring-1 max-sm:hidden'>
        <AvatarFallback
          className='text-[11px] font-semibold'
          style={getUserAvatarStyle(name)}
        >
          {getUserAvatarFallback(name)}
        </AvatarFallback>
      </Avatar>
      <TruncatedCell>{name}</TruncatedCell>
    </div>
  )
}

/**
 * 与「使用日志」的渠道列保持一致：pill 里是 #id（按 id 取色、可复制、mono），
 * 渠道名在下方一行，渠道类型放进 tooltip（上游该列不放类型，故不占正文位）。
 */
function ChannelCell(props: { item: ObservabilityRequestItem }) {
  const { t } = useTranslation()
  const { channel_id: channelId, channel_name: channelName } = props.item
  const channelIdDisplay = `#${channelId}`
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={<div className='flex max-w-[160px] flex-col gap-0.5' />}
        >
          <div className='flex min-w-0 items-center gap-1'>
            <StatusBadge
              label={channelIdDisplay}
              autoColor={String(channelId)}
              copyText={String(channelId)}
              size='sm'
              showDot={false}
              className='font-mono'
            />
          </div>
          {channelName && (
            <span className='text-muted-foreground/70 truncate [font-family:var(--font-body)] !text-xs'>
              {channelName}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent>
          <div className='space-y-1'>
            <p>
              {channelName
                ? `${channelName} ${channelIdDisplay}`
                : channelIdDisplay}
            </p>
            <p className='text-muted-foreground text-xs'>
              {t('Channel Type')}:{' '}
              {getChannelTypeLabel(props.item.channel_type, t)}
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * 与「使用日志」的令牌列保持一致：带 KeyRound 图标的 pill，组名在下方。
 *
 * 与「模型」列同一取舍：**pill 本体可复制**（`copyable`），点击时 StatusBadge
 * 会 stopPropagation，代价是点 pill 不触发行展开；点行内其它位置仍可展开。
 * 原先的「pill 不可复制 + 独立 CopyButton」方案已废弃——用户反馈那个常显的
 * 复制图标是多余的视觉噪音，模型列的做法才是本项目的既有约定。
 */
function TokenCell(props: { item: ObservabilityRequestItem }) {
  const name = props.item.token_name
  if (!name) {
    return <span className='text-muted-foreground'>-</span>
  }
  return (
    <div className='flex max-w-[200px] min-w-0 flex-col gap-0.5'>
      <StatusBadge
        label={name}
        icon={KeyRound}
        size='sm'
        showDot={false}
        copyText={name}
        className='border-border/60 bg-muted/30 text-foreground h-6 max-w-full gap-1.5 overflow-hidden rounded-md border px-2 py-0.5 [font-family:var(--font-body)]'
      />
      {props.item.group && (
        <span className='block max-w-full truncate text-xs leading-none'>
          <GroupBadge
            group={props.item.group}
            type='text'
            size='sm'
            className='inline align-baseline text-xs leading-none [&>span]:leading-none'
          />
        </span>
      )}
    </div>
  )
}

/** 与「使用日志」保持一致：耗时用阈值 pill 呈现（> 60s 判红）。 */
function renderLatencyBadge(ms: number) {
  if (!ms) {
    return <span className='text-muted-foreground/60 text-xs'>-</span>
  }
  return (
    <StatusBadge
      label={formatLatencyMs(ms)}
      variant={ms > 60_000 ? 'danger' : 'success'}
      copyable={false}
      className='font-mono tabular-nums'
    />
  )
}

function renderStatus(
  item: ObservabilityRequestItem,
  errorLogEnabled: boolean | undefined,
  t: (key: string) => string
) {
  if (errorLogEnabled === false) {
    return <span className='text-muted-foreground'>-</span>
  }
  if (!item.is_failed) {
    return (
      <StatusBadge label={t('Success')} variant='success' showDot={false} />
    )
  }
  return (
    <StatusBadge
      label={String(item.fail_status_code ?? t('Failed'))}
      variant='danger'
      showDot={false}
    />
  )
}

function DetailRow(props: { label: string; value: string }) {
  return (
    <div className='flex items-center justify-between gap-3 py-1.5'>
      <dt className='text-muted-foreground'>{props.label}</dt>
      <dd className='font-mono font-medium tabular-nums'>{props.value}</dd>
    </div>
  )
}

export function MonitoringPage(props: MonitoringPageProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [exporting, setExporting] = useState(false)
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null)

  const range = resolveTimeRange(props.search, DEFAULT_REQUESTS_RANGE)
  const page = props.search.page ?? 1
  const pageSize = props.search.pageSize ?? REQUESTS_DEFAULT_PAGE_SIZE

  const params = useMemo(
    () => ({
      ...range,
      page,
      page_size: pageSize,
      token_id: props.search.tokenId,
      channel_id: props.search.channelId,
      channel_type: props.search.channelType,
      model_name: props.search.model || undefined,
      group: props.search.group || undefined,
      is_stream: props.search.isStream,
      only_failed: props.search.onlyFailed,
      keyword: props.search.keyword || undefined,
      sort: props.search.sort ?? 'created_at',
      order: props.search.order ?? 'desc',
    }),
    [range, page, pageSize, props.search]
  )

  const { data, isLoading, isFetching, refetch } =
    useObservabilityRequests(params)
  const items = data?.items ?? []
  const { dataSource } = useObservabilityDataSource({
    range: range.range,
    start: range.start,
    end: range.end,
  })
  const errorLogEnabled = dataSource?.error_log_enabled

  const { data: channels } = useQuery({
    queryKey: ['observability', 'channel-options'],
    queryFn: async () =>
      requireServerSuccess(await getChannels({ page_size: 100 })),
    staleTime: 5 * 60_000,
  })

  const { data: apiKeys } = useQuery({
    queryKey: ['observability', 'token-options'],
    queryFn: async () =>
      requireServerSuccess(await searchApiKeys({ p: 1, size: 100 })),
    staleTime: 5 * 60_000,
  })

  const channelOptions = useMemo<ChannelOption[]>(
    () =>
      toSortedIdOptions(
        (channels?.data?.items ?? []).map((channel) => [
          channel.id,
          channel.name,
        ])
      ),
    [channels]
  )

  const tokenOptions = useMemo<ChannelOption[]>(
    () =>
      toSortedIdOptions(
        (apiKeys?.data?.items ?? []).map((key) => [key.id, key.name])
      ),
    [apiKeys]
  )

  const modelOptions = useMemo<ChannelOption[]>(() => {
    const names = new Set<string>()
    for (const row of data?.items ?? []) {
      if (row.model_name) names.add(row.model_name)
    }
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ value: name, label: name }))
  }, [data])

  const sortOptions = useMemo(
    () => toSelectOptions(REQUEST_SORT_OPTIONS, t),
    [t]
  )

  const orderOptions = useMemo(
    () => toSelectOptions(SORT_ORDER_OPTIONS, t),
    [t]
  )

  const booleanOptions = useMemo(
    () =>
      BOOLEAN_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.label),
      })),
    [t]
  )

  const columns = useMemo<ColumnDef<ObservabilityRequestItem, unknown>[]>(
    () => [
      {
        id: 'created_at',
        accessorKey: 'created_at',
        header: t('Time'),
        cell: ({ row }) => (
          <span className='font-mono text-xs tabular-nums'>
            {formatDateTimeStr(new Date(row.original.created_at * 1000))}
          </span>
        ),
      },
      {
        id: 'username',
        accessorKey: 'username',
        header: t('User'),
        cell: ({ row }) => <UserCell item={row.original} />,
      },
      {
        id: 'token_name',
        accessorKey: 'token_name',
        header: t('API Key'),
        cell: ({ row }) => <TokenCell item={row.original} />,
      },
      {
        id: 'channel',
        header: t('Channel'),
        cell: ({ row }) => <ChannelCell item={row.original} />,
      },
      {
        id: 'model_name',
        accessorKey: 'model_name',
        header: t('Model'),
        cell: ({ row }) => (
          <div className='flex max-w-[220px] min-w-0'>
            <ModelBadge modelName={row.original.model_name} wrapText />
          </div>
        ),
      },
      {
        id: 'tokens',
        // 只展示总量；输入/输出/缓存三个维度保留在展开明细里。
        header: t('Total Tokens'),
        cell: ({ row }) => (
          <span className='font-mono text-xs tabular-nums'>
            {formatTokens(row.original.total_tokens)}
          </span>
        ),
      },
      {
        id: 'use_time_ms',
        accessorKey: 'use_time_ms',
        header: t('Duration'),
        cell: ({ row }) => renderLatencyBadge(row.original.use_time_ms),
      },
      {
        id: 'ttft_ms',
        accessorKey: 'ttft_ms',
        header: t('First Byte'),
        cell: ({ row }) => (
          <span className='font-mono text-xs tabular-nums'>
            {formatLatencyMs(row.original.ttft_ms)}
          </span>
        ),
      },
      {
        id: 'is_stream',
        accessorKey: 'is_stream',
        header: t('Streaming'),
        cell: ({ row }) =>
          row.original.is_stream ? (
            <StatusBadge label={t('Yes')} variant='info' showDot={false} />
          ) : (
            <span className='text-muted-foreground'>-</span>
          ),
      },
      {
        id: 'retry_chain',
        header: t('Retry Chain'),
        cell: ({ row }) =>
          row.original.retry_chain.length > 0 ? (
            <StatusBadge
              label={String(row.original.retry_chain.length)}
              variant='warning'
              copyable={false}
              className='tabular-nums'
            />
          ) : (
            <span className='text-muted-foreground'>-</span>
          ),
      },
      {
        id: 'status',
        // 关闭错误日志时该列恒为 '-'，就地标注原因，避免用户以为是数据缺失。
        header:
          errorLogEnabled === false
            ? `${t('Status')} · ${t('Requires error logs')}`
            : t('Status'),
        cell: ({ row }) => renderStatus(row.original, errorLogEnabled, t),
      },
    ],
    [t, errorLogEnabled]
  )

  const { table } = useDataTable({
    data: items,
    columns,
    manualPagination: true,
    manualSorting: true,
    totalCount: data?.total ?? 0,
    pagination: { pageIndex: page - 1, pageSize },
    onPaginationChange: (updater) => {
      const next =
        typeof updater === 'function'
          ? updater({ pageIndex: page - 1, pageSize })
          : updater
      props.onSearchChange({
        page: next.pageIndex + 1,
        pageSize: next.pageSize,
      })
    },
  })

  const handleExport = useCallback(
    async (format: 'csv' | 'json') => {
      setExporting(true)
      try {
        const download = await downloadObservabilityRequests(
          { ...params, page: undefined, page_size: undefined },
          format
        )
        // 后端有行数上限：被截断时明确告知，别让用户以为导出了全部结果。
        if (download.truncated) {
          toast.warning(
            t('Export truncated to {{exported}} of {{total}} rows', {
              exported: download.exported,
              total: download.total,
            })
          )
        }
        const blob = download.blob
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
        link.href = url
        link.download = `newapi-observability-${stamp}.${format}`
        document.body.append(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
      } catch {
        toast.error(t('Export failed'))
      } finally {
        setExporting(false)
      }
    },
    [params, t]
  )

  const activeFilterCount = [
    props.search.tokenId,
    props.search.channelId,
    props.search.channelType,
    props.search.model,
    props.search.group,
    props.search.isStream,
    props.search.onlyFailed,
    props.search.keyword,
  ].filter((value) => value !== undefined && value !== '').length

  return (
    <SectionPageLayout stackActionsOnMobile>
      <SectionPageLayout.Title>
        {t('Request Monitoring')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} />
          {t('Refresh')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant='outline' size='sm' disabled={exporting}>
                <Download className='size-4' />
                {t('Export')}
              </Button>
            }
          />
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onClick={() => handleExport('csv')}>
              {t('Export CSV')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('json')}>
              {t('Export JSON')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SectionPageLayout.Actions>

      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col gap-3 sm:gap-4'>
          <div className='bg-card rounded-2xl border p-3 shadow-xs sm:p-4'>
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
              <FilterField label={t('Time Range')}>
                <RangeSelector
                  range={range.range}
                  start={range.start}
                  end={range.end}
                  onRangeChange={(nextRange, bounds) =>
                    props.onSearchChange({
                      range: nextRange,
                      start: bounds?.start,
                      end: bounds?.end,
                      page: 1,
                    })
                  }
                />
              </FilterField>
              <FilterField label={t('API Key')}>
                <Combobox
                  options={tokenOptions}
                  value={
                    props.search.tokenId ? String(props.search.tokenId) : null
                  }
                  onValueChange={(value) =>
                    props.onSearchChange({
                      tokenId: value ? Number(value) : undefined,
                      page: 1,
                    })
                  }
                  placeholder={t('All')}
                  searchPlaceholder={t('Search')}
                  emptyText={t('No Data')}
                  aria-label={t('API Key')}
                />
              </FilterField>
              <FilterField label={t('Channel')}>
                <Combobox
                  options={channelOptions}
                  value={
                    props.search.channelId
                      ? String(props.search.channelId)
                      : null
                  }
                  onValueChange={(value) =>
                    props.onSearchChange({
                      channelId: value ? Number(value) : undefined,
                      page: 1,
                    })
                  }
                  placeholder={t('All')}
                  searchPlaceholder={t('Search')}
                  emptyText={t('No Data')}
                  aria-label={t('Channel')}
                />
              </FilterField>
              <FilterField label={t('Channel Type')}>
                <Combobox
                  options={Object.entries(CHANNEL_TYPES).map(
                    ([id, labelKey]) => ({
                      value: id,
                      label: t(labelKey),
                    })
                  )}
                  value={
                    props.search.channelType
                      ? String(props.search.channelType)
                      : null
                  }
                  onValueChange={(value) =>
                    props.onSearchChange({
                      channelType: value ? Number(value) : undefined,
                      page: 1,
                    })
                  }
                  placeholder={t('All')}
                  searchPlaceholder={t('Search')}
                  emptyText={t('No Data')}
                  aria-label={t('Channel Type')}
                />
              </FilterField>
              <FilterField label={t('Model')}>
                <Combobox
                  options={modelOptions}
                  value={props.search.model ?? null}
                  onValueChange={(value) =>
                    props.onSearchChange({
                      model: value ?? undefined,
                      page: 1,
                    })
                  }
                  allowCustomValue
                  placeholder={t('All')}
                  searchPlaceholder={t('Search')}
                  emptyText={t('No Data')}
                  aria-label={t('Model')}
                />
              </FilterField>
              <FilterField label={t('Group')}>
                <Input
                  value={props.search.group ?? ''}
                  onChange={(event) =>
                    props.onSearchChange({
                      group: event.target.value || undefined,
                      page: 1,
                    })
                  }
                  placeholder={t('All')}
                />
              </FilterField>
              <FilterField label={t('Keyword')}>
                <Input
                  value={props.search.keyword ?? ''}
                  onChange={(event) =>
                    props.onSearchChange({
                      keyword: event.target.value || undefined,
                      page: 1,
                    })
                  }
                  placeholder={t('Request ID')}
                />
              </FilterField>
              <FilterField label={t('Sort')}>
                <div className='flex items-center gap-2'>
                  <Combobox
                    options={sortOptions}
                    value={props.search.sort ?? 'created_at'}
                    onValueChange={(value: string | null) =>
                      props.onSearchChange({
                        sort: (value as RequestSort) ?? undefined,
                        page: 1,
                      })
                    }
                    aria-label={t('Sort')}
                  />
                  <Combobox
                    options={orderOptions}
                    value={props.search.order ?? 'desc'}
                    onValueChange={(value: string | null) =>
                      props.onSearchChange({
                        order: (value as SortOrder) ?? undefined,
                        page: 1,
                      })
                    }
                    aria-label={t('Sort Order')}
                  />
                </div>
              </FilterField>
            </div>

            <div className='mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3'>
              <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
                <div className='flex items-center gap-2'>
                  <Switch
                    id='observability-only-failed'
                    size='sm'
                    checked={props.search.onlyFailed ?? false}
                    onCheckedChange={(checked) =>
                      props.onSearchChange({
                        onlyFailed: checked || undefined,
                        page: 1,
                      })
                    }
                  />
                  <Label
                    htmlFor='observability-only-failed'
                    className='text-xs font-normal'
                  >
                    {/* 关闭错误日志时「只看失败」无数据可筛，就地标注原因。 */}
                    {errorLogEnabled === false
                      ? `${t('Failed Only')} · ${t('Requires error logs')}`
                      : t('Failed Only')}
                  </Label>
                </div>
                <div className='flex items-center gap-2'>
                  <Combobox
                    options={booleanOptions}
                    value={
                      props.search.isStream === undefined
                        ? ALL_VALUE
                        : String(props.search.isStream)
                    }
                    onValueChange={(value) =>
                      props.onSearchChange({
                        isStream:
                          value === ALL_VALUE ? undefined : value === 'true',
                        page: 1,
                      })
                    }
                    className='w-32'
                    aria-label={t('Streaming')}
                  />
                  <span className='text-muted-foreground text-xs'>
                    {t('Streaming')}
                  </span>
                </div>
              </div>

              <div className='flex flex-wrap items-center gap-2'>
                {isLoading ? (
                  <>
                    <Skeleton className='h-7 w-28 rounded-md' />
                    <Skeleton className='h-7 w-32 rounded-md' />
                    <Skeleton className='h-7 w-28 rounded-md' />
                  </>
                ) : (
                  <>
                    <SummaryBadge
                      label={t('Matched')}
                      value={formatNumber(data?.total ?? 0)}
                      accent='bg-sky-500/70'
                    />
                    <SummaryBadge
                      label={t('Total Tokens')}
                      value={formatTokenCount(
                        data?.aggregate.total_tokens ?? 0
                      )}
                      accent='bg-emerald-500/70'
                    />
                    <SummaryBadge
                      label={t('Quota')}
                      value={formatQuota(data?.aggregate.quota ?? 0)}
                      accent='bg-amber-500/70'
                    />
                    <SummaryBadge
                      label={t('Average Latency')}
                      value={formatLatencyMs(
                        data?.aggregate.average_latency_ms ?? 0
                      )}
                      accent='bg-rose-500/65'
                    />
                  </>
                )}
                {activeFilterCount > 0 && (
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() =>
                      navigate({
                        to: '/observability/$section',
                        params: { section: 'monitoring' },
                        search: {},
                      })
                    }
                  >
                    {t('Reset')}
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className='min-h-0 flex-1'>
            <DataTablePage
              table={table}
              columns={columns}
              isLoading={isLoading}
              isFetching={isFetching}
              toolbar={null}
              fixedHeight={false}
              paginationInFooter={false}
              emptyTitle={t('No Data')}
              emptyDescription={t(
                'No records found. Try adjusting your filters.'
              )}
              renderRow={(row) => (
                <Fragment key={row.id}>
                  <DataTableRow
                    row={row}
                    className='cursor-pointer transition-colors'
                    onClick={(event) => {
                      const target = event.target as HTMLElement
                      if (target.closest('button, a, [role="menu"]')) return
                      setExpandedRowId((current) =>
                        current === row.original.id ? null : row.original.id
                      )
                    }}
                  />
                  {expandedRowId === row.original.id && (
                    <RequestDetailRow
                      item={row.original}
                      colSpan={columns.length}
                    />
                  )}
                </Fragment>
              )}
              afterTable={
                <RequestsPagination
                  table={table}
                  total={data?.total ?? 0}
                  pageSizeOptions={REQUESTS_PAGE_SIZE_OPTIONS}
                />
              }
            />
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function RequestDetailRow(props: {
  item: ObservabilityRequestItem
  colSpan: number
}) {
  return (
    <TableRow className='bg-muted/20 hover:bg-muted/20'>
      <TableCell colSpan={props.colSpan} className='px-3 py-3'>
        <RequestDetail item={props.item} />
      </TableCell>
    </TableRow>
  )
}
