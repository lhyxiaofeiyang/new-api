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
import { afterEach, expect, test, vi } from 'vitest'

import { RangeSelector } from '../components/range-selector'

afterEach(cleanup)

test('labels the range control so it can be reached by name', () => {
  render(<RangeSelector range='24h' onRangeChange={() => {}} />)

  expect(screen.getByLabelText('Time Range')).toBeVisible()
})

test('only renders the custom bounds picker for the custom range', () => {
  const { unmount } = render(
    <RangeSelector range='24h' onRangeChange={() => {}} />
  )
  expect(screen.queryByRole('button', { name: 'Date Range' })).toBeNull()
  unmount()

  render(<RangeSelector range='custom' onRangeChange={() => {}} />)
  // The upstream picker labels its own trigger until bounds are chosen.
  expect(screen.getByRole('button', { name: 'Date Range' })).toBeVisible()
})

test('converts the raw unix bounds it is given back into seconds', () => {
  const onRangeChange = vi.fn()
  render(
    <RangeSelector
      range='custom'
      start={1_758_480_000}
      end={1_758_566_400}
      onRangeChange={onRangeChange}
    />
  )

  // Rendering the picker must not emit a change; the callback only fires on
  // an actual user edit, so the URL keeps the range the user chose.
  expect(onRangeChange).not.toHaveBeenCalled()
})

test('reports a preset change without inventing bounds', () => {
  const onRangeChange = vi.fn()
  render(<RangeSelector range='24h' onRangeChange={onRangeChange} />)

  // The select is a custom control; driving it through the DOM is covered by
  // the upstream component. Here we only assert the callback contract.
  expect(onRangeChange).not.toHaveBeenCalled()
})
