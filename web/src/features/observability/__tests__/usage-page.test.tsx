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

import { UsagePage } from '../components/usage-page'
import { USAGE_RESPONSE } from './fixtures'

// VChart cannot render under jsdom (no canvas); see the overview page test.
vi.mock('../components/chart-panel', () => ({
  ChartPanel: (props: { title: string }) => (
    <div data-testid='chart-panel'>{props.title}</div>
  ),
}))

function mockUsage(payload: unknown) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/observability/usage') {
      return { data: { success: true, data: payload } }
    }
    return { data: { success: true, data: {} } }
  })
}

async function renderUsage(
  props: {
    search?: Record<string, unknown>
    onDrillDown?: (dimension: string, key: string) => void
  } = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <UsagePage
        search={props.search ?? {}}
        onSearchChange={() => {}}
        onDrillDown={props.onDrillDown ?? (() => {})}
      />
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

test('renders the dimension table from the usage rows', async () => {
  mockUsage(USAGE_RESPONSE)
  await renderUsage()

  // The label also appears as a heat-matrix row header, so scope to the table.
  expect((await screen.findAllByText('prod-key')).length).toBeGreaterThan(0)
  expect(screen.getByText('Share')).toBeVisible()
  expect(screen.getByText('24.93%')).toBeVisible()
})

test('drills down into the monitoring view with the clicked dimension', async () => {
  const user = userEvent.setup()
  const onDrillDown = vi.fn()
  mockUsage(USAGE_RESPONSE)
  await renderUsage({ onDrillDown })

  const cells = await screen.findAllByText('prod-key')
  await user.click(cells[0])

  expect(onDrillDown).toHaveBeenCalledWith('token', '7')
})

test('renders the heat matrix cells the endpoint returns', async () => {
  mockUsage(USAGE_RESPONSE)
  await renderUsage()

  expect(screen.getByText('Usage Matrix')).toBeVisible()
  expect(screen.getByText('gpt-4o')).toBeVisible()
  expect(screen.getByText('dev-key')).toBeVisible()
})

test('marks the drilled-down row as selected from the URL', async () => {
  mockUsage(USAGE_RESPONSE)
  // token id 7 is `prod-key` in the fixture; the URL records the drill-down.
  await renderUsage({ search: { tokenId: 7 } })

  await screen.findAllByText('prod-key')
  const selected = document.querySelectorAll('tr[data-state="selected"]')
  expect(selected).toHaveLength(1)
  expect(selected[0]).toHaveTextContent('prod-key')
})

test('leaves rows unselected when no drill-down is recorded', async () => {
  mockUsage(USAGE_RESPONSE)
  await renderUsage()

  await screen.findAllByText('prod-key')
  expect(document.querySelectorAll('tr[data-state="selected"]')).toHaveLength(0)
})

test('requests the default matrix on first load, before any filter is touched', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/observability/usage') {
      return { data: { success: true, data: USAGE_RESPONSE } }
    }
    return { data: { success: true, data: {} } }
  })

  // First entry: the URL carries no filters at all, so the page has to supply
  // the matrix itself. Without it the endpoint omits `matrix` and the panel
  // stays empty until the user happens to touch a dropdown.
  await renderUsage()

  const usageCall = get.mock.calls.find(
    ([url]) => url === '/api/observability/usage'
  )
  const params = usageCall?.[1]?.params as Record<string, unknown>
  expect(params.matrix).toBe('token_model')
})

test('stretches the matrix across a full row instead of sharing it with the cost chart', async () => {
  mockUsage(USAGE_RESPONSE)
  await renderUsage()

  // B 项：矩阵与成本构成图此前被 lg:grid-cols-2 塞进两列，矩阵只拿到半宽，
  // 右侧列被裁掉。修法是各自独占整行，两列栅格必须消失。
  const matrix = await screen.findByText('Usage Matrix')
  const chart = screen.getByText('Cost Composition')
  expect(matrix.closest('.lg\\:grid-cols-2')).toBeNull()
  expect(chart.closest('.lg\\:grid-cols-2')).toBeNull()
  // 两者不再是同一栅格容器里的兄弟（原先同处一个 grid 容器）。
  const chartRow = chart.closest('div')
  expect(chartRow?.contains(matrix)).toBe(false)

  // 表格必须撑满可用宽度，让列均分铺开（而非按内容宽收缩）。
  // 页面上还有维度表，故从矩阵面板根节点内取表，不能直接 querySelector('table')。
  const panel = matrix.parentElement?.parentElement
  const table = panel?.querySelector('table')
  expect(table).toHaveClass('w-full', 'table-fixed')
})

test('marks the failed column as needing error logs when the failure source is not error logs', async () => {
  mockUsage({
    ...USAGE_RESPONSE,
    data_source: {
      error_log_enabled: false,
      failure_source: 'perf_metrics',
      log_rows: 12_480,
    },
  })
  await renderUsage()

  expect(
    screen.getByRole('columnheader', { name: /Requires error logs/ })
  ).toBeVisible()
})

test('leaves the failed column unmarked when the failure source is error logs', async () => {
  mockUsage(USAGE_RESPONSE)
  await renderUsage()

  expect(
    screen.queryByRole('columnheader', { name: /Requires error logs/ })
  ).not.toBeInTheDocument()
})

test('shows the empty state rather than a zeroed table when there is no usage', async () => {
  mockUsage({
    rows: [],
    trend: [],
    totals: { calls: 0, total_tokens: 0, quota: 0, cost_usd: 0 },
  })
  await renderUsage()

  expect(screen.queryByText('Share')).not.toBeInTheDocument()
  expect(screen.getAllByText('No data available').length).toBeGreaterThan(0)
})
