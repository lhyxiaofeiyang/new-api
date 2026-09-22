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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { MonitoringPage } from '../components/monitoring-page'
import { REQUESTS_RESPONSE, SUMMARY_RESPONSE } from './fixtures'

function mockEndpoints(summary: unknown) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/observability/requests') {
      return { data: { success: true, data: REQUESTS_RESPONSE } }
    }
    if (url === '/api/observability/summary') {
      return { data: { success: true, data: summary } }
    }
    return { data: { success: true, data: { items: [], total: 0 } } }
  })
}

async function renderMonitoring(search: Record<string, unknown> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MonitoringPage search={search} onSearchChange={() => {}} />
    </QueryClientProvider>
  )
  await waitFor(() => expect(client.isFetching()).toBe(0))
  return client
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

test('summarises the matched rows with the aggregate the endpoint returns', async () => {
  mockEndpoints(SUMMARY_RESPONSE)
  await renderMonitoring()

  expect(screen.getByText('Matched')).toBeVisible()
  expect(screen.getByText('Total Tokens')).toBeVisible()
  expect(
    screen.getByText(
      new Intl.NumberFormat('en', {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(REQUESTS_RESPONSE.aggregate.total_tokens)
    )
  ).toBeVisible()
})

test('renders a row and expands it into the retry chain and billing detail', async () => {
  const user = userEvent.setup()
  mockEndpoints(SUMMARY_RESPONSE)
  await renderMonitoring()

  const cell = await screen.findByText('prod-key')
  await user.click(cell)

  expect(await screen.findByText('Billing')).toBeVisible()
  expect(screen.getByText('Cache Ratio')).toBeVisible()
  // "First Byte" is both a column header and a detail label, so it must render twice.
  expect(screen.getAllByText('First Byte')).toHaveLength(2)
})

test('shows the user column and drops the quota column, matching the usage log table', async () => {
  mockEndpoints(SUMMARY_RESPONSE)
  await renderMonitoring()

  // 用户列（后端 users JOIN 提供 username，与「使用日志」同款呈现）
  expect(
    screen.getByRole('columnheader', { name: 'User' })
  ).toBeVisible()
  expect(await screen.findByText('root')).toBeVisible()

  // 额度列已删除。注意：t('Quota') 在展开明细与聚合卡片里仍合法存在，
  // 因此这里只能对表头断言，不能用全页文本搜索。
  expect(
    screen.queryByRole('columnheader', { name: 'Quota' })
  ).not.toBeInTheDocument()
})

test('reports the failure column as unknown when error logs are disabled', async () => {
  mockEndpoints({
    ...SUMMARY_RESPONSE,
    data_source: {
      error_log_enabled: false,
      failure_source: 'perf_metrics',
      log_rows: 1,
    },
  })
  await renderMonitoring()

  expect(screen.queryByText('Failed')).not.toBeInTheDocument()
})
