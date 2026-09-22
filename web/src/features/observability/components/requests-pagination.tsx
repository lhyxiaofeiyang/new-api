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
import type { Table as TanstackTable } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatNumber } from '@/lib/format'

interface RequestsPaginationProps<TData> {
  table: TanstackTable<TData>
  total: number
  pageSizeOptions: readonly number[]
}

/**
 * Server-driven pagination. Upstream `DataTablePagination` reads its own
 * hard-coded page-size ladder and derives the row count from the client row
 * model, so it cannot express the contract's page sizes (up to 500) or the
 * server's total. This keeps the same controls and layout.
 */
export function RequestsPagination<TData>(
  props: RequestsPaginationProps<TData>
) {
  const { t } = useTranslation()
  const { pageIndex, pageSize } = props.table.getState().pagination
  const currentPage = pageIndex + 1
  const totalPages = Math.max(1, props.table.getPageCount())

  return (
    <div className='flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:px-4'>
      <div className='text-muted-foreground text-xs tabular-nums'>
        {t('{{count}} rows', { count: formatNumber(props.total) })}
      </div>
      <div className='flex items-center gap-3'>
        <div className='hidden items-center gap-2 sm:flex'>
          <span className='text-muted-foreground text-xs'>
            {t('Rows per page')}
          </span>
          <Select
            items={props.pageSizeOptions.map((option) => ({
              value: String(option),
              label: String(option),
            }))}
            value={String(pageSize)}
            onValueChange={(value) => props.table.setPageSize(Number(value))}
          >
            <SelectTrigger aria-label={t('Rows per page')} className='h-8 w-20'>
              <SelectValue placeholder={pageSize} />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {props.pageSizeOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <span className='text-muted-foreground text-xs tabular-nums'>
          {currentPage} / {totalPages}
        </span>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={!props.table.getCanPreviousPage()}
            onClick={() => props.table.previousPage()}
          >
            {t('Previous')}
          </Button>
          <Button
            variant='outline'
            size='sm'
            disabled={!props.table.getCanNextPage()}
            onClick={() => props.table.nextPage()}
          >
            {t('Next')}
          </Button>
        </div>
      </div>
    </div>
  )
}
