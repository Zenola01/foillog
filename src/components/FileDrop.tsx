import { useEffect, useMemo, useRef, useState } from 'react'
import { tracksFromPaste } from '../lib/clipboardTracks'
import { isCoarsePointer } from '../lib/theme'
import { IconPaste, IconUpload } from './icons'
import { btnPrimary, card } from './ui'

/**
 * Drag-and-drop on the Mac, file picker on iPhone and iPad. The input has no `accept`
 * filter on purpose: iOS greys out extensions it does not know, such as .vkx.
 * A copied track can also be pasted: ⌘V anywhere on the page, or the paste box on a phone.
 */
export function FileDrop({ onFiles, compact }: { onFiles: (files: File[]) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const coarse = useMemo(isCoarsePointer, [])
  const onFilesRef = useRef(onFiles)
  onFilesRef.current = onFiles

  // ⌘V anywhere on the page, unless it is meant for a text field; clipboards without a track are left alone.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || !e.clipboardData) return
      if ((e.target as Element | null)?.closest?.('input, textarea, [contenteditable="true"]')) return
      const files = tracksFromPaste(e.clipboardData)
      if (!files.length) return
      e.preventDefault()
      setHint(null)
      onFilesRef.current(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

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
        <span className="hidden md:inline"> o trascinarli qui</span>.
      </p>
      <button type="button" className={`${btnPrimary} mt-1`} onClick={() => input.current?.click()}>
        Scegli i file
      </button>
      {/* An empty editable box: on iPhone a long press on it offers «Incolla», which hands over the
          copied file. No keyboard (inputmode none), and nothing typed stays in it. */}
      <div className="relative mt-1 w-full max-w-xs">
        <div
          contentEditable
          inputMode="none"
          role="textbox"
          aria-label="Incolla qui una traccia copiata"
          onPaste={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const files = tracksFromPaste(e.clipboardData)
            if (files.length) {
              setHint(null)
              onFiles(files)
            } else
              setHint(
                'Negli appunti non c’è una traccia. In Vakaros tocca Condividi e poi Copia; se non funziona, usa il comando rapido «FoilLog» (guida in Impostazioni).',
              )
          }}
          onInput={(e) => {
            e.currentTarget.textContent = ''
          }}
          className="min-h-11 w-full cursor-text rounded-xl border border-dashed border-[var(--axis)] text-transparent caret-transparent outline-none focus:border-[var(--accent-text)]"
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 px-3 text-sm font-medium text-ink-2">
          <IconPaste width={18} height={18} />
          {coarse ? 'Tieni premuto qui e scegli Incolla' : 'Oppure incolla una traccia copiata (⌘V)'}
        </span>
      </div>
      {hint && <p className="max-w-md text-xs text-ink-2">{hint}</p>}
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
