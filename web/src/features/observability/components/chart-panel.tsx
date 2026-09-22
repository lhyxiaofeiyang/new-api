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
import { VChart } from '@visactor/react-vchart'
import type { ReactNode } from 'react'

import { PanelWrapper } from '@/features/dashboard/components/ui/panel-wrapper'
import { useChartTheme } from '@/lib/use-chart-theme'
import { VCHART_OPTION } from '@/lib/vchart'

import type { VChartSpec } from '../lib/charts'

interface ChartPanelProps {
  title: string
  description?: string
  spec: VChartSpec
  headerActions?: ReactNode
  height?: string
  loading?: boolean
  empty?: boolean
  emptyMessage?: string
  className?: string
}

/**
 * Thin adapter over the dashboard's PanelWrapper: observability charts get the
 * same card chrome as the rest of the app, and PanelWrapper keeps owning the
 * loading/empty states.
 */
export function ChartPanel(props: ChartPanelProps) {
  const { resolvedTheme, themeReady } = useChartTheme()

  return (
    <PanelWrapper
      title={props.title}
      description={props.description}
      loading={props.loading}
      empty={props.empty}
      emptyMessage={props.emptyMessage}
      height={props.height ?? 'h-64'}
      className={props.className}
      headerActions={props.headerActions}
      contentClassName='p-1.5 sm:p-2'
    >
      {themeReady && (
        <VChart
          key={`${resolvedTheme}-${props.title}`}
          spec={{
            ...props.spec,
            theme: resolvedTheme === 'dark' ? 'dark' : 'light',
            background: 'transparent',
          }}
          option={VCHART_OPTION}
        />
      )}
    </PanelWrapper>
  )
}
