import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { syncPriceSources } from './index.js'
import { Ledger, defaultConfig } from './store.js'

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  }
}

function officialHtml(input = 9, output = 12) {
  return `<html><body><table>
    <tr><th>MODEL</th><th>deepseek-v4-flash</th></tr>
    <tr><td>1M INPUT TOKENS (CACHE HIT)</td><td>$0.5</td></tr>
    <tr><td>1M INPUT TOKENS (CACHE MISS)</td><td>$${input}</td></tr>
    <tr><td>1M OUTPUT TOKENS</td><td>$${output}</td></tr>
  </table><!-- ${'fixture padding '.repeat(45)} --></body></html>`
}

test('commits a successful Models.dev sync when the official source fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-cost-meter-sync-'))
  const ledger = new Ledger(defaultConfig(), {}, join(root, 'ledger.json'))
  const fetchImpl = async url => String(url).includes('models.dev')
    ? response(JSON.stringify({ provider: { models: { model: { cost: { input: 1, output: 3 } } } } }))
    : response('', 503)

  try {
    const result = await syncPriceSources(ledger, 'en', fetchImpl)
    assert.equal(result.ok, true)
    assert.equal(ledger.priceCatalogState().modelCount, 1)
    assert.equal(ledger.config.priceSource, 'models.dev')
  } finally {
    ledger.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('keeps the last successful catalog when every source is offline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-cost-meter-offline-'))
  const ledger = new Ledger(defaultConfig(), {}, join(root, 'ledger.json'))
  ledger.replacePriceCatalog({
    'provider/model': { cacheHit: 0.1, cacheMiss: 1, output: 3 },
  }, '2026-08-27T00:00:00.000Z')

  try {
    const result = await syncPriceSources(ledger, 'en', async () => response('', 503))
    assert.equal(result.ok, false)
    assert.equal(ledger.priceCatalogState().modelCount, 1)
    assert.equal(ledger.priceCatalog.models['provider/model'].cacheMiss, 1)
  } finally {
    ledger.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('does not overwrite a manually configured price during official refresh', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-cost-meter-manual-'))
  const config = defaultConfig()
  config.prices.models['deepseek-v4-flash'] = { cacheHit: 2, cacheMiss: 20, output: 30 }
  const ledger = new Ledger(config, {}, join(root, 'ledger.json'))
  const fetchImpl = async url => String(url).includes('models.dev')
    ? response(JSON.stringify({ provider: { models: { model: { cost: { input: 1, output: 3 } } } } }))
    : response(officialHtml())

  try {
    const result = await syncPriceSources(ledger, 'en', fetchImpl)
    assert.equal(result.ok, true)
    assert.deepEqual(ledger.config.prices.models['deepseek-v4-flash'], {
      cacheHit: 2,
      cacheMiss: 20,
      output: 30,
    })
  } finally {
    ledger.close()
    rmSync(root, { recursive: true, force: true })
  }
})
