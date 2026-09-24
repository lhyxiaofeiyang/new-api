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
import { toast } from 'sonner'
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
  // 「总 Token 数」现在既是聚合卡片标题，也是 token 列的列头，故会有多处。
  expect(screen.getAllByText('Total Tokens').length).toBeGreaterThan(1)
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

  // 用用户列点击：API Key / Model / Channel 三列都是 copyable pill，点击会
  // stopPropagation（复制优先），不再触发展开。
  const cell = await screen.findByText('root')
  await user.click(cell)

  expect(await screen.findByText('Billing')).toBeVisible()
  expect(screen.getByText('Cache Ratio')).toBeVisible()
  // "First Byte" is both a column header and a detail label, so it must render twice.
  expect(screen.getAllByText('First Byte')).toHaveLength(2)
})

test('copies from the token pill itself, with no standalone copy button', async () => {
  // userEvent.setup() installs a clipboard stub, so the copy can be read back.
  const user = userEvent.setup()
  mockEndpoints(SUMMARY_RESPONSE)
  await renderMonitoring()

  // A 项：密钥列不再有独立复制按钮（用户反馈它常显、是多余噪音）。
  expect(
    screen.queryByRole('button', { name: /Copy prod-key/ })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /Copy to clipboard/ })
  ).not.toBeInTheDocument()

  // 复制改由 pill 本体承担（与「模型」列一致）。
  const pill = await screen.findByTitle('Click to copy: prod-key')
  await user.click(pill)

  expect(await window.navigator.clipboard.readText()).toBe('prod-key')
  // StatusBadge 在 copyable 时 stopPropagation，故点 pill 不展开行——与模型列同一取舍。
  expect(screen.queryByText('Billing')).not.toBeInTheDocument()
})

test('still expands the row when a non-pill cell is clicked', async () => {
  const user = userEvent.setup()
  mockEndpoints(SUMMARY_RESPONSE)
  await renderMonitoring()

  // A 项的可接受代价是「点 pill 不展开」，但行内其它位置必须仍能展开。
  // 用用户列的名字点击：本行的 model/API Key/Channel 三个 pill 都带 copyable，
  // 都会 stopPropagation，不能用来验证「行列其它位置仍可展开」。
  await user.click(await screen.findByText('root'))

  expect(await screen.findByText('Billing')).toBeVisible()
})

test('warns when the export was truncated by the row cap', async () => {
  const warn = vi.spyOn(toast, 'warning').mockImplementation(() => 'id')
  mockEndpoints(SUMMARY_RESPONSE)
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/observability/requests/export') {
      // 服务端在 CSV 末尾追加的截断标记行（见 controller/observability/monitoring.go）。
      return {
        data: new Blob([
          'id,created_at,request_id\n1,0,req-1\n# truncated: total=120 exported=1\n',
        ]),
      }
    }
    if (url === '/api/observability/requests') {
      return { data: { success: true, data: REQUESTS_RESPONSE } }
    }
    return { data: { success: true, data: SUMMARY_RESPONSE } }
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const user = userEvent.setup()
  await renderMonitoring()

  await user.click(screen.getByRole('button', { name: /Export/ }))
  await user.click(await screen.findByRole('menuitem', { name: 'Export CSV' }))

  await waitFor(() => expect(warn).toHaveBeenCalled())
  expect(warn.mock.calls[0][0]).toBe('Export truncated to 1 of 120 rows')
})

test('stays silent when the export was not truncated', async () => {
  const warn = vi.spyOn(toast, 'warning').mockImplementation(() => 'id')
  mockEndpoints(SUMMARY_RESPONSE)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const user = userEvent.setup()
  await renderMonitoring()

  await user.click(screen.getByRole('button', { name: /Export/ }))
  await user.click(await screen.findByRole('menuitem', { name: 'Export CSV' }))

  // mockEndpoints 的兜底分支返回非 Blob；只要没有截断标记就不该发警告。
  await waitFor(() => expect(api.get).toHaveBeenCalledWith(
    '/api/observability/requests/export',
    expect.anything()
  ))
  expect(warn).not.toHaveBeenCalled()
})

test('warns when a JSON export reports truncation in its payload', async () => {
  const warn = vi.spyOn(toast, 'warning').mockImplementation(() => 'id')
  mockEndpoints(SUMMARY_RESPONSE)
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/observability/requests/export') {
      // JSON 分支读结构化字段（见 service/observability/dto.go 的 ExportRequest），
      // 不再有 CSV 那种尾注标记行。
      return {
        data: new Blob([
          JSON.stringify({
            data: {
              truncated: true,
              total: 120,
              rows: [{ request_id: 'req-1' }],
            },
          }),
        ]),
      }
    }
    if (url === '/api/observability/requests') {
      return { data: { success: true, data: REQUESTS_RESPONSE } }
    }
    return { data: { success: true, data: SUMMARY_RESPONSE } }
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const user = userEvent.setup()
  await renderMonitoring()

  await user.click(screen.getByRole('button', { name: /Export/ }))
  await user.click(await screen.findByRole('menuitem', { name: 'Export JSON' }))

  // exported 取自 rows 长度、total 取自 payload；两者都错时文案不变，故必须同时锁住数字。
  await waitFor(() => expect(warn).toHaveBeenCalled())
  expect(warn.mock.calls[0][0]).toBe('Export truncated to 1 of 120 rows')
})

test('shows the user column and drops the quota column, matching the usage log table', async () => {
  mockEndpoints(SUMMARY_RESPONSE)
  await renderMonitoring()

  // 用户列（后端 users JOIN 提供 username，与「使用日志」同款呈现）
  expect(screen.getByRole('columnheader', { name: 'User' })).toBeVisible()
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
  // 就地提示：状态列头标注该列为何恒为 '-'，去掉顶部横幅后不再另发通知。
  expect(
    screen.getByRole('columnheader', { name: /Requires error logs/ })
  ).toBeVisible()
})

test('annotates the failed-only switch when error logs are disabled', async () => {
  mockEndpoints({
    ...SUMMARY_RESPONSE,
    data_source: {
      error_log_enabled: false,
      failure_source: 'perf_metrics',
      log_rows: 1,
    },
  })
  await renderMonitoring()

  // 「只看失败」无失败数据可筛，开关标签就地标注原因。
  expect(
    await screen.findByText('Failed Only · Requires error logs')
  ).toBeVisible()
})

test('leaves the failed-only switch label plain when error logs are enabled', async () => {
  mockEndpoints(SUMMARY_RESPONSE)
  await renderMonitoring()

  expect(await screen.findByText('Failed Only')).toBeVisible()
  expect(
    screen.queryByText('Failed Only · Requires error logs')
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Requires error logs')).not.toBeInTheDocument()
})
