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
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { OverviewPage } from '../components/overview-page'
import { SUMMARY_RESPONSE, SUMMARY_RESPONSE_NO_ERROR_LOG } from './fixtures'

// VChart needs a real canvas, which jsdom does not provide. The chart panel is
// a third-party integration boundary, so it is stubbed and the assertions stay
// on the data the page derives from the summary payload.
vi.mock('../components/chart-panel', () => ({
  ChartPanel: (props: { title: string }) => (
    <div data-testid='chart-panel'>{props.title}</div>
  ),
}))
function mockSummary(payload: unknown) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/observability/summary') {
      return { data: { success: true, data: payload } }
    }
    return { data: { success: true, data: {} } }
  })
}

async function renderOverview() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <OverviewPage search={{}} onSearchChange={() => {}} />
    </QueryClientProvider>
  )
  await waitFor(() => expect(client.isFetching()).toBe(0))
  return client
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test('renders the totals from the summary payload', async () => {
  mockSummary(SUMMARY_RESPONSE)
  await renderOverview()

  expect(screen.getByText('Total Calls')).toBeVisible()
  expect(screen.getByText('8,420')).toBeVisible()
  expect(screen.getByText('Success Rate')).toBeVisible()
})

test('warns and withholds failure numbers when error logs are disabled', async () => {
  mockSummary(SUMMARY_RESPONSE_NO_ERROR_LOG)
  await renderOverview()

  expect(screen.getByText('Failure details are unavailable')).toBeVisible()
  expect(
    screen.getByText(
      'Error logs are disabled on this instance, so failure counts, the success rate and the request health timeline show no data.'
    )
  ).toBeVisible()
  expect(screen.queryByText('100.00%')).not.toBeInTheDocument()
})

test('does not warn when error logs are enabled', async () => {
  mockSummary(SUMMARY_RESPONSE)
  await renderOverview()

  expect(
    screen.queryByText('Failure details are unavailable')
  ).not.toBeInTheDocument()
})
