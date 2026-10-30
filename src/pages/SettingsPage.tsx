import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useConfirm } from '../components/Confirm'
import { btnPrimary, btnSecondary, card, Segmented } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useLibrary } from '../lib/library'
import { useSettings } from '../lib/settings'
import { fmtNum, fromUnit, MS_TO_KN, SPEED_SHORT, toUnit } from '../lib/units'

export default function SettingsPage() {
  const { settings, update } = useSettings()
  const { sessions, removeAll, reanalyzeAll } = useLibrary()
  const { user, profile, signOut, rename } = useAuth()
  const [accountError, setAccountError] = useState<string | null>(null)
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(settings.riderName)

  // Recompute stored summaries a moment after the threshold stops changing.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const id = setTimeout(async () => {
      setBusy(true)
      try {
        await reanalyzeAll(settings.foilOnKn)
      } finally {
        setBusy(false)
      }
    }, 700)
    return () => clearTimeout(id)
  }, [settings.foilOnKn, reanalyzeAll])

  const thrInUnit = toUnit(settings.foilOnKn / MS_TO_KN, settings.speedUnit)
  const u = SPEED_SHORT[settings.speedUnit]

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Impostazioni</h1>

      <section className={`${card} space-y-3 p-4`}>
        <h2 className="text-base font-semibold">Account e crew</h2>
        {user ? (
          <>
            <label className="block text-sm">
              <span className="font-semibold">Il tuo nome nella crew</span>
              <input
                key={profile?.display_name}
                defaultValue={profile?.display_name ?? ''}
                maxLength={40}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== profile?.display_name) rename(v).catch((err: Error) => setAccountError(err.message))
                }}
                className="mt-2 w-full max-w-xs rounded-lg border border-line bg-surface px-3 py-2 text-base"
              />
            </label>
            <p className="text-sm text-ink-2">Accesso fatto come {user.email}.</p>
            {accountError && <p className="text-sm text-critical">{accountError}</p>}
            <div className="flex flex-wrap gap-2">
              <Link to="/crew" className={btnSecondary}>
                Le tue crew
              </Link>
              <button type="button" className={btnSecondary} onClick={() => signOut()}>
                Esci
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-2">Con un account gratuito condividi le uscite con la tua crew.</p>
            <Link to="/accedi" className={btnPrimary}>
              Entra o crea un account
            </Link>
          </>
        )}
      </section>

      <Link to="/attrezzatura" className={`${card} flex items-center gap-3 p-4`}>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold">Attrezzatura</span>
          <span className="block text-sm text-ink-2">Ali, tavole e foil da scegliere in ogni uscita</span>
        </span>
        <span aria-hidden className="text-accent">
          →
        </span>
      </Link>

      <section className={`${card} divide-y divide-[var(--border)]`}>
        {!user && (
          <label className="block p-4">
            <span className="text-sm font-semibold">Il tuo nome</span>
            <span className="block text-sm text-ink-2">Compare come rider sulle tue uscite e nei confronti.</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => update({ riderName: name.trim() })}
              placeholder="Io"
              className="mt-2 w-full max-w-xs rounded-lg border border-line bg-surface px-3 py-2 text-base"
            />
          </label>
        )}
        <div className="space-y-2 p-4">
          <p className="text-sm font-semibold">Velocità</p>
          <Segmented
            label="Unità di velocità"
            value={settings.speedUnit}
            onChange={(v) => update({ speedUnit: v })}
            options={[
              { value: 'kn', label: 'Nodi' },
              { value: 'kmh', label: 'km/h' },
              { value: 'ms', label: 'm/s' },
            ]}
          />
        </div>
        <div className="space-y-2 p-4">
          <p className="text-sm font-semibold">Distanze</p>
          <Segmented
            label="Unità di distanza"
            value={settings.distUnit}
            onChange={(v) => update({ distUnit: v })}
            options={[
              { value: 'km', label: 'Chilometri' },
              { value: 'nm', label: 'Miglia nautiche' },
            ]}
          />
        </div>
        <div className="space-y-2 p-4">
          <p className="text-sm font-semibold">
            Soglia del foil: {fmtNum(thrInUnit, settings.speedUnit === 'ms' ? 1 : 0)} {u}
          </p>
          <p className="text-sm text-ink-2">
            Sopra questa velocità (tenuta per 3 secondi) sei considerato in volo. Abbassala se usi attrezzatura grande e decolli piano.
          </p>
          <input
            type="range"
            min={4}
            max={14}
            step={0.5}
            value={settings.foilOnKn}
            onChange={(e) => update({ foilOnKn: Number(e.target.value) })}
            aria-label="Soglia del foil"
            className="w-full max-w-sm accent-[var(--series-1)]"
          />
          {busy && <p className="text-sm text-ink-2">Ricalcolo le uscite…</p>}
          <p className="text-xs text-ink-2">
            Equivale a {fmtNum(settings.foilOnKn, 1)} nodi · {fmtNum(toUnit(fromUnit(settings.foilOnKn, 'kn'), 'kmh'), 0)} km/h.
          </p>
        </div>
      </section>

      <section className={`${card} space-y-4 p-4 text-sm`}>
        <h2 className="text-base font-semibold">Come caricare i file</h2>
        <div className="space-y-1.5">
          <p className="font-semibold">Dal Vakaros</p>
          <p className="text-ink-2">
            Nell'app Vakaros Connect apri la sezione delle sessioni, scarica l'uscita dallo strumento e scegli Esporta, formato VKX
            (oppure CSV): il VKX contiene anche sbandamento e beccheggio. Poi:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-ink-2">
            <li>
              sull'iPhone, senza salvare il file: Condividi → <b className="text-ink">FoilLog</b> (il comando rapido qui sotto), poi in
              FoilLog tocca <b className="text-ink">Incolla</b>;
            </li>
            <li>oppure salva il file in File e caricalo con «Scegli i file»;</li>
            <li>sul Mac puoi anche copiare il file e incollarlo in FoilLog con ⌘V.</li>
          </ul>
        </div>
        <div className="space-y-1.5">
          <p className="font-semibold">Il comando rapido «FoilLog»</p>
          <p className="text-ink-2">
            L'iPhone non lascia comparire le web app nel menu Condividi e non passa loro i file copiati. Un comando rapido sì: copia la
            traccia come testo, che FoilLog sa sempre incollare. Si prepara una volta sola, nell'app Comandi:
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-ink-2">
            <li>tocca + e chiama il nuovo comando «FoilLog»;</li>
            <li>
              nei dettagli del comando (icona ⓘ) attiva <b className="text-ink">Mostra nel foglio di condivisione</b>;
            </li>
            <li>
              aggiungi l'azione che codifica in <b className="text-ink">base64</b> (cercala scrivendo «base64») e fai codificare l'input del
              comando rapido;
            </li>
            <li>
              aggiungi l'azione <b className="text-ink">Copia negli appunti</b>;
            </li>
            <li>se vuoi, aggiungi «Mostra notifica» con il testo «Traccia copiata: apri FoilLog e tocca Incolla».</li>
          </ol>
          <p className="text-ink-2">
            Da Vakaros allora tocchi Condividi e poi «FoilLog» (nell'elenco delle azioni, in fondo al menu); apri FoilLog e tocca Incolla. Se
            non lo trovi, in fondo al menu Condividi tocca «Modifica azioni» e aggiungilo.
          </p>
        </div>
        <div>
          <p className="font-semibold">Dall'Apple Watch o dall'iPhone</p>
          <p className="text-ink-2">
            Usa un'app che esporta in GPX, per esempio WorkOutDoors o Waterspeed, oppure HealthFit per gli allenamenti già salvati in
            Salute. Esporta in GPX, salva in File e caricalo qui. Da Strava puoi scaricare il GPX delle tue attività dal sito.
          </p>
        </div>
        <div>
          <p className="font-semibold">Installa FoilLog su iPhone e iPad</p>
          <p className="text-ink-2">
            Apri questa pagina in Safari, tocca Condividi e poi «Aggiungi alla schermata Home». FoilLog si aprirà a tutto schermo come
            un'app, anche senza connessione.
          </p>
        </div>
      </section>

      <section className={`${card} space-y-3 p-4 text-sm`}>
        <h2 className="text-base font-semibold">I tuoi dati</h2>
        <p className="text-ink-2">
          Su questo dispositivo ci sono {sessions?.length ?? 0} uscite. Quelle condivise con la crew stanno anche sul server della crew
          (Supabase) e le vedono solo i membri delle tue crew. Per stimare il vento, FoilLog invia a Open-Meteo la zona (arrotondata a circa
          1 km) e l'orario dell'uscita.
        </p>
        <button
          type="button"
          className={`${btnSecondary} text-critical`}
          disabled={!sessions?.length}
          onClick={async () => {
            if (await confirm('Eliminare tutte le uscite da questo dispositivo? Quelle condivise restano nella crew.', { confirmLabel: 'Elimina', danger: true }))
              await removeAll()
          }}
        >
          Elimina le uscite da questo dispositivo
        </button>
      </section>

      <section className="space-y-1 px-1 pb-4 text-xs text-ink-2">
        <p>
          Mappe © <a href="https://www.openstreetmap.org/copyright" className="underline">OpenStreetMap</a>, tiles{' '}
          <a href="https://openfreemap.org" className="underline">OpenFreeMap</a>. Vento:{' '}
          <a href="https://open-meteo.com" className="underline">Open-Meteo</a> (CC BY 4.0). Grafici: Apache ECharts. Mappe: MapLibre.
        </p>
        <p>FoilLog {__APP_VERSION__}</p>
      </section>
    </div>
  )
}
