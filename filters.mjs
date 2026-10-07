// Pure filter / facet / grouping logic for the item lists (no DOM), shared by app.js and tests.
export const TIERS = ['S', 'A', 'B', 'C', '-']
export const SLOT_ORDER = [
    'Голова', 'Шея', 'Плечи', 'Спина', 'Грудь', 'Запястья', 'Кисти рук', 'Пояс', 'Ноги', 'Ступни',
    'Палец', 'Аксессуар', 'Двуручное', 'Одноручное', 'Правая рука', 'Левая рука', 'Щит', 'Дальний бой',
]
export const NO_FILTERS = Object.freeze({ q: '', slot: '', stats: [], tiers: [], tierOnly: false, hideGot: false })

// rating = 2 chars: M+ letter, raid letter ('-' = none). Best of both, as in the design handoff.
export const ratingRank = (rating) => Math.min(TIERS.indexOf(rating[0]), TIERS.indexOf(rating[1]))
export const ratingLetter = (rating) => TIERS[ratingRank(rating)]

export const hasActiveFilters = (f) =>
    Boolean(f.q.trim() || f.slot || f.stats.length || f.tiers.length || f.tierOnly || f.hideGot)

// ctx = { items, ratings, got: Set<id>, isList }. `skip` = facet whose own filter is ignored ('slot' | 'tier').
export function passes(id, f, ctx, skip = '') {
    const it = ctx.items[id]
    const q = f.q.trim().toLowerCase()
    if (q && !it.n.toLowerCase().includes(q)) return false
    if (skip !== 'slot' && f.slot && it.sl !== f.slot) return false
    if (f.stats.length && !f.stats.every((s) => it.st.includes(s))) return false
    if (skip !== 'tier' && f.tiers.length && !f.tiers.includes(ratingLetter(ctx.ratings[id]))) return false
    if (f.tierOnly && !it.t) return false
    if (ctx.isList && f.hideGot && ctx.got.has(id)) return false
    return true
}

const bySlotOrder = (slots) => [
    ...SLOT_ORDER.filter((s) => slots.includes(s)),
    ...slots.filter((s) => !SLOT_ORDER.includes(s)),
]

// Facet counts over items passing all *other* filters.
export function facetCounts(base, f, ctx) {
    const tierBase = base.filter((id) => passes(id, f, ctx, 'tier'))
    const tiers = Object.fromEntries(
        TIERS.map((l) => [l, tierBase.filter((id) => ratingLetter(ctx.ratings[id]) === l).length]))
    const slotBase = base.filter((id) => passes(id, f, ctx, 'slot'))
    const counts = new Map()
    for (const id of slotBase) counts.set(ctx.items[id].sl, (counts.get(ctx.items[id].sl) ?? 0) + 1)
    const slots = bySlotOrder([...counts.keys()]).map((s) => [s, counts.get(s)])
    return { tiers, slots, slotTotal: slotBase.length }
}

// [[slot, ids]] in canonical slot order, unknown slots last, empty slots dropped.
export function groupBySlot(ids, items) {
    const slots = bySlotOrder([...new Set(ids.map((id) => items[id].sl))])
    return slots.map((s) => [s, ids.filter((id) => items[id].sl === s)])
}

// Where an item drops, for the meta line when grouped by slot: dungeon, or «Босс · Рейд» if the raid has >1 boss.
export function sourceLabel(item, data) {
    if (item.d) return data.dungeons.find((x) => x.id === item.d)?.ru ?? ''
    for (const raid of data.raids) {
        const boss = raid.bosses.find((b) => b.id === item.b && (item.r === undefined || item.r === raid.id))
        if (boss) return raid.bosses.length > 1 ? `${boss.ru} · ${raid.ru}` : boss.ru
    }
    return ''
}
