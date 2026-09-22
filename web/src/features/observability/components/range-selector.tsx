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
import { useTranslation } from 'react-i18next'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'

import { RANGE_OPTIONS } from '../constants'
import type { ObservabilityRange } from '../types'

interface RangeSelectorProps {
  range: ObservabilityRange
  start?: number
  end?: number
  onRangeChange: (
    range: ObservabilityRange,
    bounds?: { start?: number; end?: number }
  ) => void
  className?: string
}

/**
 * Preset ranges plus an inline custom picker. The custom picker only appears
 * once `custom` is selected so the toolbar stays a single row by default.
 */
export function RangeSelector(props: RangeSelectorProps) {
  const { t } = useTranslation()
  const selected = RANGE_OPTIONS.find((option) => option.value === props.range)

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Select
        items={RANGE_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        }))}
        value={props.range}
        onValueChange={(value) => {
          const next = RANGE_OPTIONS.find((option) => option.value === value)
          if (!next) return
          if (next.value === 'custom') {
            props.onRangeChange('custom')
            return
          }
          props.onRangeChange(next.value)
        }}
      >
        <SelectTrigger
          aria-label={t('Time Range')}
          className={props.className ?? 'h-8 w-40'}
        >
          <SelectValue>
            <span className='truncate'>
              {t(selected?.labelKey ?? 'Last 24 Hours')}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} className='min-w-40'>
          <SelectGroup>
            {RANGE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {props.range === 'custom' && (
        <div className='w-full min-w-0 sm:w-72'>
          <CompactDateTimeRangePicker
            start={props.start ? new Date(props.start * 1000) : undefined}
            end={props.end ? new Date(props.end * 1000) : undefined}
            onChange={({ start, end }) => {
              props.onRangeChange('custom', {
                start: start ? Math.floor(start.getTime() / 1000) : undefined,
                end: end ? Math.floor(end.getTime() / 1000) : undefined,
              })
            }}
          />
        </div>
      )}
    </div>
  )
}
