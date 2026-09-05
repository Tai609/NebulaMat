import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { Ledger, applyConfigPatch, defaultConfig, providerModeFor } from './store.js'

function usage(cost = 2) {
  return {
    date: '2026-08-27',
    input: 1_000_000,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    calls: 1,
    cost,
    sessions: [],
  }
}

test('separates usage charges from subscription value', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-cost-meter-'))
  const config = defaultConfig()
  config.peakEnabled = false
  config.prices.models = {
    'deepseek-chat': { cacheHit: 1, cacheMiss: 2, output: 3 },
    'glm-5.3-flash': { cacheHit: 1, cacheMiss: 2, output: 3 },
  }
  const ledger = new Ledger(config, {}, join(root, 'ledger.json'))

  try {
    ledger.account(
      { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      'deepseek/deepseek-chat',
      'session-1',
      Date.now(),
      { provider: 'deepseek', model: 'deepseek-chat' },
    )
    ledger.account(
      { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      'opencode-go/glm-5.3-flash',
      'session-1',
      Date.now(),
      { provider: 'opencode-go', model: 'glm-5.3-flash' },
    )

    const total = ledger.sumDays()
    assert.equal(total.cost, 4)
    assert.equal(total.billedCost, 2)
    assert.equal(total.savings, 2)
    assert.deepEqual(total.providers.map(({ id, mode, cost, billedCost, savings }) => ({
      id,
      mode,
      cost,
      billedCost,
      savings,
    })), [
      { id: 'deepseek', mode: 'usage', cost: 2, billedCost: 2, savings: 0 },
      { id: 'opencode-go', mode: 'subscription', cost: 2, billedCost: 0, savings: 2 },
    ])
    assert.deepEqual(total.models.map(({ id }) => id), [
      'deepseek/deepseek-chat',
      'opencode-go/glm-5.3-flash',
    ])
  } finally {
    ledger.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('preserves legacy costs and prefers exact provider modes over globs', () => {
  const legacy = usage(3)
  const ledger = new Ledger(defaultConfig(), { [legacy.date]: legacy }, 'unused-ledger.json')

  assert.equal(ledger.copyDay(legacy).billedCost, 3)
  assert.equal(ledger.copyDay(legacy).savings, 0)
  assert.equal(ledger.sumDays().billedCost, 3)
  assert.equal(providerModeFor('local-gpu', { 'local*': 'local' }), 'local')
  assert.equal(providerModeFor('local-gpu', { 'local*': 'local', 'local-gpu': 'usage' }), 'usage')
})

test('replaces editable maps so removed rules and prices stay removed', () => {
  const current = defaultConfig()
  current.providerModes = { 'opencode-go': 'subscription', 'old-provider': 'free' }
  current.prices.models = {
    keep: { cacheHit: 1, cacheMiss: 2, output: 3 },
    remove: { cacheHit: 4, cacheMiss: 5, output: 6 },
  }

  const providerResult = applyConfigPatch(current, {
    providerModes: { 'opencode-go': 'subscription' },
  })
  assert.deepEqual(providerResult.errors, [])
  assert.deepEqual(providerResult.config.providerModes, { 'opencode-go': 'subscription' })

  const priceResult = applyConfigPatch(current, {
    prices: {
      models: { keep: current.prices.models.keep },
      default: current.prices.default,
    },
  })
  assert.deepEqual(priceResult.errors, [])
  assert.deepEqual(Object.keys(priceResult.config.prices.models), ['keep'])

  assert.notEqual(applyConfigPatch(current, { providerModes: [] }).errors.length, 0)
})

test('uses exact provider catalog prices and lets configured prices override them', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-cost-meter-catalog-'))
  const config = defaultConfig()
  config.peakEnabled = false
  config.prices.models = {}
  const ledger = new Ledger(config, {}, join(root, 'ledger.json'))

  try {
    ledger.replacePriceCatalog({
      'zhipuai/glm-5': { cacheHit: 0.2, cacheWrite: 0, cacheMiss: 1, output: 3.2 },
      'zai/glm-5': { cacheHit: 0.3, cacheMiss: 2, output: 4 },
    }, '2026-08-27T00:00:00.000Z')
    ledger.account(
      { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      'zhipuai/glm-5',
      'session-1',
      Date.now(),
      { provider: 'zhipuai', model: 'glm-5' },
    )
    config.prices.models['zai/glm-5'] = { cacheHit: 0, cacheMiss: 7, output: 9 }
    ledger.account(
      { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      'zai/glm-5',
      'session-1',
      Date.now(),
      { provider: 'zai', model: 'glm-5' },
    )

    assert.equal(ledger.sumDays().cost, 8)
    assert.deepEqual(ledger.priceCatalogState().used.map(row => row.id), ['zhipuai/glm-5'])
  } finally {
    ledger.close()
    rmSync(root, { recursive: true, force: true })
  }
})
