import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitsSpec, tier, tierPieceFor, parseMurlok, pickRaidPseudo, usagePct } from './build.mjs'

const SHADOW = { id: 258, classId: 5, primary: 'int', armor: 1 }
const ARMS = { id: 71, classId: 1, primary: 'str', armor: 4 }
const HOLY_PAL = { id: 65, classId: 2, primary: 'int', armor: 4 }
const PROT_PAL = { id: 66, classId: 2, primary: 'str', armor: 4 }
const FROST_MAGE = { id: 64, classId: 8, primary: 'int', armor: 1 }
const WEAPON_SPECS = [
  { itemClass: 2, itemSubClass: 7, specsCanDrop: [64, 71] }, // 1H sword
  { itemClass: 4, itemSubClass: 6, specsCanDrop: [65, 66, 73] }, // shield
]
const stats = (...ids) => ids.map((id) => ({ id, alloc: 1 }))

test('cloth int chest fits Shadow, not Arms', () => {
  const chest = { itemClass: 4, itemSubClass: 1, inventoryType: 5, stats: stats(5, 32) }
  assert.equal(fitsSpec(chest, SHADOW, WEAPON_SPECS), true)
  assert.equal(fitsSpec(chest, ARMS, WEAPON_SPECS), false)
})

test('plate str/int shoulders fit Arms and Holy Paladin, not Shadow', () => {
  const shoulders = { itemClass: 4, itemSubClass: 4, inventoryType: 3, stats: stats(74, 36) }
  assert.equal(fitsSpec(shoulders, ARMS, WEAPON_SPECS), true)
  assert.equal(fitsSpec(shoulders, HOLY_PAL, WEAPON_SPECS), true)
  assert.equal(fitsSpec(shoulders, SHADOW, WEAPON_SPECS), false)
})

test('ring without primary stat fits everyone', () => {
  const ring = { itemClass: 4, itemSubClass: 0, inventoryType: 11, stats: stats(32, 49) }
  for (const spec of [SHADOW, ARMS, HOLY_PAL]) assert.equal(fitsSpec(ring, spec, WEAPON_SPECS), true)
})

test('shield with str and int uses weapon-specs drop list', () => {
  const shield = { itemClass: 4, itemSubClass: 6, inventoryType: 14, stats: stats(4, 5, 36) }
  assert.equal(fitsSpec(shield, PROT_PAL, WEAPON_SPECS), true)
  assert.equal(fitsSpec(shield, SHADOW, WEAPON_SPECS), false)
})

test('int 1H sword: Frost Mage yes, Arms no (primary), unknown weapon type no', () => {
  const sword = { itemClass: 2, itemSubClass: 7, inventoryType: 13, stats: stats(5, 32) }
  assert.equal(fitsSpec(sword, FROST_MAGE, WEAPON_SPECS), true)
  assert.equal(fitsSpec(sword, ARMS, WEAPON_SPECS), false)
  assert.equal(fitsSpec({ ...sword, itemSubClass: 99 }, FROST_MAGE, WEAPON_SPECS), false)
})

test('trinket with specs uses the list; class-locked tier piece respects allowableClasses', () => {
  const trinket = { itemClass: 4, itemSubClass: 0, inventoryType: 12, specs: [258], stats: stats(5) }
  assert.equal(fitsSpec(trinket, SHADOW, WEAPON_SPECS), true)
  assert.equal(fitsSpec(trinket, FROST_MAGE, WEAPON_SPECS), false)
  const piece = { itemClass: 4, itemSubClass: 1, inventoryType: 1, allowableClasses: [5], stats: stats(5) }
  assert.equal(fitsSpec(piece, SHADOW, WEAPON_SPECS), true)
  assert.equal(fitsSpec(piece, HOLY_PAL, WEAPON_SPECS), false)
})

test('unknown stat ids and missing stats do not throw', () => {
  const trash = { itemClass: 4, itemSubClass: 1, inventoryType: 3, stats: stats(24, 25) }
  assert.equal(fitsSpec(trash, SHADOW, WEAPON_SPECS), true)
  assert.equal(fitsSpec({ itemClass: 4, itemSubClass: 0, inventoryType: 2 }, ARMS, WEAPON_SPECS), true)
})

test('tier thresholds', () => {
  assert.deepEqual([50, 49.9, 25, 10, 9.9, 0.1, 0].map(tier), ['S', 'A', 'A', 'B', 'C', 'C', ''])
})

test('tierPieceFor picks the class piece and throws when missing', () => {
  const byId = new Map([
    [1, { id: 1, allowableClasses: [5] }],
    [2, { id: 2, allowableClasses: [8] }],
    [3, { id: 3, allowableClasses: [9] }],
  ])
  const token = { id: 100, contains: [1, 2, 3] }
  assert.equal(tierPieceFor(token, 8, byId).id, 2)
  assert.throws(() => tierPieceFor(token, 1, byId), /no tier piece/)
})

test('parseMurlok reads gear counts and stops at the first non-gear section', () => {
  const li = (id, n) =>
    `<li class="vi-poppable"><a href="https://www.wowhead.com/item=${id}"><h4 class="h3">X</h4>` +
    `<svg viewBox="0 0 24 24"> <path fill="currentColor" d="M12,4A4,4 0 0,1 16,8Z" /> </svg> ${n}</a></li>`
  const html =
    `<h3>Talent Build</h3>${li(9, 50)}` +
    `<h3>Head</h3><ol>${li(1, 46)}${li(2, 4)}</ol>` +
    `<h3>Rings</h3><ol>${li(3, 23)}</ol>` +
    `<h3>Embellishments</h3>${li(4, 30)}` +
    `<h3>Head</h3>${li(5, 50)}`
  assert.deepEqual([...parseMurlok(html)], [[1, 46], [2, 4], [3, 23]])
})

test('pickRaidPseudo selects the active season raid list', () => {
  const instances = [
    { id: -91, type: 'raid', name: 'Season 1 Raids' },
    { id: -102, type: 'raid', name: 'Season 2 Raids' },
  ]
  assert.equal(pickRaidPseudo(instances, 'Midnight Season 2').id, -102)
  assert.throws(() => pickRaidPseudo(instances, 'Midnight Season 3'))
})

test('usagePct counts each player once per item', () => {
  const usage = usagePct([new Set([1, 2]), new Set([1]), new Set([1, 3]), new Set()])
  assert.deepEqual([...usage], [[1, 75], [2, 25], [3, 25]])
})
