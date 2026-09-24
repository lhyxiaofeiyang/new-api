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
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, test } from 'vitest'

import { buildNavGroups } from '@/hooks/use-sidebar-data'

import { OBSERVABILITY_SECTIONS, OBSERVABILITY_SECTION_IDS } from '../constants'

const LOCALES_DIR = join(process.cwd(), 'src/i18n/locales')

function readTranslation(locale: string): Record<string, string> {
  const raw = readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8')
  return JSON.parse(raw).translation as Record<string, string>
}

function localeNames(): string[] {
  return readdirSync(LOCALES_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort()
}

describe('observability navigation entry', () => {
  test('exposes exactly the three documented sections', () => {
    assert.deepEqual(
      OBSERVABILITY_SECTIONS.map((section) => section.id),
      ['overview', 'monitoring', 'usage']
    )
    assert.deepEqual(
      [...OBSERVABILITY_SECTION_IDS],
      ['overview', 'monitoring', 'usage']
    )
  })

  test('places the observability group immediately after general', () => {
    const groups = buildNavGroups((key) => key).navGroups
    const ids = groups.map((group) => group.id)
    assert.equal(ids.includes('general'), true)
    assert.equal(ids[ids.indexOf('general') + 1], 'observability')
  })

  test('points each sidebar item at the matching section url', () => {
    const groups = buildNavGroups((key) => key).navGroups
    const observability = groups.find((group) => group.id === 'observability')
    assert.ok(observability, 'observability group is missing')
    const urls = new Set(observability.items.map((item) => item.url))
    for (const section of OBSERVABILITY_SECTIONS) {
      assert.equal(
        urls.has(`/observability/${section.id}`),
        true,
        `${section.id} has no sidebar url`
      )
    }
  })
})

describe('observability locale coverage', () => {
  const required = [
    'Observability',
    'Request Monitoring',
    'Usage Analytics',
    'Last 24 Hours',
    'Last 7 Days',
    'Last 30 Days',
    'Hourly',
    'Daily',
    'Auto Refresh (30s)',
    'Calls',
    'Failed',
    'Export CSV',
    'Export JSON',
    'Rows per page',
    'Usage Matrix',
    'Cost Composition',
    'Traffic Trend',
    '{{count}} rows',
    '{{tokens}} tokens',
    '{{calls}} calls · {{amount}}',
    'Failures counted since error logs were enabled',
    'Failures are estimated; enable error logs for exact counts',
    '{{y}} × {{x}} · cells show {{metric}}',
  ]

  test('ships every observability key in every locale file', () => {
    const locales = localeNames()
    assert.ok(
      locales.length >= 7,
      `expected at least 7 locales, got ${locales.length}`
    )
    for (const locale of locales) {
      const translation = readTranslation(locale)
      const missing = required.filter((key) => !(key in translation))
      assert.deepEqual(missing, [], `${locale}.json is missing keys`)
    }
  })

  test('translates the observability keys rather than reusing the English text', () => {
    for (const locale of ['zh', 'zh-TW', 'ja', 'ru']) {
      const translation = readTranslation(locale)
      assert.notEqual(translation['Usage Analytics'], 'Usage Analytics', locale)
      assert.notEqual(
        translation['Cost Composition'],
        'Cost Composition',
        locale
      )
    }
  })

  test('keeps the interpolation placeholders intact in every translation', () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()
    for (const locale of localeNames()) {
      const translation = readTranslation(locale)
      for (const key of required.filter((k) => k.includes('{{'))) {
        assert.deepEqual(
          placeholders(translation[key]),
          placeholders(key),
          `${locale}.json changed the placeholders of ${key}`
        )
      }
    }
  })
})
