import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NO_FILTERS, passes, facetCounts, groupBySlot, sourceLabel, hasActiveFilters } from './filters.mjs'

const items = {
    1: { n: 'Ясный взор', sl: 'Голова', st: ['crit', 'mast'], t: 1, b: 10 },
    2: { n: 'Кольцо алхимика', sl: 'Палец', st: ['crit', 'haste'], d: 100 },
    3: { n: 'Ожерелье', sl: 'Шея', st: ['vers'], d: 100 },
    4: { n: 'Странный предмет', sl: 'Неведомый слот', st: [], b: 20, r: 2 },
}
const ratings = { 1: 'S-', 2: 'A-', 3: '--', 4: 'C-' }
const ctx = (over = {}) => ({ items, ratings, got: new Set(), isList: false, ...over })
const f = (over = {}) => ({ ...NO_FILTERS, ...over })
const ids = ['1', '2', '3', '4']
const filtered = (filters, c = ctx()) => ids.filter((id) => passes(id, filters, c))

test('search is a case-insensitive substring of the name', () => {
    assert.deepEqual(filtered(f({ q: '  КОЛЬЦО ' })), ['2'])
})

test('stats use AND, tiers use the best letter, tierOnly keeps tier pieces', () => {
    assert.deepEqual(filtered(f({ stats: ['crit'] })), ['1', '2'])
    assert.deepEqual(filtered(f({ stats: ['crit', 'haste'] })), ['2'])
    assert.deepEqual(filtered(f({ tiers: ['S', '-'] })), ['1', '3'])
    assert.deepEqual(filtered(f({ tierOnly: true })), ['1'])
})

test('hideGot only applies on the list tab', () => {
    const got = new Set(['2'])
    assert.deepEqual(filtered(f({ hideGot: true }), ctx({ got })), ids)
    assert.deepEqual(filtered(f({ hideGot: true }), ctx({ got, isList: true })), ['1', '3', '4'])
})

test('facet counts ignore their own facet but respect the others', () => {
    const counts = facetCounts(ids, f({ slot: 'Шея', tiers: ['A'] }), ctx())
    // tier counts: slot filter (Шея) applies, tier filter does not
    assert.deepEqual(counts.tiers, { S: 0, A: 0, B: 0, C: 0, '-': 1 })
    // slot counts: tier filter (A) applies, slot filter does not
    assert.deepEqual(counts.slots, [['Палец', 1]])
    assert.equal(counts.slotTotal, 1)
})

test('groupBySlot follows canonical order and puts unknown slots last', () => {
    assert.deepEqual(groupBySlot(['4', '2', '1', '3'], items), [
        ['Голова', ['1']], ['Шея', ['3']], ['Палец', ['2']], ['Неведомый слот', ['4']],
    ])
})

test('sourceLabel: dungeon name, boss · raid for multi-boss raids, boss alone otherwise', () => {
    const data = {
        dungeons: [{ id: 100, ru: 'Алтарь Клыков' }],
        raids: [
            { id: 1, ru: 'Бездна', bosses: [{ id: 10, ru: 'Два Клыка' }, { id: -97, ru: 'Трэш' }] },
            { id: 2, ru: 'Грот', bosses: [{ id: 20, ru: 'Нимрисса' }] },
        ],
    }
    assert.equal(sourceLabel(items[2], data), 'Алтарь Клыков')
    assert.equal(sourceLabel(items[1], data), 'Два Клыка · Бездна')
    assert.equal(sourceLabel(items[4], data), 'Нимрисса')
})

test('hasActiveFilters ignores whitespace-only search', () => {
    assert.equal(hasActiveFilters(f({ q: '   ' })), false)
    assert.equal(hasActiveFilters(f({ hideGot: true })), true)
})
