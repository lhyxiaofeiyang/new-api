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
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { OverviewPage } from '../components/overview-page'
import {
  SUMMARY_RESPONSE,
  SUMMARY_RESPONSE_HEALTH_LANE,
  SUMMARY_RESPONSE_NO_ERROR_LOG,
  SUMMARY_RESPONSE_TOP_LISTS,
} from './fixtures'

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

test('marks request health as needing error logs but still shows the success rate', async () => {
  mockSummary(SUMMARY_RESPONSE_NO_ERROR_LOG)
  await renderOverview()

  // 就地提示：不再有顶部横幅，改为在健康时间线面板头标注"需错误日志"。
  expect(screen.getByText('Requires error logs')).toBeVisible()
  // 关闭错误日志时调用量分桶仍然照常渲染（只是失败分桶恒为 0）。
  expect(screen.getByText('Request Health')).toBeVisible()
  // 成功率由后端从 perf_metrics 派生，与错误日志开关无关，必须照常展示。
  expect(screen.getByText('99.64%')).toBeVisible()
})

test('does not mark request health when error logs are enabled', async () => {
  mockSummary(SUMMARY_RESPONSE)
  await renderOverview()

  expect(screen.queryByText('Requires error logs')).not.toBeInTheDocument()
})

// 口径 v2：失败数在错误日志关闭时是 perf_metrics 估算值，必须在成功率卡片上
// 就地披露，否则用户会把估算值当成准确统计。
test('qualifies the success rate when failures fall back to perf_metrics', async () => {
  mockSummary(SUMMARY_RESPONSE_NO_ERROR_LOG)
  await renderOverview()

  expect(
    screen.getByText(
      /Failures are estimated; enable error logs for exact counts/
    )
  ).toBeVisible()
  // 两个标注互斥：另一态不得同时出现。
  expect(
    screen.queryByText(/Failures counted since error logs were enabled/)
  ).not.toBeInTheDocument()
})

// 错误日志开启时失败是准确值，但历史窗口内失败只从开启时刻起才有记录，
// 因此仍须标注起算点，避免读成「窗口内一直零失败」。
test('qualifies the success rate when failures come from error logs', async () => {
  mockSummary(SUMMARY_RESPONSE)
  await renderOverview()

  expect(
    screen.getByText(/Failures counted since error logs were enabled/)
  ).toBeVisible()
  expect(
    screen.queryByText(
      /Failures are estimated; enable error logs for exact counts/
    )
  ).not.toBeInTheDocument()
})

// 口径 v2：总数与流式数同取自消费日志，旧的「总数来自 perf_metrics」限定语
// 已不成立，必须从卡片上消失（否则在错误日志关闭时会渲染一句假话）。
test('never claims the stream-calls note under scope v2', async () => {
  for (const payload of [SUMMARY_RESPONSE, SUMMARY_RESPONSE_NO_ERROR_LOG]) {
    mockSummary(payload)
    await renderOverview()
    expect(screen.getByText('Requests served as a stream')).toBeVisible()
    expect(
      screen.queryByText(/From consumption logs/)
    ).not.toBeInTheDocument()
    cleanup()
  }
})

// 卡片标题由页面产出，图表 spec 里的同名标题由 lib/charts.ts 产出（见 lib-charts.test.ts）。
// 两处文案必须一致且都是 hour-of-day 表述，故这里锁住用户实际看到的那一处。
test('labels the hourly panel as an hour-of-day distribution', async () => {
  mockSummary(SUMMARY_RESPONSE)
  await renderOverview()

  expect(
    screen.getByText('Hourly distribution (hour of day)')
  ).toBeVisible()
  expect(screen.queryByText('24h Activity Distribution')).not.toBeInTheDocument()
})

/**
 * 排行面板的条目由「令牌/模型/渠道名」标题定位，条宽读标题兄弟节点里的
 * `bg-chart-1` 比例条计算成百分比，不依赖 Tailwind class 快照。
 */
function barWidthPercent(rowLabel: string): number {
  const listItem = screen.getByText(rowLabel).closest('li')
  expect(listItem).not.toBeNull()
  const bar = listItem?.querySelector('.bg-chart-1')
  expect(bar).not.toBeNull()
  return Number.parseFloat((bar as HTMLElement).style.width)
}

/**
 * 健康度车道的柱由 title 定位（title 就是该桶的 calls/failures 文案），
 * 从中读内联高度百分比，不依赖 Tailwind class 快照。
 */
function healthBar(title: string): HTMLElement {
  const bar = document.querySelector(`[title="${title}"]`)
  expect(bar).not.toBeNull()
  return bar as HTMLElement
}

function healthBarHeightPercent(title: string): number {
  return Number.parseFloat(healthBar(title).style.height)
}

describe('request health lane', () => {
  test('keeps a lane slot for idle buckets even though they have no bar', async () => {
    mockSummary(SUMMARY_RESPONSE_HEALTH_LANE)
    await renderOverview()

    // 车道的子节点数必须等于后端返回的桶数：0 调用的桶只把高度压到 0，
    // 不得从数组里过滤掉，否则时间轴横轴会失真。
    const idleBar = healthBar('0 / 0')
    expect(idleBar.style.height).toBe('0%')
    expect(idleBar.parentElement?.children).toHaveLength(5)
  })

  test('scales non-zero bars by the busiest bucket and keeps a 2% floor', async () => {
    mockSummary(SUMMARY_RESPONSE_HEALTH_LANE)
    await renderOverview()

    expect(healthBarHeightPercent('100 / 20')).toBeCloseTo(100, 5)
    expect(healthBarHeightPercent('50 / 1')).toBeCloseTo(50, 5)
    expect(healthBarHeightPercent('25 / 0')).toBeCloseTo(25, 5)
    // 1% 会被 2% 下限抬起来，保证极小值仍可见。
    expect(healthBarHeightPercent('1 / 0')).toBeCloseTo(2, 5)
  })

  test('colours bars by failure rate and keeps the lane height-driven', async () => {
    mockSummary(SUMMARY_RESPONSE_HEALTH_LANE)
    await renderOverview()

    expect(healthBar('100 / 20').className).toContain('bg-destructive/80')
    expect(healthBar('50 / 1').className).toContain('bg-warning/80')
    expect(healthBar('25 / 0').className).toContain('bg-success/70')
    // 高度由容器驱动（车道 h-full 铺满卡片可用高度），柱子自身不再写死固定高度。
    const lane = healthBar('100 / 20').parentElement as HTMLElement
    expect(lane.className).toContain('h-full')
    expect(lane.className).toContain('items-end')
  })

  test('keeps the neutral colour and calls-only title when error logs are off', async () => {
    mockSummary(SUMMARY_RESPONSE_NO_ERROR_LOG)
    await renderOverview()

    // 关闭错误日志时后端不上报失败分桶，必须用中性色而非按失败率着色的"健康"绿。
    const bar = healthBar('120')
    expect(bar.className).toContain('bg-muted-foreground/40')
    expect(bar.style.height).toBe('100%')
  })
})

describe('top list bars', () => {
  test('scales each bar by token volume, not by quota', async () => {
    mockSummary(SUMMARY_RESPONSE_TOP_LISTS)
    await renderOverview()

    // 两行的 quota 都是 100000：按 quota 归一两者条宽必须相同，只有按 token 归一
    // 才会得到 100% 与 50%。因此该断言正是「条不由 quota 决定」的反例——token 高
    // 而 quota 不高的行，条必须仍然满宽。
    expect(barWidthPercent('mac | Hermes | OpenAI')).toBeCloseTo(100, 5)
    expect(barWidthPercent('small-key')).toBeCloseTo(50, 5)
  })
})

describe('top list metric layout', () => {
  test('shows the token total on the title row and the amount on the sub-line', async () => {
    mockSummary(SUMMARY_RESPONSE_TOP_LISTS)
    await renderOverview()

    const item = screen.getByText('mac | Hermes | OpenAI').closest('li')
    expect(item).not.toBeNull()
    const scope = within(item as HTMLElement)

    // 右侧统计位展示 token 总数（带单位）。
    expect(scope.getByText('620K tokens')).toBeVisible()
    // 副行是「调用数 · 金额」：不得再出现 token 数，金额从标题行挪到了这里。
    const subLine = scope.getByText(/calls · /)
    expect(subLine.textContent).not.toContain('620K')
    expect(subLine.textContent).not.toContain('tokens')
  })
})
