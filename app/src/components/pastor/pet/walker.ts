import { drawFrame, getSheet, type Anim, type Frame } from './sheet'
import type { PetHat, PetKind, PetLevel } from './settings'

// A pet with a mind of its own, living in a "lane" (a positioned element):
// it walks, stops to work or think, strikes poses, drops thoughts, greets the
// other pets of its group, sleeps, and can be petted or flung. Plain DOM:
// one timer chain per walker and CSS transforms, no per-frame React work.
export type PetMood = 'working' | 'pant' | 'alert' | 'idle' | 'sleep' | 'juggle' | 'workflow' | 'agent'
export type PetEvent = 'sent' | 'done' | 'fail' | 'typing' | 'mail'
export type WalkerOptions = { scale?: number; mood?: PetMood; hat?: PetHat | null; group?: string | null; kind?: PetKind; level?: PetLevel }

const BASE = import.meta.env.BASE_URL
const poseUrl = (n: string) => `${BASE}pets/clawd/${n}.svg`
const POSES: Record<string, string[]> = {
  working: ['working-typing', 'working-tool-calling', 'working-debugger', 'working-testing', 'working-reviewing', 'working-building'],
  pant: ['working-thinking', 'idea', 'confused'],
  alert: ['notification', 'waving', 'peeking'],
  idle: ['coffee', 'reading', 'music', 'peeking', 'meditating', 'idea', 'waving'],
  juggle: ['working-juggling', 'working-wizard'],
  workflow: ['working-wizard', 'working-conducting', 'working-juggling'],
  agent: ['mail', 'working-typing'],
}
const EXTRA_POSES = ['celebrating', 'yawning', 'dizzy', 'waving', 'error', 'facepalm', 'disconnected', 'mail', 'notification', 'working-context-full']
const THOUGHTS: Record<string, string[]> = {
  working: ['⚙️', '📄', '🔍', '🧪', '💡'], pant: ['🤔', '💭', '…'], alert: ['❓', '👋', '!'], idle: ['☕', '🎵', '✨', '👀', '🌱'],
  juggle: ['✍️', '📝'], workflow: ['🪄', '🧩'], agent: ['📱', '💬'],
}
// What a GIF pet "says" instead of striking one of Clawd's poses.
const POSE_EMOJI: Record<string, string> = {
  celebrating: '🎉', facepalm: '🤦', peeking: '👀', mail: '✉️', waving: '👋', dizzy: '💫', yawning: '🥱',
}
// Marc Duiker's pets from vscode-pets (MIT), as GIFs; `w` is their width at scale 1.6.
const PETS: Partial<Record<PetKind, { dir: string; idle: string; walk: string; w: number }>> = {
  crab: { dir: 'crab', idle: 'red_idle', walk: 'red_walk', w: 44 },
  duck: { dir: 'rubber-duck', idle: 'yellow_idle', walk: 'yellow_walk', w: 40 },
  zappy: { dir: 'zappy', idle: 'yellow_idle', walk: 'yellow_walk', w: 40 },
  rocky: { dir: 'rocky', idle: 'gray_idle', walk: 'gray_walk', w: 40 },
}
const gifUrl = (kind: PetKind, walk: boolean) => {
  const p = PETS[kind]!
  return `${BASE}pets/${p.dir}/${walk ? p.walk : p.idle}_8fps.gif`
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]!
const now = () => performance.now()
const groups = new Map<string, Set<Walker>>()
export type PauseReason = 'view' | 'cover' | 'page'
// Every live walker: all of them rest while the app is in the background.
const all = new Set<Walker>()
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    for (const w of all) { if (document.hidden) w.pause('page'); else w.resume('page') }
  })
}
let preloaded = false
function preload() {
  if (preloaded) return
  preloaded = true
  for (const n of new Set([...Object.values(POSES).flat(), ...EXTRA_POSES])) new Image().src = poseUrl(n)
}

type Then = (superseded: boolean) => void

export class Walker {
  readonly el: HTMLDivElement
  mood: PetMood
  kind: PetKind = 'clawd'
  hat: PetHat | null
  level: PetLevel
  x = 0
  y = 0
  w = 0
  busy = false

  private lane: HTMLElement
  private scale: number
  private group: string | null
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private poseImg: HTMLImageElement
  private gif: HTMLImageElement
  private body: HTMLDivElement
  private sayEl: HTMLSpanElement
  private talkEl: HTMLSpanElement
  private extras: HTMLElement[] = []
  // Bumped whenever something takes over: older async steps then stop touching the pet.
  private gen = 0
  private sayGen = 0
  private dead = false
  private paused = false
  private pausedAt = 0
  // The single timer chain: animation frames and every wait share it.
  private timer: ReturnType<typeof setTimeout> | undefined
  private waits: { at: number; fn: () => void }[] = []
  private anim: Anim | null = null
  private ai = 0
  private aThen: Then | undefined
  private frameAt = Infinity
  private lastFrame: Frame | null = null
  private looping = false
  private loopTok = 0
  private pauses = new Set<PauseReason>()
  private bury!: () => void
  // Settles when the walker is destroyed.
  private gone = new Promise<void>(r => { this.bury = r })
  private greeted = 0
  private sleeping = false
  private typingUntil = 0
  private talking: 'think' | 'write' | null = null
  private off: (() => void)[] = []

  constructor(lane: HTMLElement, { scale = 1.6, mood = 'idle', hat = null, group = null, kind = 'clawd', level = 'alive' }: WalkerOptions = {}) {
    this.lane = lane; this.scale = scale; this.mood = mood; this.hat = hat || null; this.group = group; this.level = level
    this.el = document.createElement('div')
    this.el.className = 'pet-wk'
    this.el.innerHTML = '<div class="pet-shadow"></div><div class="pet-body"><canvas></canvas><img class="pet-pose" alt=""><img class="pet-gif" alt=""></div><span class="pet-say"></span><span class="pet-talk"></span>'
    this.canvas = this.el.querySelector('canvas')!
    this.ctx = this.canvas.getContext('2d')!
    this.poseImg = this.el.querySelector('img.pet-pose')!
    this.gif = this.el.querySelector('img.pet-gif')!
    this.body = this.el.querySelector('.pet-body')!
    this.sayEl = this.el.querySelector('.pet-say')!
    this.talkEl = this.el.querySelector('.pet-talk')!
    lane.appendChild(this.el)
    if (group) { if (!groups.has(group)) groups.set(group, new Set()); groups.get(group)!.add(this) }
    this.setKind(kind)
    this.x = rand(0, this.room())
    this.place()
    this.bindPointer()
    all.add(this)
    if (document.hidden) this.pause('page')
    this.start()
  }

  // ---- public ----

  setMood(m: PetMood) {
    if (m === this.mood || this.dead) return
    this.mood = m
    if (this.level === 'still') return this.drawStill()
    this.applyMood()
    if (!this.busy) { this.gen++; this.halt(); this.hidePose(); this.play(this.base()) }
  }

  setKind(kind: PetKind) {
    this.hidePose()
    this.kind = PETS[kind] ? kind : 'clawd'
    const pet = PETS[this.kind]
    this.gif.style.display = pet && this.level !== 'still' ? '' : 'none'
    this.canvas.style.display = pet && this.level !== 'still' ? 'none' : ''
    if (pet) {
      this.w = Math.round(pet.w * this.scale / 1.6)
      this.gif.style.width = `${this.w}px`
      this.gif.src = gifUrl(this.kind, false)
    } else {
      this.w = 24 * this.scale
      this.canvas.width = 24; this.canvas.height = 15
      this.canvas.style.width = `${this.w}px`; this.canvas.style.height = `${15 * this.scale}px`
      this.poseImg.style.width = `${this.w * 1.6}px`
      if (this.level !== 'still') preload()
    }
    const shadow = this.el.querySelector<HTMLElement>('.pet-shadow')!
    shadow.style.width = `${this.w * 0.7}px`; shadow.style.marginLeft = `${-this.w * 0.35}px`
    if (this.x > this.room()) { this.x = this.room(); this.place() }
    if (this.level === 'still') this.drawStill()
    else if (!this.busy) this.play(this.base())
  }

  setHat(hat: PetHat | null) {
    this.hat = hat || null
    if (this.level === 'still') this.drawStill()
    else if (this.lastFrame) this.draw(this.lastFrame)
  }

  setLevel(level: PetLevel) {
    if (level === this.level || this.dead) return
    const was = this.level
    this.level = level
    this.gen++
    this.busy = false
    if (level === 'still') { this.drawStill(); return }
    if (was === 'still') {
      this.el.classList.remove('still')
      this.setKind(this.kind); this.applyMood()
      if (this.talking) this.talkEl.classList.add('on')
    }
    this.halt(); this.hidePose(); this.play(this.base())
    if (level === 'alive') void this.loop()
  }

  // A speech bubble that stays while Claude thinks or writes.
  talk(what: 'think' | 'write' | null) {
    if (what === this.talking) return
    this.talking = what
    if (!what || this.level === 'still') { this.talkEl.classList.remove('on'); return }
    this.talkEl.innerHTML = `${what === 'write' ? 'escribiendo ' : ''}<span class="pet-dots"><i></i><i></i><i></i></span>`
    this.talkEl.classList.add('on')
    this.sayEl.classList.remove('on')
  }

  react(ev: PetEvent) {
    if (this.dead || this.level === 'still') return
    if (ev === 'typing') {
      if (now() < this.typingUntil) return
      this.typingUntil = now() + 10_000
    }
    const g = ++this.gen
    this.busy = true
    this.halt(); this.hidePose()
    if (this.y) { this.y = 0; this.place(200) }
    const run = async () => {
      if (ev === 'sent') {
        await this.oneShot('startle')
        if (g === this.gen) await this.oneShot('hop')
      } else if (ev === 'done') {
        this.floatUp('✨', 'var(--color-warn)')
        await this.pose('celebrating', 1800, g)
      } else if (ev === 'fail') {
        await this.oneShot('fail')
        if (g === this.gen) await this.pose('facepalm', 1600, g)
      } else if (ev === 'typing') {
        this.say('?', 2600)
        await this.walkTo(rand(0, this.room() * 0.2), g)
        if (g === this.gen) await this.pose('peeking', 1400, g)
      } else if (ev === 'mail') {
        // It rides the card that just moved, lands, and reads the message.
        this.y = 14; this.place()
        await this.oneShot('hop')
        this.y = 0; this.place(250)
        if (g === this.gen) await this.pose('mail', 1600, g)
      }
      if (g !== this.gen) return
      this.busy = false
      this.hidePose(); this.applyMood(); this.play(this.base())
    }
    void run()
  }

  // Rest (no timers) for a reason: 'view' (off screen), 'cover' (an overlay
  // hides it), 'page' (the app is in the background). Any reason pauses.
  pause(reason: PauseReason = 'view') {
    if (this.dead) return
    this.pauses.add(reason)
    if (this.paused) return
    this.paused = true
    this.pausedAt = now()
    clearTimeout(this.timer)
  }

  resume(reason: PauseReason = 'view') {
    if (this.dead) return
    this.pauses.delete(reason)
    if (!this.paused || this.pauses.size) return
    this.paused = false
    const shift = now() - this.pausedAt
    if (this.frameAt !== Infinity) this.frameAt += shift
    for (const w of this.waits) w.at += shift
    this.kick()
  }

  destroy() {
    if (this.dead) return
    this.dead = true
    clearTimeout(this.timer)
    this.stopLoop()
    this.flush()
    if (this.group) groups.get(this.group)?.delete(this)
    all.delete(this)
    this.bury()
    for (const f of this.off) f()
    this.off = []
    this.el.remove()
  }

  // Drop every pending wait and one-shot, but let their awaiters go on (they
  // check `dead` / `gen` and stop), so no async step hangs forever.
  private flush() {
    const waits = this.waits, then = this.aThen
    this.waits = []; this.anim = null; this.aThen = undefined; this.frameAt = Infinity
    then?.(true)
    for (const w of waits) w.fn()
  }

  // The current mind loop ends at its next step; a new one may start.
  private stopLoop() {
    this.loopTok++
    this.looping = false
    this.gen++
  }

  // ---- timing ----

  private start() {
    this.applyMood()
    if (this.level === 'still') { this.drawStill(); return }
    this.play(this.base())
    if (this.level === 'alive') void this.loop()
  }

  private kick() {
    clearTimeout(this.timer)
    if (this.dead || this.paused) return
    let next = this.frameAt
    for (const w of this.waits) if (w.at < next) next = w.at
    if (next === Infinity) return
    this.timer = setTimeout(this.tick, Math.max(0, next - now()))
  }

  private tick = () => {
    if (this.dead || this.paused) return
    const t = now() + 4
    if (this.frameAt <= t) this.stepFrame()
    const due = this.waits.filter(w => w.at <= t)
    if (due.length) this.waits = this.waits.filter(w => w.at > t)
    for (const d of due) d.fn()
    this.kick()
  }

  private after(ms: number, fn: () => void) {
    if (this.dead) { fn(); return }
    this.waits.push({ at: now() + ms, fn })
    this.kick()
  }

  private wait(ms: number) { return new Promise<void>(r => this.after(ms, r)) }

  // ---- drawing ----

  private room() { return Math.max(0, this.lane.clientWidth - this.w) }

  private place(dur = 0) {
    this.el.style.transition = dur ? `transform ${Math.round(dur)}ms linear` : 'none'
    this.el.style.transform = `translate3d(${this.x}px, ${-this.y}px, 0)`
    // Its bubbles open toward the middle of the lane.
    this.el.classList.toggle('flip', this.x > this.room() * 0.6)
  }

  // Stop a walk where it is now.
  private halt() {
    if (!this.el.style.transition || this.el.style.transition === 'none') return
    const t = getComputedStyle(this.el).transform
    if (t && t !== 'none') { const m = new DOMMatrixReadOnly(t); this.x = m.m41; this.y = -m.m42 }
    this.place()
  }

  private base(): string {
    return ({ working: 'working', pant: 'pant', alert: 'alert', idle: 'idle', sleep: 'sleep', juggle: 'juggle', workflow: 'juggle', agent: 'working' } as const)[this.mood] ?? 'idle'
  }

  private isGif() { return !!PETS[this.kind] }

  private draw(fr: Frame) {
    this.lastFrame = fr
    drawFrame(this.ctx, fr, { top: 3, hat: this.sleeping && this.kind === 'clawd' ? 'nightcap' : this.hat })
  }

  private play(name: string, then?: Then) {
    if (this.dead || this.level === 'still') return
    const old = this.aThen
    this.aThen = undefined
    this.hidePose()
    if (this.isGif()) {
      this.anim = null; this.frameAt = Infinity
      const src = gifUrl(this.kind, /walk/.test(name))
      if (!this.gif.src.endsWith(src.replace(/^\.\//, ''))) this.gif.src = src
      this.gif.style.transform = /left/.test(name) ? 'scaleX(-1)' : ''
      old?.(true)
      if (then) this.after(700, () => then(false))
      return
    }
    const sheet = getSheet()
    this.anim = sheet.anims[name] ?? sheet.anims.idle ?? null
    this.ai = 0
    this.aThen = then
    this.frameAt = now()
    old?.(true)
    this.kick()
  }

  private stepFrame() {
    const a = this.anim
    if (!a?.frames.length) { this.frameAt = Infinity; return }
    if (this.ai >= a.frames.length) {
      const then = this.aThen
      this.aThen = undefined; this.anim = null; this.frameAt = Infinity
      if (then) then(false); else this.play(this.base())
      return
    }
    const fr = a.frames[this.ai]!
    this.draw(fr)
    this.ai++
    if (this.ai >= a.frames.length && a.loop && !this.aThen) this.ai = 0
    this.frameAt = now() + fr.ms
  }

  // A one-shot animation, then back to the mood's own.
  private oneShot(name: string) {
    return new Promise<void>(resolve => this.play(name, superseded => { if (!superseded) this.play(this.base()); resolve() }))
  }

  private async pose(name: string, ms: number, g: number) {
    if (this.isGif()) { this.say(POSE_EMOJI[name] ?? pick(THOUGHTS[this.mood] ?? THOUGHTS.idle!), ms); await this.wait(ms); return }
    this.poseImg.src = poseUrl(name)
    this.poseImg.style.display = 'block'
    this.canvas.style.visibility = 'hidden'
    await this.wait(ms)
    if (g === this.gen) this.hidePose()
  }

  private hidePose() {
    this.poseImg.style.display = 'none'
    this.canvas.style.visibility = ''
  }

  private say(text: string, ms = 1600) {
    if (this.talking || this.level === 'still') return
    const g = ++this.sayGen
    this.sayEl.textContent = text
    this.sayEl.classList.add('on')
    this.after(ms, () => { if (g === this.sayGen) this.sayEl.classList.remove('on') })
  }

  private extra(kind: 'bang' | 'zz' | null) {
    for (const e of this.extras) e.remove()
    this.extras = []
    if (kind === 'bang') {
      const b = document.createElement('span')
      b.className = 'pet-bang'; b.textContent = '!'
      this.el.appendChild(b); this.extras.push(b)
    }
    if (kind === 'zz') ['z', 'Z'].forEach((t, i) => {
      const e = document.createElement('span')
      e.className = 'pet-zz'; e.textContent = t
      e.style.left = `${this.w * 0.7 + i * 5}px`; e.style.bottom = `${12 + i * 4}px`; e.style.animationDelay = `${i}s`
      this.el.appendChild(e); this.extras.push(e)
    })
  }

  private applyMood() {
    this.sleeping = this.mood === 'sleep'
    this.extra(this.level === 'still' ? null : this.mood === 'alert' ? 'bang' : this.mood === 'sleep' ? 'zz' : null)
  }

  private floatUp(html: string, color?: string) {
    if (this.level === 'still') return
    const el = document.createElement('span')
    el.className = 'pet-float'
    el.innerHTML = html
    if (color) el.style.color = color
    el.style.left = `${this.x + this.w / 2}px`
    el.style.bottom = `${15 * this.scale + this.y}px`
    el.addEventListener('animationend', () => el.remove())
    this.lane.appendChild(el)
  }

  // One frame, no timers: the "still" level and reduced motion.
  private drawStill() {
    clearTimeout(this.timer)
    this.stopLoop()
    this.flush()
    this.busy = false
    // A still pet takes no touches: they go to whatever is under it.
    this.el.classList.add('still')
    this.extra(null); this.hidePose(); this.talkEl.classList.remove('on'); this.sayEl.classList.remove('on')
    this.sleeping = false
    this.el.style.transition = 'none'
    this.gif.style.display = 'none'
    this.canvas.style.display = ''
    const pet = PETS[this.kind]
    if (!pet) {
      this.canvas.width = 24; this.canvas.height = 15
      this.canvas.style.width = `${this.w}px`; this.canvas.style.height = `${15 * this.scale}px`
      const fr = getSheet().anims.idle?.frames[0]
      if (fr) this.draw(fr)
      return
    }
    const img = new Image()
    img.onload = () => {
      if (this.dead || this.level !== 'still') return
      this.canvas.width = img.naturalWidth; this.canvas.height = img.naturalHeight
      this.canvas.style.width = `${this.w}px`; this.canvas.style.height = `${this.w * img.naturalHeight / img.naturalWidth}px`
      this.ctx.drawImage(img, 0, 0)
    }
    img.src = gifUrl(this.kind, false)
  }

  // ---- the mind ----

  private async loop() {
    if (this.looping) return
    this.looping = true
    const tok = this.loopTok
    await this.wait(rand(200, 1500))
    while (!this.dead && this.level === 'alive' && tok === this.loopTok) {
      if (this.busy) { await this.wait(400); continue }
      const g = this.gen
      if (this.mood === 'sleep') { await this.sleepCycle(g); continue }
      const friend = this.greet()
      if (friend) {
        friend.busy = true
        const fg = ++friend.gen
        friend.halt(); this.halt()
        this.floatUp('👋')
        // A friend that goes away mid-wave (unmounted) must not keep this one waiting.
        await Promise.all([this.pose('waving', 1800, g), Promise.race([friend.pose('waving', 1800, fg), friend.gone])])
        if (friend.gen === fg && !friend.dead) { friend.busy = false; friend.play(friend.base()) }
        continue
      }
      const r = Math.random()
      const m = this.mood
      if (r < 0.5) await this.walkTo(rand(0, this.room()), g)
      else if (r < 0.78) await this.pose(pick(POSES[m] ?? POSES.idle!), rand(1800, 3200), g)
      else if (r < 0.9) {
        if (g === this.gen) { this.play(this.base()); if (Math.random() < 0.7) this.say(pick(THOUGHTS[m] ?? THOUGHTS.idle!)) }
        await this.wait(rand(1200, 2400))
      } else await this.oneShot(Math.random() < 0.5 ? 'hop' : 'scrunch')
    }
    if (tok === this.loopTok) this.looping = false
  }

  private async walkTo(to: number, g: number, run = false) {
    const x = Math.max(0, Math.min(this.room(), to))
    const left = x < this.x, dist = Math.abs(x - this.x)
    if (dist < 4 || g !== this.gen) return
    const speed = run ? 70 : this.mood === 'pant' ? 22 : 34
    this.play(`${this.mood === 'pant' || run ? 'pant-walk' : 'walk'}${left ? '-left' : ''}`)
    const ms = (dist / speed) * 1000
    this.x = x
    this.place(ms)
    await this.wait(ms)
    if (g !== this.gen) return
    if (!this.isGif()) await this.oneShot(left ? 'stop-left' : 'stop')
    else this.play(this.base())
  }

  private greet(): Walker | null {
    if (!this.group || this.greeted > Date.now()) return null
    const t = Date.now()
    for (const o of groups.get(this.group) ?? []) {
      if (o !== this && !o.dead && !o.paused && !o.busy && o.level === 'alive' && o.greeted <= t && Math.abs(o.x - this.x) < 46) {
        this.greeted = o.greeted = t + 15_000
        return o
      }
    }
    return null
  }

  private async sleepCycle(g: number) {
    this.applyMood()
    this.play('sleep')
    const until = now() + rand(9000, 16_000)
    while (now() < until && this.mood === 'sleep' && g === this.gen) await this.wait(1000)
    if (g !== this.gen || this.mood !== 'sleep') return
    // Wake up, stretch the legs, and lie down again.
    this.extra(null); this.sleeping = false
    await this.oneShot('wake-up')
    if (g !== this.gen || this.mood !== 'sleep') return
    await this.pose('yawning', 1600, g)
    await this.walkTo(rand(0, this.room()), g)
    if (g === this.gen) await this.oneShot('scrunch')
    if (g === this.gen && Math.random() < 0.5) await this.walkTo(rand(0, this.room()), g)
    if (g !== this.gen || this.mood !== 'sleep') return
    await this.oneShot('lie-down')
  }

  // ---- touch: tap to pet, drag and let go to fling ----

  private bindPointer() {
    const el = this.el
    let start: { x: number; y: number; ox: number; oy: number } | null = null
    let last = { x: 0, y: 0, t: 0, vx: 0, vy: 0 }
    let moved = false
    const stop = (e: Event) => e.stopPropagation()
    const down = (e: PointerEvent) => {
      e.stopPropagation()
      if (this.level === 'still' || this.dead) return
      try { el.setPointerCapture(e.pointerId) } catch { /* gone */ }
      start = { x: e.clientX, y: e.clientY, ox: this.x, oy: this.y }
      last = { x: e.clientX, y: e.clientY, t: now(), vx: 0, vy: 0 }
      moved = false
    }
    const move = (e: PointerEvent) => {
      if (!start) return
      e.stopPropagation()
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return
      if (!moved) {
        moved = true; this.busy = true; this.gen++
        this.halt(); this.hidePose(); this.extra(null); this.play('scrunch')
      }
      const t = now(), dt = Math.max(1, t - last.t)
      last = { x: e.clientX, y: e.clientY, t, vx: ((e.clientX - last.x) / dt) * 16, vy: (-(e.clientY - last.y) / dt) * 16 }
      this.x = Math.max(0, Math.min(this.room(), start.ox + (e.clientX - start.x)))
      this.y = Math.max(0, start.oy - (e.clientY - start.y))
      this.place()
    }
    const up = (e: PointerEvent) => {
      if (!start) return
      e.stopPropagation()
      start = null
      if (!moved) { void this.pet(); return }
      void this.fling(last.vx, last.vy)
    }
    const click = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault() }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('click', click)
    el.addEventListener('contextmenu', click)
    el.addEventListener('touchstart', stop, { passive: true })
    this.off.push(() => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
      el.removeEventListener('click', click); el.removeEventListener('contextmenu', click)
      el.removeEventListener('touchstart', stop)
    })
  }

  private async pet() {
    const g = ++this.gen
    this.busy = true
    this.halt(); this.hidePose()
    if (this.y) { this.y = 0; this.place(200) }
    try { navigator.vibrate?.(10) } catch { /* unsupported */ }
    this.floatUp('❤', '#ff6b80')
    await this.oneShot('hop')
    if (g !== this.gen) return
    this.busy = false
    this.play(this.base())
  }

  private async fling(vx0: number, vy0: number) {
    const g = this.gen
    let vx = Math.max(-14, Math.min(14, vx0)), vy = Math.max(-4, Math.min(16, vy0))
    for (let bounces = 0; ;) {
      await new Promise(requestAnimationFrame)
      if (this.dead || g !== this.gen) return
      vy -= 0.7; this.x += vx; this.y += vy
      const W = this.room()
      if (this.x < 0) { this.x = 0; vx = -vx * 0.6 }
      if (this.x > W) { this.x = W; vx = -vx * 0.6 }
      if (this.y <= 0) {
        this.y = 0
        // Squash on landing.
        this.body.style.transform = 'scale(1.25,.7)'
        this.after(140, () => { this.body.style.transform = '' })
        if (Math.abs(vy) > 3 && bounces < 3) { vy = -vy * 0.4; vx *= 0.7; bounces++ } else break
      }
      this.place()
    }
    this.place()
    try { navigator.vibrate?.(14) } catch { /* unsupported */ }
    await this.pose('dizzy', 1500, g)
    if (g !== this.gen) return
    this.busy = false
    this.applyMood()
    this.play(this.base())
  }
}
