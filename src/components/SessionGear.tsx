import { useState } from 'react'
import { Link } from 'react-router-dom'
import { currentGear, gearLabel, GEAR_KINDS, lastGear, sizeText, sortGear, toSessionGear } from '../lib/gear'
import { useGear } from '../lib/gearList'
import type { SessionGear as Gear } from '../lib/types'
import { btnGhost, btnPrimary, btnSecondary, card } from './ui'

/** The gear a session was sailed with; the rider picks it from their list. */
export function SessionGear({
  gear,
  editable,
  start,
  past,
  onSave,
}: {
  gear: Gear[]
  editable: boolean
  start: number
  /** The rider's other sessions, for «same as last time». */
  past: { start: number; gear?: Gear[] | null }[] | null
  onSave: (gear: Gear[]) => Promise<void>
}) {
  const { items, error: listError } = useGear()
  const [draft, setDraft] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const list = items ?? []
  const shown = editable ? currentGear(gear, list) : sortGear(gear)
  if (!editable && shown.length === 0) return null

  if (draft == null) {
    return (
      <div className={`${card} flex items-start gap-3 p-3.5`}>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-ink-2">Attrezzatura</p>
          {shown.length ? <p className="font-semibold">{shown.map(gearLabel).join(' · ')}</p> : <p className="text-sm text-ink-2">Non indicata</p>}
        </div>
        {editable && (
          <button type="button" className={btnGhost} onClick={() => setDraft(shown.map((g) => g.id))}>
            {shown.length ? 'Cambia' : 'Scegli'}
          </button>
        )}
      </div>
    )
  }

  // What can be picked: the gear still in use, plus whatever this session already has.
  const choices = sortGear([...list.filter((g) => !g.retired).map(toSessionGear), ...shown.filter((g) => !list.some((x) => x.id === g.id && !x.retired))])
  const last = past ? lastGear(past, start, list) : []
  const toggle = (id: string) => setDraft((d) => (d!.includes(id) ? d!.filter((x) => x !== id) : [...d!, id]))
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSave(choices.filter((g) => draft.includes(g.id)))
      setDraft(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`${card} space-y-3 p-3.5`}>
      <p className="font-semibold">Che attrezzatura hai usato?</p>
      {listError && <p className="text-sm text-critical">{listError}</p>}
      {choices.length === 0 ? (
        <p className="text-sm text-ink-2">
          Prima inserisci ali, tavole e foil nella pagina{' '}
          <Link to="/attrezzatura" className="font-medium text-accent">
            Attrezzatura
          </Link>
          : poi qui scegli cosa hai usato.
        </p>
      ) : (
        GEAR_KINDS.map((k) => {
          const of = choices.filter((g) => g.kind === k.id)
          if (!of.length) return null
          return (
            <div key={k.id} role="group" aria-label={k.plural}>
              <p className="mb-1.5 text-xs text-ink-2">{k.plural}</p>
              <div className="flex flex-wrap gap-2">
                {of.map((g) => {
                  const on = draft.includes(g.id)
                  return (
                    <button
                      key={g.id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(g.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                        on ? 'border-transparent bg-accent-btn text-white' : 'border-line bg-surface text-ink hover:bg-surface-2'
                      }`}
                    >
                      {on && <span aria-hidden>✓</span>}
                      {g.name.trim() || k.name}
                      {sizeText(g) && <span className={on ? 'text-white/80' : 'text-ink-2'}>{sizeText(g)}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })
      )}
      {error && <p className="text-sm text-critical">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {choices.length > 0 && (
          <button type="button" className={btnPrimary} disabled={busy} onClick={save}>
            Salva
          </button>
        )}
        <button type="button" className={btnSecondary} disabled={busy} onClick={() => setDraft(null)}>
          Annulla
        </button>
        {last.length > 0 && (
          <button type="button" className={btnGhost} onClick={() => setDraft(last.map((g) => g.id))}>
            Come l’ultima uscita
          </button>
        )}
        <Link to="/attrezzatura" className={btnGhost}>
          {choices.length ? 'Gestisci l’attrezzatura' : 'Aggiungi attrezzatura'}
        </Link>
      </div>
    </div>
  )
}
