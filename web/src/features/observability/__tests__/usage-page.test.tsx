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
