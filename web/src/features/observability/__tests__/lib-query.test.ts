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
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { USAGE_DIMENSION_LIMIT } from '../constants'
import {
  buildDrillDownSearch,
  DEFAULT_REQUEST_SORT,
  DEFAULT_SORT_ORDER,
  formatBucketLabel,
  isUsageMatrix,
  resolveTimeRange,
  toRequestsParams,
  toUsageParams,
} from '../lib/query'

describe('observability time range resolution', () => {
  test('falls back to the page default when the url carries no range', () => {
    assert.deepEqual(resolveTimeRange({}, '24h'), { range: '24h' })
  })

  test('prefers the url range over the page default', () => {
    assert.deepEqual(resolveTimeRange({ range: '7d' }, '24h'), { range: '7d' })
  })

  test('passes explicit bounds through for a complete custom range', () => {
    assert.deepEqual(
      resolveTimeRange({ range: 'custom', start: 10, end: 20 }, '24h'),
      { range: 'custom', start: 10, end: 20 }
    )
  })

  test('refuses to send a half-specified custom range', () => {
    assert.deepEqual(resolveTimeRange({ range: 'custom', start: 10 }, '24h'), {
      range: '24h',
    })
    assert.deepEqual(resolveTimeRange({ range: 'custom', end: 10 }, '24h'), {
      range: '24h',
    })
  })
})

describe('observability request params', () => {
  test('applies the documented defaults', () => {
    const params = toRequestsParams({})
    assert.equal(params.page, 1)
    assert.equal(params.sort, DEFAULT_REQUEST_SORT)
    assert.equal(params.order, DEFAULT_SORT_ORDER)
    assert.equal(params.range, '24h')
  })

  test('omits empty filters so the query key stays stable', () => {
    const params = toRequestsParams({ keyword: '', model: '' })
    assert.equal(params.keyword, undefined)
    assert.equal(params.model_name, undefined)
  })

  test('maps url keys onto the contract snake_case params', () => {
    const params = toRequestsParams({
      tokenId: 3,
      channelId: 9,
      channelType: 1,
      model: 'gpt-4o',
      group: 'default',
      isStream: true,
      onlyFailed: true,
      keyword: 'abc',
      page: 4,
      pageSize: 100,
    })
    assert.deepEqual(
      {
        token_id: params.token_id,
        channel_id: params.channel_id,
        channel_type: params.channel_type,
        model_name: params.model_name,
        group: params.group,
        is_stream: params.is_stream,
        only_failed: params.only_failed,
        keyword: params.keyword,
        page: params.page,
        page_size: params.page_size,
      },
      {
        token_id: 3,
        channel_id: 9,
        channel_type: 1,
        model_name: 'gpt-4o',
        group: 'default',
        is_stream: true,
        only_failed: true,
        keyword: 'abc',
        page: 4,
        page_size: 100,
      }
    )
  })
})

describe('observability usage params', () => {
  test('defaults to the seven day window and the cap the contract allows', () => {
    const params = toUsageParams({})
    assert.equal(params.range, '7d')
    assert.equal(params.dimension, 'token')
    assert.equal(params.granularity, 'day')
    assert.equal(params.limit, USAGE_DIMENSION_LIMIT)
  })

  test('passes an explicit matrix selector through', () => {
    assert.equal(
      toUsageParams({ matrix: 'channel_model' }).matrix,
      'channel_model'
    )
  })
})

describe('observability bucket labels', () => {
  test('renders hourly buckets with the hour and daily buckets without it', () => {
    const ts = Math.floor(new Date('2026-09-22T13:00:00').getTime() / 1000)
    assert.equal(formatBucketLabel(ts, 'hour'), '09-22 13:00')
    assert.equal(formatBucketLabel(ts, 'day'), '09-22')
  })
})

describe('usage matrix guard', () => {
  test('accepts only the three contract selectors', () => {
    assert.equal(isUsageMatrix('token_model'), true)
    assert.equal(isUsageMatrix('channel_model'), true)
    assert.equal(isUsageMatrix('channel_type_model'), true)
    assert.equal(isUsageMatrix('token'), false)
    assert.equal(isUsageMatrix(undefined), false)
  })
})

describe('usage drill down', () => {
  test('maps id-backed dimensions onto their numeric filter', () => {
    assert.deepEqual(buildDrillDownSearch('token', '42'), { tokenId: 42 })
    assert.deepEqual(buildDrillDownSearch('channel', '7'), { channelId: 7 })
    assert.deepEqual(buildDrillDownSearch('channel_type', '3'), {
      channelType: 3,
    })
  })

  test('maps name-backed dimensions onto their string filter', () => {
    assert.deepEqual(buildDrillDownSearch('model', 'gpt-4o'), {
      model: 'gpt-4o',
    })
    assert.deepEqual(buildDrillDownSearch('group', 'default'), {
      group: 'default',
    })
  })

  test('drops a non-numeric id instead of sending NaN', () => {
    assert.deepEqual(buildDrillDownSearch('token', 'not-a-number'), {})
  })
})
