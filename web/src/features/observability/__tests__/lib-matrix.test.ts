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
  formatMatrixCellValue,
  getCellAt,
  getHeatClass,
  HEAT_EMPTY_CLASS,
  indexMatrix,
} from '../lib/matrix'
import type { UsageMatrixData } from '../types'

const MATRIX: UsageMatrixData = {
  x_labels: ['gpt-4o', 'claude'],
  y_labels: ['key-a', 'key-b'],
  cells: [
    { x: 0, y: 0, calls: 100, total_tokens: 0, quota: 0 },
    { x: 1, y: 0, calls: 50, total_tokens: 0, quota: 0 },
    { x: 0, y: 1, calls: 10, total_tokens: 0, quota: 0 },
  ],
}

describe('matrix indexing', () => {
  test('indexes cells by position and tracks the metric maximum', () => {
    const index = indexMatrix(MATRIX, 'calls')
    assert.equal(index.max, 100)
    assert.equal(getCellAt(index, 0, 0)?.calls, 100)
    assert.equal(getCellAt(index, 0, 1)?.calls, 10)
  })

  test('leaves absent combinations undefined rather than inventing a zero cell', () => {
    const index = indexMatrix(MATRIX, 'calls')
    assert.equal(getCellAt(index, 1, 1), undefined)
  })

  test('tolerates a missing matrix payload', () => {
    const index = indexMatrix(undefined, 'calls')
    assert.equal(index.max, 0)
    assert.equal(getCellAt(index, 0, 0), undefined)
  })
})

describe('matrix heat scale', () => {
  test('renders empty and zero cells with the muted token, not the coldest step', () => {
    assert.equal(getHeatClass(0, 100), HEAT_EMPTY_CLASS)
    assert.equal(getHeatClass(10, 0), HEAT_EMPTY_CLASS)
  })

  test('scales intensity with the value and saturates at the maximum', () => {
    const low = getHeatClass(20, 100)
    const high = getHeatClass(100, 100)
    assert.notEqual(low, HEAT_EMPTY_CLASS)
    assert.notEqual(low, high)
    assert.equal(getHeatClass(100, 100), getHeatClass(500, 500))
  })
})

describe('matrix cell labels', () => {
  test('abbreviates calls at and above one thousand', () => {
    assert.equal(formatMatrixCellValue(999, 'calls'), '999')
    assert.equal(formatMatrixCellValue(1500, 'calls'), '1.5K')
  })

  test('uses the million shorthand for large token counts', () => {
    assert.equal(formatMatrixCellValue(2_500_000, 'total_tokens'), '2.50M')
  })

  test('renders an absent cell as blank so the grid stays readable', () => {
    assert.equal(formatMatrixCellValue(0, 'calls'), '')
  })
})
