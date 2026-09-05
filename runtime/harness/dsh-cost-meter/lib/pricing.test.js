import assert from 'node:assert/strict'
import test from 'node:test'

import { costOf, parseModelsDevPricing } from './pricing.js'

test('parses flat and enveloped Models.dev pricing catalogs', () => {
  const provider = {
    name: 'Example',
    models: {
      'model-a': { cost: { input: 1, output: 4, cache_read: 0.1, cache_write: 1.25 } },
      free: { cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 } },
      unpriced: { cost: null },
    },
  }
  const flat = parseModelsDevPricing({ example: provider })
  const enveloped = parseModelsDevPricing({ providers: { example: provider } })

  assert.deepEqual(flat, enveloped)
  assert.deepEqual(flat.models['example/model-a'], {
    cacheHit: 0.1,
    cacheWrite: 1.25,
    cacheMiss: 1,
    output: 4,
  })
  assert.deepEqual(flat.models['example/free'], {
    cacheHit: 0,
    cacheWrite: 0,
    cacheMiss: 0,
    output: 0,
  })
  assert.equal(flat.models['example/unpriced'], undefined)
})

test('tracks unsupported context tiers without applying them', () => {
  const parsed = parseModelsDevPricing({
    provider: {
      models: {
        model: {
          cost: {
            input: 2,
            output: 8,
            cache_read: 0.2,
            tiers: [{ input: 4, output: 16, tier: { type: 'context', size: 200000 } }],
            context_over_200k: { input: 4, output: 16 },
          },
        },
      },
    },
  })

  assert.equal(parsed.ignoredTiered, 1)
  assert.equal(parsed.models['provider/model'].cacheMiss, 2)
  assert.equal(parsed.models['provider/model'].output, 8)
})

test('prices cache writes independently and falls back to cache-read price', () => {
  const tokens = { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 }
  assert.equal(costOf(tokens, { cacheHit: 0.2, cacheWrite: 1.5, cacheMiss: 2, output: 8 }, 0, {}), 1.7)
  assert.equal(costOf(tokens, { cacheHit: 0.2, cacheMiss: 2, output: 8 }, 0, {}), 0.4)
})
