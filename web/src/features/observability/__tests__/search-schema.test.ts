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

import { observabilitySearchSchema } from '../lib/search'

describe('observability url search schema', () => {
  test('accepts an empty search so the pages open on their defaults', () => {
    assert.deepEqual(observabilitySearchSchema.parse({}), {})
  })

  test('keeps every documented filter', () => {
    const search = {
      range: '7d',
      start: 10,
      end: 20,
      autoRefresh: true,
      page: 3,
      pageSize: 100,
      tokenId: 7,
      channelId: 3,
      channelType: 1,
      model: 'gpt-4o',
      group: 'default',
      isStream: true,
      onlyFailed: true,
      keyword: 'abc',
      sort: 'quota',
      order: 'asc',
      dimension: 'channel',
      granularity: 'hour',
      matrix: 'channel_model',
    } as const
    assert.deepEqual(observabilitySearchSchema.parse(search), search)
  })

  test('drops a value outside the allowed set instead of throwing', () => {
    const parsed = observabilitySearchSchema.parse({ range: 'nope' })
    assert.equal(parsed.range, undefined)
  })

  test('falls back to the first page for an unusable page number', () => {
    assert.equal(observabilitySearchSchema.parse({ page: 0 }).page, 1)
    assert.equal(observabilitySearchSchema.parse({ page: -2 }).page, 1)
  })

  test('drops a non-numeric bound on a custom range', () => {
    assert.equal(
      observabilitySearchSchema.parse({ start: 'abc' }).start,
      undefined
    )
  })
})
