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
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { RangeSelector } from '../components/range-selector'

afterEach(cleanup)

test('translates the unix bounds it is given into a local label', async () => {
  const onRangeChange = vi.fn()
  render(
    <RangeSelector
      range='custom'
      start={1_758_480_000}
      end={1_758_566_400}
      onRangeChange={onRangeChange}
    />
  )

  // 渲染既有的自定义区间不得回调：回调只在用户真正编辑时触发，
  // 否则 URL 里的区间会被重新写回。
  expect(onRangeChange).not.toHaveBeenCalled()

  // 触发器要把秒级 unix 时间戳渲染成本地时间标签，证明 start/end 确实被用上。
  const expectedStart = new Date(1_758_480_000 * 1000)
  const expectedEnd = new Date(1_758_566_400 * 1000)
  expect(
    screen.getByRole('button', {
      name: new RegExp(
        `${expectedStart.getFullYear()}-\\d{2}-\\d{2} \\d{2}:\\d{2}.*` +
          `${expectedEnd.getFullYear()}-\\d{2}-\\d{2} \\d{2}:\\d{2}`
      ),
    })
  ).toBeVisible()
})

test('reports the preset the user picked', async () => {
  const onRangeChange = vi.fn()
  const user = userEvent.setup()
  render(<RangeSelector range='24h' onRangeChange={onRangeChange} />)

  await user.click(screen.getByLabelText('Time Range'))
  await user.click(await screen.findByRole('option', { name: 'Last 7 Days' }))

  expect(onRangeChange).toHaveBeenCalledWith('7d')
})

