// Loot Gather frontend: summary (#/<spec>) and checklist (#/<spec>/list) views over data.json.
const ICON_URL = 'https://wow.zamimg.com/images/wow/icons/medium/'
const ITEM_URL = 'https://www.wowhead.com/ru/item='
const ROUTE = /^#\/(\d+)(\/list)?(?:\?i=([\d,]{1,4000}))?$/
const TIERS = ['S', 'A', 'B', 'C', '-']
// '-' = not among murlok's top-5 per slot (M+) or worn by nobody in top parses (raid)
const TIER_HINT = { S: '≥ 50%', A: '≥ 25%', B: '≥ 10%', C: '< 10%', '-': 'редко или не используют' }
const STAT_RU = { crit: 'Крит', haste: 'Скорость', mast: 'Искусность', vers: 'Универсальность' }
const LAST_SPEC_KEY = 'lg:spec'
const TOAST_MS = 2200

const $ = (sel) => document.querySelector(sel)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const view = $('#view')
let data
let toastTimer

// ---------- storage: { sel: [itemId], got: [itemId] } per spec ----------
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

const saveState = (spec, state) => writeStore(`lg:${spec}`, JSON.stringify(state))
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
  const ask = `Заменить твой текущий лист (${current.sel.length} предм.) листом из ссылки (${sel.length} предм.)?`
  if (current.sel.length && !window.confirm(ask)) return
  saveState(spec, { sel, got: current.got.filter((id) => sel.includes(id)) })
}

function route() {
  const r = parseRoute()
  if (!r) return location.replace(`#/${defaultSpec()}`)
  if (r.shared) {
    importShared(r.spec, r.shared)
    return location.replace(`#/${r.spec}/list`)
  }
  writeStore(LAST_SPEC_KEY, r.spec)
  syncPickers(r.spec)
  view.className = r.isList ? 'list' : 'summary'
  view.innerHTML = r.isList ? listView(r.spec) : summaryView(r.spec)
}

// ---------- pickers ----------
const classOf = (spec) => data.classes.find((c) => c.specs.some((s) => String(s.id) === spec))
const specName = (spec) => classOf(spec).specs.find((s) => String(s.id) === spec).ru

function syncPickers(spec) {
  const cls = classOf(spec)
  $('#cls').value = cls.id
  $('#spec').innerHTML = cls.specs.map((s) => `<option value="${s.id}">${esc(s.ru)}</option>`).join('')
  $('#spec').value = spec
}

// ---------- rendering ----------
const rank = (rating) => Math.min(TIERS.indexOf(rating[0]), TIERS.indexOf(rating[1]))
const bySlot = (a, b) => data.items[a].sl.localeCompare(data.items[b].sl, 'ru')
const sortIds = (ids, ratings) => [...ids].sort((a, b) => rank(ratings[a]) - rank(ratings[b]) || bySlot(a, b))
const atBoss = (item, raid, boss) => item.b === boss.id && (item.r === undefined || item.r === raid.id)

function badge(label, letter, source) {
  const cls = letter === '-' ? 'none' : letter
  const title = `${label}: ${TIER_HINT[letter]} топ-игроков (${source})`
  return `<span class="badge t-${cls}" title="${esc(title)}"><i>${label}</i><b>${letter === '-' ? '—' : letter}</b></span>`
}

function row(id, rating, isChecked) {
  const it = data.items[id]
  const icon = /^[\w-]+$/.test(it.i) ? `<img src="${ICON_URL}${it.i}.jpg" width="36" height="36" alt="" loading="lazy">` : ''
  const chips = it.st.filter((s) => STAT_RU[s]).map((s) => `<span class="chip ${s}">${STAT_RU[s]}</span>`).join('')
  const badges = badge('M+', rating[0], 'murlok.io') + (data.hasRaid ? badge('Рейд', rating[1], 'Warcraft Logs') : '')
  return `<li class="row q${Number(it.q)}"><label>
    <input type="checkbox" data-id="${id}"${isChecked ? ' checked' : ''}>
    <a class="icon" href="${ITEM_URL}${id}" target="_blank" rel="noopener" aria-label="${esc(it.n)} на Wowhead">${icon}</a>
    <span class="txt"><span class="name">${esc(it.n)}</span>
      <span class="meta">${it.t ? '<span class="tag-tier">Тир</span>' : ''}${esc(it.sl)}${chips}</span></span>
    <span class="badges">${badges}</span></label></li>`
}

function group(title, ids, ratings, checked) {
  if (!ids.length) return ''
  const rows = sortIds(ids, ratings).map((id) => row(id, ratings[id], checked.has(id))).join('')
  return `<section class="group"><h3>${esc(title)} <small>${ids.length}</small></h3><ul>${rows}</ul></section>`
}

function zone(title, count, inner) {
  return count ? `<section class="zone"><h2>${title} <small>${count}</small></h2>${inner}</section>` : ''
}

// Dungeons → items; raids → boss → items. Tier pieces get their own zone in the summary, inline in the list.
function zones(ids, ratings, checked, isTierSeparate) {
  const items = data.items
  const isTierHere = (id) => isTierSeparate && items[id].t
  const dIds = ids.filter((id) => items[id].d)
  const rIds = ids.filter((id) => items[id].b && !isTierHere(id))
  const tIds = ids.filter(isTierHere)
  const dungeons = data.dungeons.map((d) => group(d.ru, dIds.filter((id) => items[id].d === d.id), ratings, checked))
  const raids = data.raids.map((r) => {
    const groups = r.bosses.map((b) => group(b.ru, rIds.filter((id) => atBoss(items[id], r, b)), ratings, checked)).join('')
    return groups && `<div class="raid"><h3>${esc(r.ru)}</h3><div class="groups">${groups}</div></div>`
  })
  const tier = data.raids.flatMap((r) =>
    r.bosses.map((b) => group(b.ru, tIds.filter((id) => atBoss(items[id], r, b)), ratings, checked)))
  return zone('Подземелья M+', dIds.length, `<div class="groups">${dungeons.join('')}</div>`) +
    zone('Рейды', rIds.length, raids.join('')) +
    zone('Тир-сет', tIds.length, `<div class="groups">${tier.join('')}</div>`)
}

function legend() {
  const sources = data.hasRaid ? 'M+ — топ-50 игроков спека (murlok.io), Рейд — топ логов (Warcraft Logs)' : 'M+ — топ-50 игроков спека (murlok.io)'
  const keys = TIERS.map((l) => `<span><span class="badge solo t-${l === '-' ? 'none' : l}"><b>${l === '-' ? '—' : l}</b></span>${TIER_HINT[l]}</span>`)
  return `<p class="legend"><span>Сколько топ-игроков носят предмет:</span>${keys.join('')}<span>${sources}</span></p>`
}

function summaryView(spec) {
  const ratings = data.specs[spec]
  const { sel } = loadState(spec)
  const bar = `<div class="bar"><span>Отмечено: <b id="sel-count">${sel.length}</b></span>
    <button class="btn primary" data-act="build"${sel.length ? '' : ' disabled'}>Собрать лист предметов</button></div>`
  return legend() + zones(Object.keys(ratings), ratings, new Set(sel), true) + bar
}

const progressText = (got, total) => `залутано ${got} из ${total}`

function listView(spec) {
  const { sel, got } = loadState(spec)
  const head = `<div class="list-head"><div><h2>Лист предметов</h2>
      <p>${esc(specName(spec))} · ${esc(classOf(spec).ru)} · <span id="progress-text">${progressText(got.length, sel.length)}</span></p>
      <progress id="progress" max="${sel.length || 1}" value="${got.length}"></progress></div>
    <div class="actions"><a class="btn" href="#/${spec}">← К сводке</a>
      <button class="btn" data-act="share"${sel.length ? '' : ' disabled'}>Поделиться</button>
      <button class="btn" data-act="reset"${got.length ? '' : ' disabled'}>Сбросить отметки</button></div></div>`
  if (!sel.length) return `${head}<p class="empty">Лист пуст — отметь предметы в <a href="#/${spec}">сводке</a>.</p>`
  return head + zones(sel, data.specs[spec], new Set(got), false)
}

function updateCounters({ sel, got }) {
  const count = $('#sel-count')
  if (count) {
    count.textContent = sel.length
    $('[data-act="build"]').disabled = !sel.length
  }
  const progress = $('#progress')
  if (progress) {
    progress.value = got.length
    $('#progress-text').textContent = progressText(got.length, sel.length)
    $('[data-act="reset"]').disabled = !got.length
  }
}

// ---------- actions ----------
function toast(msg) {
  const el = $('#toast')
  el.textContent = msg
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.hidden = true }, TOAST_MS)
}

async function share(spec) {
  const url = `${location.origin}${location.pathname}#/${spec}/list?i=${loadState(spec).sel.join(',')}`
  try {
    await navigator.clipboard.writeText(url)
    toast('Ссылка на лист скопирована')
  } catch (err) {
    console.warn('clipboard unavailable', err)
    window.prompt('Скопируй ссылку на лист:', url)
  }
}

function onToggle(e) {
  const id = e.target.dataset?.id
  const r = parseRoute()
  if (!id || !r) return
  const state = loadState(r.spec)
  const key = r.isList ? 'got' : 'sel'
  const next = { ...state, [key]: toggle(state[key], id, e.target.checked) }
  const clean = { ...next, got: next.got.filter((x) => next.sel.includes(x)) } // untracked → not looted
  saveState(r.spec, clean)
  updateCounters(clean)
}

function onAction(e) {
  const act = e.target.closest('[data-act]')?.dataset.act
  const r = parseRoute()
  if (!act || !r) return
  if (act === 'build') location.hash = `#/${r.spec}/list`
  if (act === 'share') share(r.spec)
  if (act === 'reset' && window.confirm('Снять все отметки «залутано»?')) {
    saveState(r.spec, { ...loadState(r.spec), got: [] })
    route()
  }
}

async function init() {
  try {
    const res = await fetch('data.json', { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    data = await res.json()
  } catch (err) {
    console.error('data.json load failed', err)
    view.innerHTML = '<p class="empty">Не удалось загрузить данные. Попробуй обновить страницу позже.</p>'
    return
  }
  const date = new Date(data.generated).toLocaleDateString('ru-RU')
  $('#season').textContent = `${data.season} · билд ${data.build} · данные от ${date}`
  $('#cls').innerHTML = data.classes.map((c) => `<option value="${c.id}">${esc(c.ru)}</option>`).join('')
  $('#cls').addEventListener('change', (e) => {
    location.hash = `#/${data.classes.find((c) => String(c.id) === e.target.value).specs[0].id}`
  })
  $('#spec').addEventListener('change', (e) => { location.hash = `#/${e.target.value}` })
  view.addEventListener('change', onToggle)
  view.addEventListener('click', onAction)
  addEventListener('hashchange', () => {
    route()
    scrollTo(0, 0)
  })
  route()
}

init()
