// Builds data.json: current-season loot per spec + popularity tiers.
// Sources: Raidbots static data (loot), murlok.io (M+ usage), Warcraft Logs (raid usage, optional).
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const RAIDBOTS = 'https://www.raidbots.com/static/data/live/'
const UA = 'Mozilla/5.0 (compatible; loot_gather; weekly build)'
const MURLOK_TOP_N = 50 // ponytail: murlok ranks top-50 players per spec; read from page if they change it
const MURLOK_DELAY_MS = 300
const MURLOK_MIN_RATED = 15 // fewer rated items for a spec = page changed / blocked (today: 36–54)
const RETRIES = 4
const RETRY_DELAY_MS = 5000
const DUNGEON_COUNT = 8
const MIN_SEASON_ITEMS = 100
// Icons are self-hosted: wow.zamimg.com is blocked in RU, Blizzard's CDN lacks half of the 12.x icons by name.
const ICON_CDN = 'https://wow.zamimg.com/images/wow/icons/large/' // 56px → crisp at 26px on 2x screens
const ICON_DIR = new URL('./icons/', import.meta.url)
const ICON_CONCURRENCY = 6
const ICON_NAME = /^[\w-]+$/ // names come from Raidbots and become file paths

// [ruName, armorSubclass]: 1 cloth, 2 leather, 3 mail, 4 plate
const CLASSES = {
  1: ['Воин', 4], 2: ['Паладин', 4], 3: ['Охотник', 3], 4: ['Разбойник', 2], 5: ['Жрец', 1],
  6: ['Рыцарь смерти', 4], 7: ['Шаман', 3], 8: ['Маг', 1], 9: ['Чернокнижник', 1], 10: ['Монах', 2],
  11: ['Друид', 2], 12: ['Охотник на демонов', 2], 13: ['Пробудитель', 3],
}
const CLASS_IDS_BY_NAME = {
  Warrior: 1, Paladin: 2, Hunter: 3, Rogue: 4, Priest: 5, 'Death Knight': 6, Shaman: 7,
  Mage: 8, Warlock: 9, Monk: 10, Druid: 11, 'Demon Hunter': 12, Evoker: 13,
}
// [ruName, primaryStat]
const SPECS = {
  71: ['Оружие', 'str'], 72: ['Неистовство', 'str'], 73: ['Защита', 'str'],
  65: ['Свет', 'int'], 66: ['Защита', 'str'], 70: ['Воздаяние', 'str'],
  253: ['Повелитель зверей', 'agi'], 254: ['Стрельба', 'agi'], 255: ['Выживание', 'agi'],
  259: ['Ликвидация', 'agi'], 260: ['Головорез', 'agi'], 261: ['Скрытность', 'agi'],
  256: ['Послушание', 'int'], 257: ['Свет', 'int'], 258: ['Тьма', 'int'],
  250: ['Кровь', 'str'], 251: ['Лед', 'str'], 252: ['Нечестивость', 'str'],
  262: ['Стихии', 'int'], 263: ['Совершенствование', 'agi'], 264: ['Исцеление', 'int'],
  62: ['Тайная магия', 'int'], 63: ['Огонь', 'int'], 64: ['Лед', 'int'],
  265: ['Колдовство', 'int'], 266: ['Демонология', 'int'], 267: ['Разрушение', 'int'],
  268: ['Хмелевар', 'agi'], 269: ['Танцующий с ветром', 'agi'], 270: ['Ткач туманов', 'int'],
  102: ['Баланс', 'int'], 103: ['Сила зверя', 'agi'], 104: ['Страж', 'agi'], 105: ['Исцеление', 'int'],
  577: ['Истребление', 'agi'], 581: ['Месть', 'agi'], 1480: ['Пожиратель', 'int'],
  1467: ['Опустошение', 'int'], 1468: ['Сохранение', 'int'], 1473: ['Насыщение', 'int'],
}
// Dungeon / raid / boss names (journal ids): Raidbots ships English only, unknown ids fall back to it.
// ponytail: hand-kept per season (source: game client ruRU journal); new season → add its ~20 names.
const NAMES_RU = {
  1322: 'Алтарь Клыков', 1311: 'Берлога Налоракка', 1041: 'Гробница королей', 1304: 'Закоулок душегубов',
  1202: 'Рубиновые Омуты Жизни', 1030: 'Храм Сетралисс', 1309: 'Слепящая долина', 1313: 'Арена Шрама Бездны',
  1320: 'Отравленная бездна', 1317: 'Приливный грот',
  2888: "Нек'зали Душительница Душ", 2874: 'Погребенные стражи', 2894: 'Потерявшиеся исследователи',
  2882: 'Вашник Тлетворный', 2871: 'Ссзорак', 2887: 'Два Клыка', 2883: 'Спиральный алтарь',
  2895: "Ула'тек", 2849: 'Нимрисса Волногон',
}
// Spec icons: verified map copied from Raidsmith src/lib/spec-icons.ts (keys = talents.json EN names).
// Class icons are `classicon_<class name without spaces>`. Both are self-hosted by syncIcons.
const SPEC_ICONS = {
  'Death Knight:Blood': 'spell_deathknight_bloodpresence',
  'Death Knight:Frost': 'spell_deathknight_frostpresence',
  'Death Knight:Unholy': 'spell_deathknight_unholypresence',
  'Demon Hunter:Havoc': 'ability_demonhunter_specdps',
  'Demon Hunter:Vengeance': 'ability_demonhunter_spectank',
  'Demon Hunter:Devourer': 'classicon_demonhunter_void',
  'Druid:Balance': 'spell_nature_starfall',
  'Druid:Feral': 'ability_druid_catform',
  'Druid:Guardian': 'ability_racial_bearform',
  'Druid:Restoration': 'spell_nature_healingtouch',
  'Evoker:Devastation': 'classicon_evoker_devastation',
  'Evoker:Preservation': 'classicon_evoker_preservation',
  'Evoker:Augmentation': 'classicon_evoker_augmentation',
  'Hunter:Beast Mastery': 'ability_hunter_bestialdiscipline',
  'Hunter:Marksmanship': 'ability_hunter_focusedaim',
  'Hunter:Survival': 'ability_hunter_camouflage',
  'Mage:Arcane': 'spell_holy_magicalsentry',
  'Mage:Fire': 'spell_fire_firebolt02',
  'Mage:Frost': 'spell_frost_frostbolt02',
  'Monk:Brewmaster': 'spell_monk_brewmaster_spec',
  'Monk:Mistweaver': 'spell_monk_mistweaver_spec',
  'Monk:Windwalker': 'spell_monk_windwalker_spec',
  'Paladin:Holy': 'spell_holy_holybolt',
  'Paladin:Protection': 'ability_paladin_shieldofthetemplar',
  'Paladin:Retribution': 'spell_holy_auraoflight',
  'Priest:Discipline': 'spell_holy_powerwordshield',
  'Priest:Holy': 'spell_holy_guardianspirit',
  'Priest:Shadow': 'spell_shadow_shadowwordpain',
  'Rogue:Assassination': 'ability_rogue_eviscerate',
  'Rogue:Outlaw': 'ability_rogue_waylay',
  'Rogue:Subtlety': 'ability_stealth',
  'Shaman:Elemental': 'spell_nature_lightning',
  'Shaman:Enhancement': 'spell_shaman_improvedstormstrike',
  'Shaman:Restoration': 'spell_nature_magicimmunity',
  'Warlock:Affliction': 'spell_shadow_deathcoil',
  'Warlock:Demonology': 'spell_shadow_metamorphosis',
  'Warlock:Destruction': 'spell_shadow_rainoffire',
  'Warrior:Arms': 'ability_warrior_savageblow',
  'Warrior:Fury': 'ability_warrior_innerrage',
  'Warrior:Protection': 'ability_warrior_defensivestance',
}
const SLOTS_RU = {
  1: 'Голова', 2: 'Шея', 3: 'Плечи', 5: 'Грудь', 20: 'Грудь', 6: 'Пояс', 7: 'Ноги', 8: 'Ступни',
  9: 'Запястья', 10: 'Кисти рук', 11: 'Палец', 12: 'Аксессуар', 13: 'Одноручное', 21: 'Правая рука',
  22: 'Левая рука', 23: 'Левая рука', 14: 'Щит', 15: 'Дальний бой', 26: 'Дальний бой',
  16: 'Спина', 17: 'Двуручное',
}
const SECONDARY = { 32: 'crit', 36: 'haste', 49: 'mast', 40: 'vers' }
const PRIMARY_IDS = { agi: [3, 71, 72, 73], str: [4, 71, 72, 74], int: [5, 71, 73, 74] }
const ALL_PRIMARY = new Set([3, 4, 5, 71, 72, 73, 74])
const WEAPON_SLOTS = new Set([13, 14, 15, 17, 21, 22, 23, 26])
const TOKEN_CLASS = 15
export const TIERS = [[50, 'S'], [25, 'A'], [10, 'B'], [Number.EPSILON, 'C']]
const MURLOK_GEAR = new Set([
  'Head', 'Neck', 'Shoulders', 'Back', 'Chest', 'Wrist', 'Hands', 'Waist', 'Legs', 'Feet',
  'Rings', 'Trinkets', 'Main Hand', 'Off Hand',
])
const WCL = 'https://www.warcraftlogs.com/'
const WCL_MYTHIC = 5
const WCL_HEROIC = 4
const WCL_MIN_SAMPLE = 20 // fewer Mythic parses than this → use Heroic
const HEALERS = new Set([65, 105, 256, 257, 264, 270, 1468])
const WCL_ZONES_Q = '{worldData{zones{encounters{id journalID}}}}'
const WCL_RANKINGS_Q = `query($e:Int!,$d:Int!,$c:String!,$s:String!,$m:CharacterRankingMetricType!){
  worldData{encounter(id:$e){characterRankings(className:$c,specName:$s,difficulty:$d,metric:$m,includeCombatantInfo:true)}}}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ru = (id, en) => NAMES_RU[id] ?? en

async function fetchOk(url, init) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...init?.headers } })
  if (!res.ok) throw Object.assign(new Error(`${url} → HTTP ${res.status}`), { status: res.status })
  return res
}

// Retries rate limits / server errors with linear backoff; anything else fails immediately.
async function fetchRetry(url, init) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchOk(url, init)
    } catch (err) {
      const isRetryable = err.status === 429 || err.status >= 500
      if (!isRetryable || attempt >= RETRIES) throw err
      await sleep(RETRY_DELAY_MS * attempt)
    }
  }
}

async function getJSON(name, expect = Array) {
  const data = await (await fetchOk(RAIDBOTS + name)).json()
  const ok = expect === Array ? Array.isArray(data) : data && typeof data === 'object'
  if (!ok) throw new Error(`${name}: unexpected shape`)
  return data
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assert: ${msg}`)
}

export function tier(pct) {
  return TIERS.find(([min]) => pct >= min)?.[1] ?? ''
}

function hasPrimary(item, primary) {
  const ids = (item.stats ?? []).map((s) => s.id).filter((id) => ALL_PRIMARY.has(id))
  return ids.length === 0 || ids.some((id) => PRIMARY_IDS[primary].includes(id))
}

// spec = { id, classId, primary, armor }
export function fitsSpec(item, spec, weaponSpecs) {
  if (item.allowableClasses && !item.allowableClasses.includes(spec.classId)) return false
  if (item.specs) return item.specs.includes(spec.id)
  if (!hasPrimary(item, spec.primary)) return false
  if (item.itemClass === 2 || WEAPON_SLOTS.has(item.inventoryType)) {
    const rule = weaponSpecs.find((w) => w.itemClass === item.itemClass && w.itemSubClass === item.itemSubClass)
    return Boolean(rule?.specsCanDrop.includes(spec.id))
  }
  const isArmor = item.itemClass === 4 && item.itemSubClass >= 1 && item.itemSubClass <= 4
  if (isArmor && item.inventoryType !== 16) return item.itemSubClass === spec.armor
  return true
}

export function tierPieceFor(token, classId, byId) {
  const piece = (token.contains ?? []).map((id) => byId.get(id)).find((p) => p?.allowableClasses?.includes(classId))
  if (!piece) throw new Error(`no tier piece for token ${token.id} class ${classId}`)
  return piece
}

// murlok.io page → Map<itemId, playersUsing>. Gear block = <h3> slot headers until the first non-slot header.
export function parseMurlok(html) {
  const parts = html.split(/<h3>([^<]+)<\/h3>/)
  const counts = new Map()
  let started = false
  for (let k = 1; k < parts.length; k += 2) {
    const isGear = MURLOK_GEAR.has(parts[k].trim())
    if (!isGear && started) break
    if (!isGear) continue
    started = true
    for (const li of parts[k + 1].split('<li class="vi-poppable"').slice(1)) {
      const id = Number(li.match(/item=(\d+)/)?.[1])
      const n = Number(li.match(/d="M12,4A4,4[^"]*"\s*\/>\s*<\/svg>\s*(\d+)/)?.[1])
      if (id && n) counts.set(id, Math.max(counts.get(id) ?? 0, n))
    }
  }
  return counts
}

export function pickRaidPseudo(instances, seasonName) {
  const n = seasonName.match(/Season (\d+)/)?.[1]
  const pseudo = instances.find((i) => i.type === 'raid' && i.id < 0 && i.name === `Season ${n} Raids`)
  assert(pseudo, `raid pseudo-instance for "${seasonName}"`)
  return pseudo
}

function seasonPools(instances, seasonName) {
  const mplus = instances.find((i) => i.type === 'mplus-chest')
  assert(mplus?.encounters.length === DUNGEON_COUNT, `${DUNGEON_COUNT} M+ dungeons`)
  const pseudo = pickRaidPseudo(instances, seasonName)
  const bosses = pseudo.encounters.filter((e) => e.sourceInstanceId)
  const raidIds = [...new Set(bosses.map((b) => b.sourceInstanceId))]
  const byInstance = new Map(instances.map((i) => [i.id, i]))
  const raids = raidIds.map((id) => {
    const inst = byInstance.get(id)
    assert(inst, `raid instance ${id}`)
    const own = bosses
      .filter((b) => b.sourceInstanceId === id)
      .map((b) => ({ id: b.id, ru: b.id < 0 ? 'Трэш' : ru(b.id, b.name) }))
    return { id, ru: ru(id, inst.name), bosses: own }
  })
  const dungeons = mplus.encounters.map((d) => ({ id: d.id, ru: ru(d.id, d.name) }))
  return { mplusId: mplus.id, dungeons, raids }
}

// Where an item drops: { d: dungeonId } or { b: bossId }. Trash ids are shared between raids → keep the raid too.
function dropSite(item, mplusId, raidIds) {
  const sources = item.sources ?? []
  const m = sources.find((s) => s.instanceId === mplusId)
  if (m) return { d: m.encounterId }
  const r = sources.find((s) => raidIds.has(s.instanceId))
  if (!r) return null
  return r.encounterId < 0 ? { b: r.encounterId, r: r.instanceId } : { b: r.encounterId }
}

function secondaries(item) {
  return (item.stats ?? [])
    .filter((s) => SECONDARY[s.id])
    .sort((a, b) => b.alloc - a.alloc)
    .map((s) => SECONDARY[s.id])
}

function toOut(item, site, names, isTier) {
  return {
    n: names[item.id]?.ru_RU ?? item.name,
    i: item.icon,
    q: item.quality,
    sl: SLOTS_RU[item.inventoryType] ?? '',
    st: secondaries(item),
    ...site,
    ...(isTier ? { t: 1 } : {}),
  }
}

// Season loot as [{ item, site, isTier }], tier tokens expanded into per-class pieces.
function seasonLoot(allItems, pools) {
  const byId = new Map(allItems.map((i) => [i.id, i]))
  const raidIds = new Set(pools.raids.map((r) => r.id))
  const loot = allItems.flatMap((item) => {
    const site = dropSite(item, pools.mplusId, raidIds)
    if (!site) return []
    if (item.itemClass === TOKEN_CLASS && item.contains) {
      return item.allowableClasses.map((c) => ({ item: tierPieceFor(item, c, byId), site, isTier: true }))
    }
    const equippable = (item.itemClass === 2 || item.itemClass === 4) && item.inventoryType
    return equippable ? [{ item, site, isTier: false }] : []
  })
  assert(loot.length >= MIN_SEASON_ITEMS, `season items ≥ ${MIN_SEASON_ITEMS}, got ${loot.length}`)
  return loot
}

function specList(talents) {
  return talents.map((t) => {
    const classId = CLASS_IDS_BY_NAME[t.className]
    assert(classId && SPECS[t.specId], `known spec ${t.className}/${t.specName}`)
    return {
      id: t.specId, classId, className: t.className, specName: t.specName,
      primary: SPECS[t.specId][1], armor: CLASSES[classId][1],
    }
  })
}

async function mplusUsage(spec) {
  const slug = (s) => s.toLowerCase().replaceAll(' ', '-')
  const url = `https://murlok.io/${slug(spec.className)}/${slug(spec.specName)}/m+`
  // Any failure throws on purpose: the build fails and last week's good data.json stays published.
  const counts = parseMurlok(await (await fetchRetry(url)).text())
  assert(counts.size >= MURLOK_MIN_RATED, `${url}: only ${counts.size} items parsed`)
  const max = Math.max(...counts.values())
  assert(max <= MURLOK_TOP_N, `${url}: count ${max} > top-${MURLOK_TOP_N}, did murlok change its sample?`)
  return new Map([...counts].map(([id, n]) => [id, (n / MURLOK_TOP_N) * 100]))
}

async function allMplusUsage(specs) {
  const out = new Map()
  for (const spec of specs) {
    out.set(spec.id, await mplusUsage(spec))
    await sleep(MURLOK_DELAY_MS)
  }
  return out
}

// gearSets: one Set<itemId> per ranked player → Map<itemId, % of players wearing it>
export function usagePct(gearSets) {
  const counts = new Map()
  for (const set of gearSets) for (const id of set) counts.set(id, (counts.get(id) ?? 0) + 1)
  return new Map([...counts].map(([id, n]) => [id, (n / gearSets.length) * 100]))
}

async function wclToken(id, secret) {
  const res = await fetchOk(`${WCL}oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const { access_token: token } = await res.json()
  assert(token, 'WCL access token')
  return token
}

async function wclQuery(token, query, variables = {}) {
  const res = await fetchRetry(`${WCL}api/v2/client`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const body = await res.json()
  if (body.errors?.length) throw new Error(`WCL: ${body.errors[0].message}`)
  return body.data
}

async function rankedGear(token, vars, difficulty) {
  const data = await wclQuery(token, WCL_RANKINGS_Q, { ...vars, d: difficulty })
  const rankings = data.worldData.encounter?.characterRankings?.rankings ?? []
  return rankings.map((r) => new Set((r.gear ?? []).map((g) => Number(g.id))))
}

// Top parses of one spec on one boss → gear sets. WCL names have no spaces: DeathKnight, BeastMastery.
async function bossGear(token, encounterId, spec) {
  const vars = {
    e: encounterId,
    c: spec.className.replaceAll(' ', ''),
    s: spec.specName.replaceAll(' ', ''),
    m: HEALERS.has(spec.id) ? 'hps' : 'dps',
  }
  const mythic = await rankedGear(token, vars, WCL_MYTHIC)
  return mythic.length >= WCL_MIN_SAMPLE ? mythic : rankedGear(token, vars, WCL_HEROIC)
}

// Map<specId, Map<itemId, pct>> across all season raid bosses; null only when credentials are absent.
// With credentials, any WCL error (after retries) fails the build so a half-empty result is never published.
async function raidUsage(specs, raids) {
  const { WCL_CLIENT_ID: id, WCL_CLIENT_SECRET: secret } = process.env
  if (!id || !secret) {
    console.warn('WCL_CLIENT_ID / WCL_CLIENT_SECRET not set → no raid ratings')
    return null
  }
  const token = await wclToken(id, secret)
  const zones = (await wclQuery(token, WCL_ZONES_Q)).worldData.zones
  const byJournal = new Map(zones.flatMap((z) => z.encounters).map((e) => [e.journalID, e.id]))
  const encounters = raids.flatMap((r) => r.bosses).map((b) => byJournal.get(b.id)).filter(Boolean)
  assert(encounters.length, 'WCL encounters for season raid bosses')
  const out = new Map()
  for (const spec of specs) {
    const perBoss = []
    for (const e of encounters) perBoss.push(await bossGear(token, e, spec))
    out.set(spec.id, usagePct(perBoss.flat()))
  }
  return out
}

// ponytail: unlike rating sources, a failed icon only warns — icons are cosmetic and the
// frontend falls back to a letter stub. Downloads only names not already on disk.
async function syncIcons(names) {
  await mkdir(ICON_DIR, { recursive: true })
  const have = new Set(await readdir(ICON_DIR))
  const queue = [...new Set(names)].filter((n) => ICON_NAME.test(n) && !have.has(`${n}.jpg`))
  const total = queue.length
  let failed = 0
  const worker = async () => {
    for (let name = queue.pop(); name; name = queue.pop()) {
      try {
        const res = await fetchRetry(`${ICON_CDN}${name}.jpg`)
        await writeFile(new URL(`${name}.jpg`, ICON_DIR), Buffer.from(await res.arrayBuffer()))
      } catch (err) {
        failed++
        console.warn(`icon ${name}: ${err.message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: ICON_CONCURRENCY }, worker))
  console.log(`icons: ${total - failed} downloaded, ${failed} failed, ${have.size} already present`)
}

const classIcon = (className) => `classicon_${className.toLowerCase().replaceAll(' ', '')}`

// New spec without a mapped icon falls back to its class icon (warns, never fails the build).
function specIcon(spec) {
  const icon = SPEC_ICONS[`${spec.className}:${spec.specName}`]
  if (!icon) console.warn(`no spec icon for ${spec.className}/${spec.specName} → class icon`)
  return icon ?? classIcon(spec.className)
}

function classesOut(specs) {
  const ids = [...new Set(specs.map((s) => s.classId))]
    .sort((a, b) => CLASSES[a][0].localeCompare(CLASSES[b][0], 'ru'))
  return ids.map((id) => {
    const own = specs.filter((s) => s.classId === id)
    return {
      id,
      ru: CLASSES[id][0],
      ic: classIcon(own[0].className),
      specs: own.map((s) => ({ id: s.id, ru: SPECS[s.id][0], ic: specIcon(s) })),
    }
  })
}

function specRatings(specs, loot, weaponSpecs, mplus, raid) {
  return Object.fromEntries(specs.map((spec) => {
    const m = mplus.get(spec.id) ?? new Map()
    const r = raid?.get(spec.id) ?? new Map()
    const ids = loot.filter(({ item }) => fitsSpec(item, spec, weaponSpecs)).map(({ item }) => item.id)
    const rating = (id) => (tier(m.get(id) ?? 0) || '-') + (tier(r.get(id) ?? 0) || '-')
    return [spec.id, Object.fromEntries(ids.map((id) => [id, rating(id)]))]
  }))
}

async function main() {
  const [seasons, instances, allItems, talents, weaponSpecs, meta] = await Promise.all([
    getJSON('seasons.json'), getJSON('instances.json'), getJSON('encounter-items.json'),
    getJSON('talents.json'), getJSON('weapon-specs.json'), getJSON('metadata.json', Object),
  ])
  const season = seasons.find((s) => s.active)
  assert(season, 'active season')
  const pools = seasonPools(instances, season.name)
  const loot = seasonLoot(allItems, pools)
  const specs = specList(talents)
  console.log(`${season.name}: ${pools.dungeons.length} dungeons, ${pools.raids.length} raids, ${loot.length} items`)

  const names = (await getJSON('item-names.json', Object)).ItemSparse
  assert(names && typeof names === 'object', 'item-names.json ItemSparse')
  const mplus = await allMplusUsage(specs)
  const raid = await raidUsage(specs, pools.raids)

  const data = {
    build: meta.wowBuild,
    season: season.name,
    generated: new Date().toISOString(),
    hasRaid: Boolean(raid),
    classes: classesOut(specs),
    dungeons: pools.dungeons,
    raids: pools.raids,
    items: Object.fromEntries(loot.map(({ item, site, isTier }) => [item.id, toOut(item, site, names, isTier)])),
    specs: specRatings(specs, loot, weaponSpecs, mplus, raid),
  }
  const pickerIcons = data.classes.flatMap((c) => [c.ic, ...c.specs.map((s) => s.ic)])
  await syncIcons([...Object.values(data.items).map((it) => it.i), ...pickerIcons])
  await writeFile(new URL('./data.json', import.meta.url), JSON.stringify(data))
  console.log(`data.json written: ${Object.keys(data.items).length} items, raid ratings: ${data.hasRaid}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
