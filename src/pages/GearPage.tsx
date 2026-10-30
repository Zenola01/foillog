import { useMemo, useState, type ReactNode } from 'react'
import { useConfirm } from '../components/Confirm'
import { btnGhost, btnPrimary, btnSecondary, card, Segmented } from '../components/ui'
import { useAuth } from '../lib/auth'
import { gearLabel, gearUse, GEAR_KINDS, kindInfo, sortGear, type GearSession, type GearUse } from '../lib/gear'
import { useGear } from '../lib/gearList'
import { useHistory } from '../lib/history'
import { useLibrary } from '../lib/library'
import { myName, useSettings } from '../lib/settings'
import type { GearItem, GearKind } from '../lib/types'
import { fmtDuration, fmtShortDate, fmtSpeed, SPEED_SHORT, type SpeedUnit } from '../lib/units'

type GearFields = Pick<GearItem, 'kind' | 'name' | 'size'>

/** /attrezzatura — wings, boards and foils, picked later on each session. */
export default function GearPage() {
  const { items, save, inAccount, error: listError } = useGear()
  const { user } = useAuth()
  const { sessions } = useLibrary()
  const { settings } = useSettings()
  const confirm = useConfirm()
  const history = useHistory(user?.id)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  // How much each item was used: your crew sessions, or the ones on this device when signed out.
  const use = useMemo(() => {
    const src: GearSession[] = user
      ? (history ?? []).map((h) => ({ gear: h.gear, start: Date.parse(h.started_at), foilTime: h.foilTime ?? 0, distance: h.distance ?? 0, s10: h.s10 }))
      : (sessions ?? [])
          .filter((s) => !s.demo && s.rider === myName(settings))
          .map((s) => ({ gear: s.gear, start: s.summary.start, foilTime: s.summary.foilTime, distance: s.summary.distance, s10: s.summary.records.s10 }))
    return gearUse(src)
  }, [user, history, sessions, settings])

  const store = async (next: GearItem[]) => {
    setError(null)
    try {
      await save(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e
    }
  }

  if (!items) {
    return listError ? (
      <p className={`${card} p-4 text-sm text-critical`}>{listError}</p>
    ) : (
      <p className="py-16 text-center text-ink-2">Carico l’attrezzatura…</p>
    )
  }
  const active = sortGear(items.filter((g) => !g.retired))
  const retired = sortGear(items.filter((g) => g.retired))
  const row = (g: GearItem) => (
    <GearRow
      key={g.id}
      g={g}
      use={use.get(g.id)}
      unit={settings.speedUnit}
      onSave={(v) => store(items.map((x) => (x.id === g.id ? { ...x, ...v } : x)))}
      onRetire={() => store(items.map((x) => (x.id === g.id ? { ...x, retired: !x.retired } : x)))}
      onDelete={async () => {
        const ok = await confirm(`Eliminare «${gearLabel(g)}»? Le uscite dove l’hai usata continueranno a mostrarla.`, { confirmLabel: 'Elimina', danger: true })
        if (ok) await store(items.filter((x) => x.id !== g.id))
      }}
    />
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Attrezzatura</h1>
        <p className="text-sm text-ink-2">
          Ali, tavole e foil: in ogni uscita scegli cosa hai usato.{' '}
          {inAccount ? 'La lista è nel tuo account, su tutti i tuoi dispositivi.' : 'La lista resta su questo dispositivo finché non entri nella crew.'}
        </p>
      </div>

      {adding || items.length === 0 ? (
        <div className={card}>
          <p className="px-3.5 pt-3.5 font-semibold">Aggiungi</p>
          <GearForm
            submitLabel="Aggiungi"
            onSubmit={async (v) => {
              await store([...items, { id: crypto.randomUUID(), ...v }])
              setAdding(false)
            }}
            onCancel={items.length ? () => setAdding(false) : undefined}
          />
        </div>
      ) : (
        <button type="button" className={btnPrimary} onClick={() => setAdding(true)}>
          Aggiungi attrezzatura
        </button>
      )}
      {error && <p className="text-sm text-critical">{error}</p>}

      {GEAR_KINDS.map((k) => {
        const of = active.filter((g) => g.kind === k.id)
        return of.length ? (
          <GearGroup key={k.id} title={k.plural}>
            {of.map(row)}
          </GearGroup>
        ) : null
      })}
      {retired.length > 0 && <GearGroup title="Non più in uso">{retired.map(row)}</GearGroup>}
    </div>
  )
}

function GearGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={card} aria-label={title}>
      <h2 className="px-3.5 pt-3 text-sm font-semibold">{title}</h2>
      <ul className="divide-y divide-[var(--border)]">{children}</ul>
    </section>
  )
}

function GearRow({
  g,
  use,
  unit,
  onSave,
  onRetire,
  onDelete,
}: {
  g: GearItem
  use: GearUse | undefined
  unit: SpeedUnit
  onSave: (v: GearFields) => Promise<void>
  onRetire: () => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [edit, setEdit] = useState(false)
  if (edit) {
    return (
      <li>
        <GearForm
          initial={g}
          submitLabel="Salva"
          onSubmit={async (v) => {
            await onSave(v)
            setEdit(false)
          }}
          onCancel={() => setEdit(false)}
          extra={
            <>
              <button type="button" className={btnGhost} onClick={() => onRetire().then(() => setEdit(false))}>
                {g.retired ? 'Rimetti in uso' : 'Non più in uso'}
              </button>
              <button type="button" className={`${btnGhost} text-critical`} onClick={onDelete}>
                Elimina
              </button>
            </>
          }
        />
      </li>
    )
  }
  return (
    <li className="flex items-center gap-3 px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{gearLabel(g)}</p>
        <p className="text-sm text-ink-2">
          {use
            ? `${use.sessions === 1 ? '1 uscita' : `${use.sessions} uscite`} · ${fmtDuration(use.foilTime)} in foil${
                use.best10s != null ? ` · max 10 s ${fmtSpeed(use.best10s, unit)} ${SPEED_SHORT[unit]}` : ''
              } · ultima il ${fmtShortDate(use.last)}`
            : 'Non ancora scelta in un’uscita'}
        </p>
      </div>
      <button type="button" className={btnGhost} onClick={() => setEdit(true)} aria-label={`Modifica ${gearLabel(g)}`}>
        Modifica
      </button>
    </li>
  )
}

function GearForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  extra,
}: {
  initial?: GearFields
  submitLabel: string
  onSubmit: (v: GearFields) => Promise<void>
  onCancel?: () => void
  extra?: ReactNode
}) {
  const [kind, setKind] = useState<GearKind>(initial?.kind ?? 'wing')
  const [name, setName] = useState(initial?.name ?? '')
  const [size, setSize] = useState(initial?.size ?? '')
  const [busy, setBusy] = useState(false)
  const k = kindInfo(kind)
  const filled = !!(name.trim() || size.trim())
  const input = 'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-base'
  return (
    <form
      className="space-y-3 p-3.5"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!filled) return
        setBusy(true)
        try {
          await onSubmit({ kind, name: name.trim().slice(0, 60), size: size.trim().slice(0, 30) })
        } catch {
          // Shown by the page.
        } finally {
          setBusy(false)
        }
      }}
    >
      <Segmented label="Tipo" value={kind} onChange={setKind} options={GEAR_KINDS.map((x) => ({ value: x.id, label: x.name }))} />
      <div className="flex flex-wrap gap-2">
        <label className="block min-w-0 flex-[2_1_12rem] text-sm">
          <span className="text-ink-2">Nome</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={k.nameHint} className={input} />
        </label>
        <label className="block min-w-0 flex-[1_1_7rem] text-sm">
          <span className="text-ink-2">Misura{k.unit ? ` (${k.unit})` : ''}</span>
          <input
            value={size}
            onChange={(e) => setSize(e.target.value)}
            maxLength={30}
            inputMode={k.unit ? 'decimal' : 'text'}
            placeholder={k.sizeHint}
            className={input}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={btnPrimary} disabled={!filled || busy}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className={btnSecondary} onClick={onCancel}>
            Annulla
          </button>
        )}
        {extra}
      </div>
    </form>
  )
}
