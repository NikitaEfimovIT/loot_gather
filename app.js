// Loot Gather frontend: «Весь лут» (#/<spec>) and «Мой лист» (#/<spec>/list) tabs over data.json.
import {
    TIERS, NO_FILTERS, ratingRank, passes, facetCounts, groupBySlot, sourceLabel, hasActiveFilters,
} from './filters.mjs'

const ICON_DIR = 'icons/' // self-hosted by build.mjs (wow.zamimg.com is blocked in RU)
const ITEM_URL = 'https://www.wowhead.com/ru/item='
const ROUTE = /^#\/(\d+)(\/list)?(?:\?i=([\d,]{1,4000}))?$/
// '-' = not among murlok's top-5 per slot (M+) or worn by nobody in top parses (raid)
const TIER_HINT = { S: '≥ 50%', A: '≥ 25%', B: '≥ 10%', C: '< 10%', '-': 'редко или не используют' }
const STATS = { crit: 'Крит', haste: 'Скорость', mast: 'Искусность', vers: 'Универсальность' }
const LAST_SPEC_KEY = 'lg:spec'
const GROUP_KEY = 'lg:groupBy'
const TOAST_MS = 2200

// lucide icons (same paths as lucide-react in Raidsmith), inline so there is no CDN dependency
const lucide = (paths, size = 16) =>
    `<svg class="inline-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths
        .map((d) => `<path d="${d}"/>`)
        .join('')}</svg>`
const ICON = {
    plus: lucide(['M5 12h14', 'M12 5v14'], 18),
    check: lucide(['M20 6 9 17l-5-5'], 18),
    chevron: lucide(['m6 9 6 6 6-6']),
    next: lucide(['M5 12h14', 'm12 5 7 7-7 7']),
    link: lucide([
        'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
        'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
    ]),
    reset: lucide(['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5']),
}

const $ = (sel) => document.querySelector(sel)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const iconSrc = (name) => (/^[\w-]+$/.test(name) ? `${ICON_DIR}${name}.jpg` : '')

let data
let filters = { ...NO_FILTERS }
let groupBy = 'source'
let isPickerOpen = false
let toastTimer

// ---------- storage: lg:<spec> = { sel: [itemId], got: [itemId] } ----------
function readStore(key) {
    try {
        return localStorage.getItem(key)
    } catch (err) {
        console.warn('localStorage read failed', err)
        return null
    }
}

function writeStore(key, value) {
    try {
        localStorage.setItem(key, value)
    } catch (err) {
        console.warn('localStorage write failed', err)
        toast('Не удалось сохранить: браузер блокирует хранилище сайта')
    }
}

function loadState(spec) {
    const known = (arr) => (Array.isArray(arr) ? arr.map(String).filter((id) => id in data.specs[spec]) : [])
    try {
        const raw = JSON.parse(readStore(`lg:${spec}`) ?? '{}')
        return { sel: known(raw.sel), got: known(raw.got) }
    } catch (err) {
        console.warn('corrupt saved list, starting fresh', err)
        return { sel: [], got: [] }
    }
}

const saveState = (spec, s) => writeStore(`lg:${spec}`, JSON.stringify({ ...s, got: s.got.filter((x) => s.sel.includes(x)) }))
const toggle = (list, id, on) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id))

// ---------- routing ----------
function parseRoute() {
    const m = location.hash.match(ROUTE)
    if (!m || !data.specs[m[1]]) return null
    return { spec: m[1], isList: Boolean(m[2]), shared: m[3] }
}

function defaultSpec() {
    const last = readStore(LAST_SPEC_KEY)
    return last && data.specs[last] ? last : String(data.classes[0].specs[0].id)
}

// Shared link → replaces the local list, but never silently: stale links are ignored, a different list asks first.
function importShared(spec, csv) {
    const sel = [...new Set(csv.split(','))].filter((id) => id in data.specs[spec])
    const current = loadState(spec)
    const isSame = sel.length === current.sel.length && sel.every((id) => current.sel.includes(id))
    if (!sel.length) return toast('Ссылка устарела: предметов из неё больше нет в данных сезона')
    if (isSame) return
    const ask = `Заменить ваш текущий лист (${current.sel.length} предм.) листом из ссылки (${sel.length} предм.)?`
    if (current.sel.length && !window.confirm(ask)) return
    saveState(spec, { sel, got: current.got })
}

function route() {
    const r = parseRoute()
    if (!r) return location.replace(`#/${defaultSpec()}`)
    if (r.shared) {
        importShared(r.spec, r.shared)
        return location.replace(`#/${r.spec}/list`)
    }
    writeStore(LAST_SPEC_KEY, r.spec)
    setPicker(false)
    render()
}

// ---------- model ----------
function model() {
    const r = parseRoute()
    const state = loadState(r.spec)
    const ratings = data.specs[r.spec]
    const ctx = { items: data.items, ratings, got: new Set(state.got), isList: r.isList }
    const base = r.isList ? state.sel : Object.keys(ratings)
    const cls = data.classes.find((c) => c.specs.some((s) => String(s.id) === r.spec))
    const spec = cls.specs.find((s) => String(s.id) === r.spec)
    return { ...r, state, ratings, ctx, base, cls, specInfo: spec, sel: new Set(state.sel), ids: base.filter((id) => passes(id, filters, ctx)) }
}

// ponytail: full re-render on every change (≈100 rows, cheap); keyboard focus is restored by data-key.
// Upgrade path if it ever lags: patch the toggled row + counters instead.
function render() {
    const focusKey = document.activeElement?.dataset?.key
    const m = model()
    $('#picker-btn').innerHTML = pickerButton(m)
    $('#picker-btn').setAttribute('aria-label', `Специализация: ${m.cls.ru}, ${m.specInfo.ru}. Изменить`)
    $('#picker-pop').innerHTML = isPickerOpen ? pickerPopover(m) : ''
    $('#tabs').innerHTML = tabs(m)
    $('#facets').innerHTML = facets(m)
    $('#view').className = `view ${m.isList ? 'list' : 'summary'}`
    $('#view').innerHTML = main(m)
    $('#bar').innerHTML = bar(m)
    if (focusKey) document.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus()
}

// ---------- header: spec picker + tabs ----------
function pickerButton(m) {
    return `<span class="picker__icons">
            <img class="picker__class-icon" src="${iconSrc(m.cls.ic)}" width="40" height="40" alt="">
            <img class="picker__spec-icon" src="${iconSrc(m.specInfo.ic)}" width="22" height="22" alt="" data-fallback="${iconSrc(m.cls.ic)}">
        </span>
        <span class="picker__text"><span class="picker__class">${esc(m.cls.ru)}</span><span class="picker__spec">${esc(m.specInfo.ru)}</span></span>
        <span class="picker__chevron">${ICON.chevron}</span>`
}

function pickerPopover(m) {
    const rows = data.classes.map((c) => {
        const specs = c.specs.map((s) => {
            const isCurrent = String(s.id) === m.spec
            return `<button type="button" class="picker__spec-btn" aria-current="${isCurrent}" data-spec="${s.id}" data-key="spec:${s.id}">
                <img src="${iconSrc(s.ic)}" width="26" height="26" alt="" data-fallback="${iconSrc(c.ic)}">${esc(s.ru)}</button>`
        })
        return `<div class="picker__row${c.id === m.cls.id ? ' picker__row--current' : ''}">
            <span class="picker__row-class"><img src="${iconSrc(c.ic)}" width="28" height="28" alt="">${esc(c.ru)}</span>
            <span class="picker__specs">${specs.join('')}</span></div>`
    })
    return `<div class="picker__backdrop" data-close></div>
        <div class="picker__pop" role="dialog" aria-label="Выбор класса и специализации">${rows.join('')}</div>`
}

function tabs(m) {
    const { sel, got } = m.state
    const tab = (isOn, href, label, badge, badgeOn = false) =>
        `<button type="button" role="tab" class="tabs__tab" aria-selected="${isOn}" data-href="${href}" data-key="tab:${href}">
            ${label}<span class="tabs__badge${badgeOn ? ' tabs__badge--on' : ''}">${badge}</span></button>`
    return tab(!m.isList, `#/${m.spec}`, 'Весь лут', Object.keys(m.ratings).length) +
        tab(m.isList, `#/${m.spec}/list`, 'Мой лист', sel.length ? `${got.length}/${sel.length}` : 0, sel.length > 0)
}

// ---------- sidebar facets ----------
function facets(m) {
    const counts = facetCounts(m.base, filters, m.ctx)
    const seg = [['source', 'По источнику'], ['slot', 'По слоту']].map(([v, label]) =>
        `<button type="button" role="radio" class="seg-control__btn" aria-checked="${groupBy === v}" data-group="${v}" data-key="group:${v}">${label}</button>`)
    const tierOpts = TIERS.map((l) =>
        `<button type="button" class="facet-opt facet-opt--tier" aria-pressed="${filters.tiers.includes(l)}" data-tier="${l}" data-key="tier:${l}">
            ${tierPill(l)}<span>${TIER_HINT[l]}</span><span class="facet-count">${counts.tiers[l]}</span></button>`)
    const statOpts = Object.entries(STATS).map(([k, label]) =>
        `<button type="button" class="stat-pill stat--${k}" aria-pressed="${filters.stats.includes(k)}" data-stat="${k}" data-key="stat:${k}">${label}</button>`)
    const slotOpts = [['', 'Все слоты', counts.slotTotal], ...counts.slots.map(([s, n]) => [s, s, n])].map(([v, label, n]) =>
        `<button type="button" class="facet-opt facet-opt--slot" aria-pressed="${filters.slot === v}" data-slot="${esc(v)}" data-key="slot:${esc(v)}">
            <span>${esc(label)}</span><span class="facet-count">${n}</span></button>`)
    const check = (key, label) =>
        `<label class="facet-check"><input type="checkbox" class="checkbox" data-filter="${key}" data-key="filter:${key}"${filters[key] ? ' checked' : ''}>${label}</label>`
    return `${facet('Группировать', `<div class="seg-control" role="radiogroup" aria-label="Группировать">${seg.join('')}</div>`)}
        ${facet('Популярность у топ-50 (M+)', `<div class="facet-list">${tierOpts.join('')}</div>`)}
        ${facet('Вторичные статы', `<div class="stat-pills">${statOpts.join('')}</div>`)}
        ${facet('Слот', `<div class="facet-list facet-list--scroll">${slotOpts.join('')}</div>`)}
        ${check('tierOnly', 'Только тир-сет')}
        ${m.isList ? check('hideGot', 'Скрыть залутанные') : ''}
        ${hasActiveFilters(filters) ? '<button type="button" class="facet-reset" data-act="reset-filters" data-key="reset-filters">Сбросить фильтры</button>' : ''}`
}

const facet = (label, body) => `<div class="facet"><span class="label">${label}</span>${body}</div>`

// ---------- main column ----------
const tierPill = (l, label = '', title = '') =>
    `<span class="tier tier--${l === '-' ? 'none' : l}"${title ? ` title="${esc(title)}"` : ''}>${label ? `<i>${label}</i>` : ''}<b>${l === '-' ? '—' : l}</b></span>`

const tierBadge = (label, letter, source) =>
    tierPill(letter, label, `${label}: ${TIER_HINT[letter]} топ-игроков (${source})`)

function row(id, m) {
    const it = data.items[id]
    const rating = m.ratings[id]
    const isOn = m.isList ? m.ctx.got.has(id) : m.sel.has(id)
    const src = iconSrc(it.i)
    const art = src
        ? `<img class="loot-art" src="${src}" width="40" height="40" alt="" loading="lazy" data-stub="${esc(it.n[0] ?? '?')}">`
        : `<span class="loot-art loot-art--stub" aria-hidden="true">${esc(it.n[0] ?? '?')}</span>`
    const meta = groupBy === 'slot' ? sourceLabel(it, data) : it.sl
    const chips = it.st.filter((s) => STATS[s]).map((s) => `<span class="chip stat--${s}">${STATS[s]}</span>`)
    const badges = tierBadge('M+', rating[0], 'murlok.io') + (data.hasRaid ? tierBadge('Рейд', rating[1], 'Warcraft Logs') : '')
    const label = m.isList
        ? (isOn ? 'Залутано — снять отметку' : 'Отметить как залутано')
        : (isOn ? 'Убрать из листа' : 'Добавить в лист')
    const glyph = isOn ? ICON.check : m.isList ? '' : ICON.plus
    return `<li class="row q${Number(it.q)}${isOn ? ' is-on' : ''}" data-row="${id}">
        <a class="row__art" href="${ITEM_URL}${id}" target="_blank" rel="noopener" aria-label="${esc(it.n)} на Wowhead">${art}</a>
        <span class="row__txt"><span class="row__name">${esc(it.n)}</span>
            <span class="row__meta">${it.t ? '<span class="row__tier">Тир</span>' : ''}<span>${esc(meta)}</span>${chips.join('')}</span></span>
        <span class="badges">${badges}</span>
        <button type="button" class="row__toggle" role="checkbox" aria-checked="${isOn}" aria-label="${label}" title="${label}" data-key="toggle:${id}">${glyph}</button>
    </li>`
}

const bySlotName = (a, b) => data.items[a].sl.localeCompare(data.items[b].sl, 'ru')

function group(title, ids, m) {
    if (!ids.length) return ''
    const sorted = [...ids].sort((a, b) => ratingRank(m.ratings[a]) - ratingRank(m.ratings[b]) || bySlotName(a, b))
    const done = ids.filter((id) => m.ctx.got.has(id)).length
    const isDone = m.isList && done === ids.length
    const count = m.isList ? `${done}/${ids.length}` : ids.length
    return `<section class="card"><header class="panel-header"><h3 class="panel-title">${esc(title)}</h3>
            <span class="panel-count${isDone ? ' panel-count--done' : ''}">${count}</span></header>
        <ul class="rows">${sorted.map((id) => row(id, m)).join('')}</ul></section>`
}

const zone = (title, count, inner) =>
    count ? `<section class="zone"><h2 class="section-head">${title}<span class="count-badge">${count}</span></h2>${inner}</section>` : ''
const grid = (cards) => `<div class="groups">${cards.join('')}</div>`
const atBoss = (item, raid, boss) => item.b === boss.id && (item.r === undefined || item.r === raid.id)

// By source: dungeons → items; raids → boss → items. Tier pieces get their own zone on «Весь лут», inline on the list.
function zonesBySource(m) {
    const items = data.items
    const isTierHere = (id) => !m.isList && items[id].t
    const dIds = m.ids.filter((id) => items[id].d)
    const rIds = m.ids.filter((id) => items[id].b && !isTierHere(id))
    const tIds = m.ids.filter(isTierHere)
    const raids = data.raids.map((r) => {
        const cards = r.bosses.map((b) => group(b.ru, rIds.filter((id) => atBoss(items[id], r, b)), m))
        return cards.join('') && `<div class="raid"><h3 class="raid__title">${esc(r.ru)}</h3>${grid(cards)}</div>`
    })
    const tier = data.raids.flatMap((r) => r.bosses.map((b) => group(b.ru, tIds.filter((id) => atBoss(items[id], r, b)), m)))
    return zone('Подземелья M+', dIds.length, grid(data.dungeons.map((d) => group(d.ru, dIds.filter((id) => items[id].d === d.id), m)))) +
        zone('Рейды', rIds.length, raids.join('')) +
        zone('Тир-сет', tIds.length, grid(tier))
}

const zonesBySlot = (m) => zone('По слотам', m.ids.length, grid(groupBySlot(m.ids, data.items).map(([s, ids]) => group(s, ids, m))))

function listHead(m) {
    const { sel, got } = m.state
    const pct = sel.length ? Math.round((got.length / sel.length) * 100) : 0
    return `<section class="card list-head"><div class="list-head__info">
            <div class="list-head__title-row"><h2 class="list-head__title">Залутано ${got.length} из ${sel.length}</h2>
                <span class="list-head__spec">${esc(m.specInfo.ru)} · ${esc(m.cls.ru)}</span></div>
            <div class="progress" role="progressbar" aria-label="Залутано" aria-valuemin="0" aria-valuemax="${sel.length}" aria-valuenow="${got.length}">
                <div class="progress__fill" style="width: ${pct}%"></div></div></div>
        <div class="actions">
            <button type="button" class="btn" data-act="share" data-key="share"${sel.length ? '' : ' disabled'}>${ICON.link}Скопировать ссылку</button>
            <button type="button" class="btn" data-act="reset-got" data-key="reset-got"${got.length ? '' : ' disabled'}>${ICON.reset}Снять отметки</button>
        </div></section>`
}

function main(m) {
    const head = m.isList ? listHead(m) : ''
    if (m.isList && !m.state.sel.length) {
        return `${head}<div class="empty-card empty-card--big"><h3 class="empty-card__title">Лист пока пуст</h3>
            <p>Добавьте предметы во вкладке «Весь лут» — здесь они соберутся по подземельям и боссам, и можно будет отмечать, что уже выпало.</p>
            <a class="btn gold" href="#/${m.spec}">Выбрать предметы</a></div>`
    }
    const zones = groupBy === 'slot' ? zonesBySlot(m) : zonesBySource(m)
    return head + (zones || `<div class="empty-card"><p>Под фильтры ничего не подходит.</p>
        <button type="button" class="btn" data-act="reset-filters" data-key="reset-filters-empty">Сбросить фильтры</button></div>`)
}

function bar(m) {
    if (m.isList || !m.state.sel.length) return ''
    return `<div class="bar"><span class="bar__count">В листе: <b>${m.state.sel.length}</b></span>
        <a class="btn gold" href="#/${m.spec}/list">Открыть лист${ICON.next}</a></div>`
}

// ---------- actions ----------
function toast(msg) {
    const el = $('#toast')
    el.textContent = msg
    el.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
        el.hidden = true
    }, TOAST_MS)
}

async function share(spec) {
    const url = `${location.origin}${location.pathname}#/${spec}/list?i=${loadState(spec).sel.join(',')}`
    try {
        await navigator.clipboard.writeText(url)
        toast('Ссылка на лист скопирована')
    } catch (err) {
        console.warn('clipboard unavailable', err)
        window.prompt('Скопируйте ссылку на лист:', url)
    }
}

function toggleItem(id) {
    const r = parseRoute()
    const state = loadState(r.spec)
    const key = r.isList ? 'got' : 'sel'
    saveState(r.spec, { ...state, [key]: toggle(state[key], id, !state[key].includes(id)) })
    render()
}

function setFilters(next) {
    filters = { ...filters, ...next }
    render()
}

function resetFilters() {
    $('#q').value = ''
    setFilters({ ...NO_FILTERS })
}

const flip = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

function onFacetClick(e) {
    const t = e.target.closest('button')
    if (!t) return
    if (t.dataset.group) {
        groupBy = t.dataset.group
        writeStore(GROUP_KEY, groupBy)
        render()
    }
    if (t.dataset.tier) setFilters({ tiers: flip(filters.tiers, t.dataset.tier) })
    if (t.dataset.stat) setFilters({ stats: flip(filters.stats, t.dataset.stat) })
    if (t.dataset.slot !== undefined) setFilters({ slot: t.dataset.slot })
    if (t.dataset.act === 'reset-filters') resetFilters()
}

function onMainClick(e) {
    const r = parseRoute()
    const act = e.target.closest('[data-act]')?.dataset.act
    if (act === 'share') return share(r.spec)
    if (act === 'reset-filters') return resetFilters()
    if (act === 'reset-got') {
        if (window.confirm('Снять все отметки «залутано»?')) {
            saveState(r.spec, { ...loadState(r.spec), got: [] })
            render()
        }
        return
    }
    if (e.target.closest('a')) return // icon link opens Wowhead, does not toggle the row
    const row = e.target.closest('[data-row]')
    if (row) toggleItem(row.dataset.row)
}

function setPicker(isOpen) {
    if (isPickerOpen === isOpen) return
    isPickerOpen = isOpen
    $('#picker-btn').setAttribute('aria-expanded', String(isOpen))
    $('#picker-pop').hidden = !isOpen
    if (!data || !parseRoute()) return
    $('#picker-pop').innerHTML = isOpen ? pickerPopover(model()) : ''
    if (isOpen) $('.picker__spec-btn[aria-current="true"]')?.focus()
    else $('#picker-btn').focus()
}

function onPickerClick(e) {
    if (e.target.closest('[data-close]')) return setPicker(false)
    const btn = e.target.closest('[data-spec]')
    if (!btn) return
    const r = parseRoute()
    location.hash = `#/${btn.dataset.spec}${r.isList ? '/list' : ''}` // keeps the current tab
}

// Missing image → class icon (picker) or letter stub (items, like Raidsmith's LootArt). `error` doesn't bubble.
function onImageError(e) {
    const img = e.target
    if (!(img instanceof HTMLImageElement)) return
    const { fallback, stub } = img.dataset
    if (fallback && !img.src.endsWith(fallback)) {
        img.src = fallback
        return
    }
    if (stub === undefined) return
    const span = document.createElement('span')
    span.className = 'loot-art loot-art--stub'
    span.setAttribute('aria-hidden', 'true')
    span.textContent = stub
    img.replaceWith(span)
}

function bindEvents() {
    $('#picker-btn').addEventListener('click', () => setPicker(!isPickerOpen))
    $('#picker-pop').addEventListener('click', onPickerClick)
    $('#tabs').addEventListener('click', (e) => {
        const href = e.target.closest('[data-href]')?.dataset.href
        if (href) location.hash = href
    })
    $('#facets').addEventListener('click', onFacetClick)
    $('#facets').addEventListener('change', (e) => {
        const key = e.target.dataset.filter
        if (key) setFilters({ [key]: e.target.checked })
    })
    $('#q').addEventListener('input', (e) => setFilters({ q: e.target.value }))
    $('#view').addEventListener('click', onMainClick)
    document.addEventListener('error', onImageError, true)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isPickerOpen) setPicker(false)
    })
    addEventListener('hashchange', () => {
        route()
        scrollTo(0, 0)
    })
}

async function init() {
    try {
        const res = await fetch('data.json', { cache: 'no-cache' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        data = await res.json()
    } catch (err) {
        console.error('data.json load failed', err)
        $('#view').innerHTML = '<p class="empty-card">Не удалось загрузить данные. Попробуйте обновить страницу позже.</p>'
        return
    }
    groupBy = readStore(GROUP_KEY) === 'slot' ? 'slot' : 'source'
    $('#patch').textContent = `${data.build.split('.').slice(0, 3).join('.')} патч`
    $('#season').textContent = `${data.season} · данные от ${new Date(data.generated).toLocaleDateString('ru-RU')}`
    bindEvents()
    route()
}

init()
