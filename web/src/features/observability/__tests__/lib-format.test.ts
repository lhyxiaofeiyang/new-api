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

import {
  formatLatencyMs,
  formatShare,
  formatSuccessRate,
  formatTokenCount,
} from '../lib/format'

describe('observability number formatting', () => {
  test('keeps token counts below one thousand verbatim', () => {
    assert.equal(formatTokenCount(0), '0')
    assert.equal(formatTokenCount(999), '999')
  })

  test('abbreviates token counts at and above one thousand', () => {
    assert.equal(formatTokenCount(1000), '1K')
    assert.equal(formatTokenCount(1_500_000), '1.5M')
  })

  test('reports a missing token count as a dash rather than zero', () => {
    assert.equal(formatTokenCount(null), '0')
    assert.equal(formatTokenCount(Number.NaN), '-')
  })

  test('renders latency in milliseconds, promoting long waits to seconds', () => {
    assert.equal(formatLatencyMs(0), '-')
    assert.equal(formatLatencyMs(842.4), '842ms')
    assert.equal(formatLatencyMs(1500), '1.5s')
  })

  test('renders the share ratio as a two-decimal percentage', () => {
    assert.equal(formatShare(0.12345), '12.35%')
    assert.equal(formatShare(0), '0.00%')
  })

  test('renders the success rate already expressed as a percentage', () => {
    assert.equal(formatSuccessRate(99.456), '99.46%')
  })
})
