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
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { lazy, Suspense, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Skeleton } from '@/components/ui/skeleton'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import type { ObservabilitySectionId } from './constants'
import { buildDrillDownSearch } from './lib/query'
import type { ObservabilitySearch, UsageDimension } from './types'

type ObservabilityDimension = UsageDimension

/**
 * The router merges the search schema of every matched route, so the reducer
 * receives keys from other sections too. Widening the accumulator keeps the
 * spread type-safe without dropping parameters this page does not own.
 */
type SearchRecord = Record<string, unknown>

const route = getRouteApi('/_authenticated/observability/$section')

const LazyOverviewPage = lazy(() =>
  import('./components/overview-page').then((m) => ({
    default: m.OverviewPage,
  }))
)

const LazyMonitoringPage = lazy(() =>
  import('./components/monitoring-page').then((m) => ({
    default: m.MonitoringPage,
  }))
)

const LazyUsagePage = lazy(() =>
  import('./components/usage-page').then((m) => ({
    default: m.UsagePage,
  }))
)

function PageFallback() {
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title />
      <SectionPageLayout.Content>
        <div className='space-y-3 sm:space-y-4'>
          <Skeleton className='h-24 w-full rounded-2xl' />
          <Skeleton className='h-64 w-full rounded-2xl' />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

/**
 * Section dispatcher. Each page owns its own page header and filter toolbar —
 * matching how `OverviewDashboard` is structured — so the third navigation
 * entry stays the single place that switches sections.
 */
export function Observability() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { section } = route.useParams()
  const search = route.useSearch() as ObservabilitySearch
  const userRole = useAuthStore((state) => state.auth.user?.role)

  const isAdmin = Boolean(userRole && userRole >= ROLE.ADMIN)
  const activeSection = section as ObservabilitySectionId

  const handleSearchChange = useCallback(
    (patch: Partial<ObservabilitySearch>) => {
      navigate({
        to: '/observability/$section',
        params: { section: activeSection },
        search: (prev) => ({ ...(prev as SearchRecord), ...patch }),
        replace: true,
      })
    },
    [activeSection, navigate]
  )

  const handleDrillDown = useCallback(
    (dimension: ObservabilityDimension, key: string) => {
      navigate({
        to: '/observability/$section',
        params: { section: 'monitoring' },
        search: (prev) => ({
          ...(prev as SearchRecord),
          ...buildDrillDownSearch(dimension, key),
          page: 1,
        }),
      })
    },
    [navigate]
  )

  if (!isAdmin) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Token Monitoring')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='bg-card text-muted-foreground flex h-40 items-center justify-center rounded-2xl border text-sm'>
            {t('You do not have permission to view this page.')}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  const renderSection = () => {
    if (activeSection === 'monitoring') {
      return (
        <LazyMonitoringPage
          search={search}
          onSearchChange={handleSearchChange}
        />
      )
    }
    if (activeSection === 'usage') {
      return (
        <LazyUsagePage
          search={search}
          onSearchChange={handleSearchChange}
          onDrillDown={handleDrillDown}
        />
      )
    }
    return (
      <LazyOverviewPage search={search} onSearchChange={handleSearchChange} />
    )
  }

  return <Suspense fallback={<PageFallback />}>{renderSection()}</Suspense>
}
