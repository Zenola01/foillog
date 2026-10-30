import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { fileNameOnly, readClipboard, tracksFromPaste } from '../lib/clipboardTracks'
import { isCoarsePointer } from '../lib/theme'
import { IconPaste, IconUpload } from './icons'
import { btnPrimary, btnSecondary, card } from './ui'

/** Why a paste brought no track. */
type Miss = { kind: 'none' } | { kind: 'name'; name: string } | { kind: 'denied' }

/**
 * Drag-and-drop on the Mac, file picker on iPhone and iPad. The input has no `accept`
 * filter on purpose: iOS greys out extensions it does not know, such as .vkx.
 * A copied track can also be pasted: the Incolla button, or ⌘V anywhere on the page.
 */
export function FileDrop({ onFiles, compact }: { onFiles: (files: File[]) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [miss, setMiss] = useState<Miss | null>(null)
  const [reading, setReading] = useState(false)
  const coarse = useMemo(isCoarsePointer, [])
  const onFilesRef = useRef(onFiles)
  onFilesRef.current = onFiles

  const take = (files: File[], name: string | null) => {
    if (files.length) {
      setMiss(null)
      onFilesRef.current(files)
    } else setMiss(name ? { kind: 'name', name } : { kind: 'none' })
  }

  // ⌘V anywhere on the page, unless it is meant for a text field; clipboards without a track are left alone.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || !e.clipboardData) return
      if ((e.target as Element | null)?.closest?.('input, textarea, [contenteditable="true"]')) return
      const files = tracksFromPaste(e.clipboardData)
      const name = files.length ? null : fileNameOnly(e.clipboardData.getData('text/plain'))
      if (!files.length && !name) return
      e.preventDefault()
      take(files, name)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const paste = async () => {
    setReading(true)
    try {
      const { files, name } = await readClipboard()
      take(files, name)
    } catch {
      setMiss({ kind: 'denied' })
    } finally {
      setReading(false)
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const files = [...e.dataTransfer.files]
        if (files.length) onFiles(files)
      }}
      className={`${card} ${over ? 'ring-2 ring-[var(--series-1)]' : ''} flex flex-col items-center gap-2 px-5 ${compact ? 'py-4' : 'py-7'} text-center`}
    >
      {!compact && (
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-accent">
          <IconUpload />
        </span>
      )}
      <p className="font-semibold">Carica le tue uscite</p>
      <p className="max-w-md text-sm text-ink-2">
        File GPX (Apple Watch, iPhone, Strava), VKX o CSV (Vakaros). Puoi sceglierne più di uno insieme
        <span className="hidden md:inline">, trascinarli qui o incollarli (⌘V)</span>.
      </p>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        <button type="button" className={btnPrimary} onClick={() => input.current?.click()}>
          Scegli i file
        </button>
        <button type="button" className={btnSecondary} onClick={paste} disabled={reading}>
          <IconPaste width={18} height={18} />
          Incolla
        </button>
      </div>
      {miss && (
        <p className="max-w-md text-xs text-ink-2" role="status">
          {miss.kind === 'name' ? (
            `Questo browser ha incollato solo il nome del file «${miss.name}», non il contenuto: trascina il file qui oppure usa «Scegli i file».`
          ) : miss.kind === 'denied' ? (
            'FoilLog non ha potuto leggere gli appunti: tocca Incolla e poi conferma «Incolla» nel fumetto che compare.'
          ) : coarse ? (
            <>
              Negli appunti non c’è una traccia: l’iPhone non passa alle web app i file copiati. Usa il comando rapido «FoilLog» (da Vakaros:
              Condividi → FoilLog), poi torna qui e tocca Incolla.{' '}
              <Link to="/impostazioni" className="font-medium text-accent">
                Come prepararlo
              </Link>
            </>
          ) : (
            'Negli appunti non c’è una traccia: copia il file e riprova, oppure trascinalo qui.'
          )}
        </p>
      )}
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </div>
  )
}
