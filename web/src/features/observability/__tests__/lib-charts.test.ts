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

import type { TFunction } from 'i18next'
import { describe, test } from 'vitest'

import { buildHourlyActivitySpec, getObservabilityChartColors } from '../lib/charts'

const t = ((key: string) => key) as TFunction

// VChart paints to a <canvas>, so CSS variables never resolve; the palette is
// read from VChart's own built-in dataScheme instead. These assertions pin that
// contract: concrete colour strings, distinct per series.
describe('observability chart palette', () => {
  test('returns concrete colour strings, not css variable references', () => {
    const colors = getObservabilityChartColors(4)

    assert.ok(colors.length >= 4)
    for (const color of colors) {
      assert.equal(typeof color, 'string')
      assert.ok(!color.includes('var('))
      assert.match(color, /^#|^rgb/)
    }
  })

  test('assigns a distinct colour to every series in the cost breakdown', () => {
    const colors = getObservabilityChartColors(8)

    assert.equal(new Set(colors.slice(0, 8)).size, 8)
  })

  test('keeps serving colours when the series count exceeds one scheme', () => {
    assert.ok(getObservabilityChartColors(64).length > 0)
  })
})

// 图表在页面测试里被 mock，标题因此只由本函数产出；这条断言是它唯一的守护点。
// 语义：后端按「一天中的第几小时」（0–23）累计，跨区间逐日累加，不是滑动窗口，
// 故标题必须是 hour-of-day 的表述，不能退回旧文案。
describe('observability hourly activity chart', () => {
  test('titles the hourly panel as an hour-of-day distribution', () => {
    const spec = buildHourlyActivitySpec([{ hour: 3, calls: 7 }], t)

    assert.deepEqual(spec.title, {
      visible: true,
      text: 'Hourly distribution (hour of day)',
      subtext: undefined,
    })
  })
})
