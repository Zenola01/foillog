import { toGpx } from './parsers/gpx'
import { simulate, type SimLeg, type SimTurn } from './sim'
import type { ModelWind } from './types'

// Two example riders on the same afternoon in the open middle of Lake Garda, wind from SSW.
// They run through the regular file import, so the demo exercises the real pipeline.
const WIND = 200
const START: [number, number] = [45.605, 10.64]

function session(skill: { speed: number; jibeFail: number[]; tackFail: number[] }) {
  const legs: SimLeg[] = []
  const turns: Record<number, SimTurn> = {}
  const add = (twa: number, seconds: number, kn: number) => legs.push({ twa, seconds, kn: kn * skill.speed })
  for (let round = 0; round < 3; round++) {
    const v = round * 0.6
    add(95, 55, 19 + v)
    add(-100, 55, 20 + v)
    add(95, 50, 19.5)
    add(55, 45, 15.5 + v / 2)
    add(-55, 45, 15)
    add(55, 40, 15.5)
    add(-52, 45, 15 + v / 2)
    add(-140, 40, 19 + v)
    add(140, 40, 20)
    add(-140, 40, 19.5 + v)
  }
  add(100, 60, 21)
  add(-95, 50, 19)
  for (const k of skill.jibeFail) turns[k] = { minKn: 2.5, seconds: 16 }
  for (const k of skill.tackFail) turns[k] = { minKn: 2, seconds: 14 }
  return { legs, turns }
}

export function demoFiles(t0: number): { name: string; gpx: string; friend: boolean }[] {
  const me = session({ speed: 1, jibeFail: [8, 18], tackFail: [4, 14, 24] })
  const friend = session({ speed: 1.05, jibeFail: [1, 9, 19, 28], tackFail: [3, 5, 13, 15] })
  const a = simulate({ start: START, t0, windFrom: WIND, ...me, noiseM: 1.2, seed: 21, wobble: true, heartRate: true })
  const b = simulate({
    start: [START[0] + 0.0012, START[1] + 0.002],
    t0: t0 + 90_000,
    windFrom: WIND,
    ...friend,
    noiseM: 1.2,
    seed: 42,
    wobble: true,
  })
  return [
    { name: 'esempio-garda.gpx', gpx: toGpx(a, { name: 'Esempio · Lago di Garda', creator: 'FoilLog esempio' }), friend: false },
    { name: 'esempio-garda-amico.gpx', gpx: toGpx(b, { name: 'Esempio · Lago di Garda', creator: 'FoilLog esempio' }), friend: true },
  ]
}

/** The weather "model" for the demo agrees with the simulated wind. */
export const demoModelWind: ModelWind = { dir: WIND + 8, speed: 8, gust: 10.5, hourly: [], label: 'esempio' }

/** Yesterday at 14:00, local time. */
export function demoStartTime(): number {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  d.setHours(14, 0, 0, 0)
  return d.getTime()
}
