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
import type {
  ObservabilityRequestsResponse,
  ObservabilitySummaryResponse,
  ObservabilityUsageResponse,
} from '../types'

/** Response shapes copied from the contract's example payloads. */

export const SUMMARY_RESPONSE: ObservabilitySummaryResponse = {
  range: { start: 1_758_480_000, end: 1_758_566_400, range: '24h' },
  data_source: {
    error_log_enabled: true,
    failure_source: 'error_log',
    log_rows: 12_480,
  },
  summary: {
    total_calls: 8_420,
    success_calls: 8_390,
    failure_calls: 30,
    success_rate: 99.64,
    prompt_tokens: 1_240_000,
    completion_tokens: 386_000,
    cached_tokens: 92_000,
    total_tokens: 1_626_000,
    total_quota: 5_000_000,
    total_cost_usd: 10,
    average_latency_ms: 842.4,
    average_ttft_ms: 214.8,
    stream_calls: 6_100,
    unique_tokens: 42,
    unique_channels: 7,
    unique_models: 11,
  },
  rolling: { rpm: 12.4, tpm: 3_180 },
  top_models: [
    {
      model_name: 'gpt-4o',
      calls: 3_200,
      total_tokens: 620_000,
      quota: 1_800_000,
    },
  ],
  top_tokens: [
    {
      token_id: 7,
      token_name: 'prod-key',
      calls: 2_100,
      total_tokens: 410_000,
      quota: 900_000,
    },
  ],
  top_channels: [
    {
      channel_id: 3,
      channel_name: 'primary',
      calls: 4_000,
      total_tokens: 800_000,
      quota: 2_400_000,
    },
  ],
  traffic: [
    {
      ts: 1_758_480_000,
      calls: 120,
      prompt_tokens: 18_000,
      completion_tokens: 6_000,
      quota: 90_000,
    },
  ],
  hourly_activity: [{ hour: 13, calls: 640 }],
  health_timeline: [{ ts: 1_758_480_000, calls: 120, failures: 1 }],
}

export const REQUESTS_RESPONSE: ObservabilityRequestsResponse = {
  items: [
    {
      id: 1,
      created_at: 1_758_480_000,
      request_id: 'req-1',
      token_id: 7,
      token_name: 'prod-key',
      channel_id: 3,
      channel_name: 'primary',
      channel_type: 1,
      model_name: 'gpt-4o',
      group: 'default',
      user_id: 1,
      username: 'root',
      quota: 90_000,
      prompt_tokens: 18_000,
      completion_tokens: 6_000,
      total_tokens: 24_000,
      cached_tokens: 2_000,
      cache_ratio: 0.0833,
      use_time_ms: 842.4,
      ttft_ms: 214.8,
      is_stream: true,
      retry_chain: [
        { index: 0, channel_id: 3, elapsed_ms: 120, action: 'retry' },
      ],
      is_failed: false,
      fail_status_code: null,
      fail_summary: null,
    },
  ],
  total: 8_420,
  page: 1,
  page_size: 20,
  aggregate: {
    calls: 8_420,
    total_tokens: 1_626_000,
    quota: 5_000_000,
    average_latency_ms: 842.4,
  },
}

export const USAGE_RESPONSE: ObservabilityUsageResponse = {
  rows: [
    {
      key: '7',
      label: 'prod-key',
      calls: 2_100,
      success_calls: 2_090,
      failure_calls: 10,
      prompt_tokens: 310_000,
      completion_tokens: 100_000,
      cached_tokens: 20_000,
      total_tokens: 410_000,
      quota: 900_000,
      cost_usd: 1.8,
      average_latency_ms: 798.2,
      average_ttft_ms: 200.1,
      share: 0.2493,
    },
  ],
  trend: [
    {
      ts: 1_758_480_000,
      calls: 120,
      total_tokens: 24_000,
      quota: 90_000,
      failure_calls: 1,
    },
  ],
  matrix: {
    x_labels: ['gpt-4o', 'claude'],
    y_labels: ['prod-key', 'dev-key'],
    cells: [
      { x: 0, y: 0, calls: 100, total_tokens: 20_000, quota: 80_000 },
      { x: 1, y: 0, calls: 50, total_tokens: 10_000, quota: 40_000 },
    ],
  },
  totals: {
    calls: 8_420,
    total_tokens: 1_626_000,
    quota: 5_000_000,
    cost_usd: 10,
  },
  // 真实接口必返回 data_source（usage_service 会带上错误日志开关），夹具补全它，
  // 否则前端拿不到开关状态，会按"未开启"渲染就地提示。
  data_source: {
    error_log_enabled: true,
    failure_source: 'error_log',
    log_rows: 12_480,
  },
}

/** The same summary with error logs switched off on the instance. */
/**
 * 错误日志关闭时的响应：后端把总调用/成功/失败/成功率整体改用 perf_metrics
 * 派生，所以这些字段照常有值——只有「逐条失败明细」需要错误日志。
 */
export const SUMMARY_RESPONSE_NO_ERROR_LOG: ObservabilitySummaryResponse = {
  ...SUMMARY_RESPONSE,
  data_source: {
    error_log_enabled: false,
    failure_source: 'perf_metrics',
    log_rows: 12_480,
  },
  // 关闭错误日志时后端照常上报调用分桶，但失败分桶恒为 0。
  health_timeline: [{ ts: 1_758_480_000, calls: 120, failures: 0 }],
}

/**
 * 「请求健康度」车道的边界夹具（错误日志开启：标题为 calls/failures，按失败率着色）。
 * 5 个桶覆盖四种归一/着色分支——
 * - calls 100/failures 20（失败率 20% → 判红）同时是最大桶，归一 100%；
 * - calls 50/failures 1（失败率 2% → 警告色），归一 50%；
 * - calls 25/failures 0（健康色），归一 25%；
 * - calls 0：高度必须为 0 但仍占位（不得被过滤，否则时间轴失真）；
 * - calls 1：归一仅 1%，必须被 2% 下限抬到可见。
 */
export const SUMMARY_RESPONSE_HEALTH_LANE: ObservabilitySummaryResponse = {
  ...SUMMARY_RESPONSE,
  data_source: {
    error_log_enabled: true,
    failure_source: 'error_log',
    log_rows: 12_480,
  },
  health_timeline: [
    { ts: 1_758_480_000, calls: 100, failures: 20 },
    { ts: 1_758_480_600, calls: 50, failures: 1 },
    { ts: 1_758_481_200, calls: 25, failures: 0 },
    { ts: 1_758_481_800, calls: 0, failures: 0 },
    { ts: 1_758_482_400, calls: 1, failures: 0 },
  ],
}

/**
 * Top 榜的边界夹具（与上面的主夹具相互独立，只覆盖排行面板关心的约束）：
 * - mac | Hermes | OpenAI / small-key 的 quota 都是 100000、token 数却是
 *   620000 / 310000，用来把「条宽按 token 归一」与「按 quota 归一」区分开；
 * - token_id=4 曾是同名分裂行的受害者，这里给出后端修复后的形状（同一 token_id
 *   一行、名字为 tokens 表的当前名、calls/tokens 为合并值）。「改名不得再拆行」
 *   由 service/observability 的单测钉住；前端只负责按 payload 渲染，不做合并，
 *   因此这里不伪造修复前的分裂 payload。
 */
export const SUMMARY_RESPONSE_TOP_LISTS: ObservabilitySummaryResponse = {
  range: { start: 1_758_480_000, end: 1_758_566_400, range: '24h' },
  data_source: {
    error_log_enabled: false,
    failure_source: 'perf_metrics',
    log_rows: 2_019,
  },
  summary: {
    ...SUMMARY_RESPONSE.summary,
    total_calls: 2_019,
    success_calls: 2_010,
    failure_calls: 9,
    success_rate: 99.55,
    prompt_tokens: 600_000,
    completion_tokens: 330_000,
    total_tokens: 930_000,
    total_quota: 200_000,
  },
  rolling: { rpm: 0, tpm: 0 },
  top_models: [],
  top_tokens: [
    {
      token_id: 4,
      token_name: 'mac | Hermes | OpenAI',
      calls: 1_719,
      total_tokens: 620_000,
      quota: 100_000,
    },
    {
      token_id: 9,
      token_name: 'small-key',
      calls: 300,
      total_tokens: 310_000,
      quota: 100_000,
    },
  ],
  top_channels: [],
  traffic: [],
  hourly_activity: [],
  health_timeline: [],
}
