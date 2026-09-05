import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { apply, syncPriceSources } from './index.js'
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

test('resolves the app-owned OpenCode Go credential for quota refresh', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-cost-meter-go-key-'))
  const previousHome = process.env.DSH_HOME
  const previousFetch = globalThis.fetch
  const cleanups = []
  const handlers = new Map()
  const provided = {}
  const resolvedRefs = []
  process.env.DSH_HOME = root
  mkdirSync(join(root, 'storages', 'cost-meter'), { recursive: true })
  writeFileSync(join(root, 'storages', 'cost-meter', 'models-dev-prices.json'), JSON.stringify({
    version: 1,
    fetchedAt: new Date().toISOString(),
    ignoredTiered: 0,
    models: { 'opencode-go/deepseek-v4-flash': { cacheHit: 0.1, cacheMiss: 1, output: 2 } },
  }))
  globalThis.fetch = async url => {
    assert.match(String(url), /\/usage$/)
    return {
      ok: true,
      status: 200,
      json: async () => ({ usage: {
        rolling: { percent: 12, resetsAt: '2026-09-05T12:00:00Z' },
        weekly: { percent: 34, resetsAt: '2026-09-07T00:00:00Z' },
        monthly: { percent: 56, resetsAt: '2026-10-01T00:00:00Z' },
      } }),
    }
  }
  const ctx = {
    get(key) {
      if (key === 'settings') return {
        get(namespace) {
          if (namespace !== 'llm-pi-ai') return undefined
          return { providers: { 'opencode-go': { apiKeyEnv: 'NEBULAMAT_OPENCODE_GO_API_KEY' } } }
        },
      }
      if (key === 'credentials') return {
        async resolve(ref) {
          resolvedRefs.push(ref)
          return ref === 'NEBULAMAT_OPENCODE_GO_API_KEY' ? { value: 'configured-key' } : undefined
        },
      }
      return undefined
    },
    on(name, handler) { handlers.set(name, handler) },
    effect(factory) { const cleanup = factory(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    inject() {},
    provide(name, service) { provided[name] = service },
    logger: { warn() {} },
  }

  try {
    apply(ctx)
    const service = provided.costMeter
    await service.updateConfig({ goQuota: { enabled: true, display: 'settings' } })
    const result = await service.refreshGoQuota()
    assert.equal(result.ok, true)
    assert.equal(result.state.goQuota.weekly.percent, 34)
    assert.equal(resolvedRefs[0], 'NEBULAMAT_OPENCODE_GO_API_KEY')
    const stream = handlers.get('llm/stream')({
      provider: 'opencode-go',
      model: 'deepseek-v4-flash',
      sessionId: 'session-go',
    }, () => (async function* () {
      yield { type: 'text-delta', text: 'answer' }
      yield { type: 'usage', usage: { inputTokens: 125, outputTokens: 25, cacheReadTokens: 50, cacheWriteTokens: 10 } }
      yield { type: 'finish' }
    })())
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    assert.equal(chunks.length, 3)
    const state = await service.getState()
    assert.equal(state.today.calls, 1)
    assert.equal(state.today.input, 125)
    assert.equal(state.today.output, 25)
    assert.deepEqual(state.today.providers.map(({ id, mode, calls, billedCost }) => ({ id, mode, calls, billedCost })), [
      { id: 'opencode-go', mode: 'subscription', calls: 1, billedCost: 0 },
    ])
    assert.ok(state.today.savings > 0)
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup()
    globalThis.fetch = previousFetch
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(root, { recursive: true, force: true })
  }
})
