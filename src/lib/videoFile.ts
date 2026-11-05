import type { Conversion } from 'mediabunny'
import { videoStart } from './videoData'

// Reading and writing video files, entirely in the browser: videos stay on the device. The library
// is large, so it is only loaded when a video is actually opened.

/** Longest side of the exported video (px): plenty for a phone, and quick to make and to share. */
const EXPORT_LONG_SIDE = 1920
/** Its bitrate (bit/s). Set outright: left to a quality level, choppy water takes 45 Mbit/s. */
const EXPORT_BITRATE = 10_000_000

export interface VideoInfo {
  /** Start on the track's clock (ms), when it can be worked out. */
  start: number | null
  duration: number
  width: number
  height: number
}

export async function readVideoInfo(file: File, session: [number, number]): Promise<VideoInfo> {
  const mb = await import('mediabunny')
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS })
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video) throw new Error('Questo file non contiene un video.')
    const [tags, duration, width, height] = await Promise.all([input.getMetadataTags(), input.computeDuration(), video.getDisplayWidth(), video.getDisplayHeight()])
    const raw = tags.raw?.['com.apple.quicktime.creationdate']
    return {
      start: videoStart({ creationDate: typeof raw === 'string' ? raw : null, date: tags.date ?? tags.creationTime }, file.lastModified, duration, session),
      duration,
      width,
      height,
    }
  } finally {
    input.dispose()
  }
}

/** Export size: the same shape, at most EXPORT_LONG_SIDE, in even numbers as H.264 requires. */
export function exportSize(width: number, height: number): [number, number] {
  const scale = Math.min(1, EXPORT_LONG_SIDE / Math.max(width, height))
  const even = (v: number) => Math.max(2, Math.round((v * scale) / 2) * 2)
  return [even(width), even(height)]
}

type Ctx2D = OffscreenCanvasRenderingContext2D

export interface VideoExport {
  /** The new file once made, or null if cancelled. Rejects if it fails. */
  done: Promise<File | null>
  cancel: () => void
}

/** Writes a new video with `draw` painted over every frame; `seconds` is the frame's time in the video. */
export function exportVideo(
  file: File,
  info: Pick<VideoInfo, 'width' | 'height'>,
  draw: (ctx: Ctx2D, w: number, h: number, seconds: number) => void,
  onProgress: (share: number) => void,
): VideoExport {
  let conversion: Conversion | null = null
  let cancelled = false
  const run = async (): Promise<File | null> => {
    const mb = await import('mediabunny')
    const [w, h] = exportSize(info.width, info.height)
    const codec = await mb.getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: w, height: h })
    if (!codec) throw new Error('Questo browser non riesce a creare video.')
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')!
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS })
    const target = new mb.BufferTarget()
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target })
    try {
      conversion = await mb.Conversion.init({
        input,
        output,
        tracks: 'primary',
        video: {
          width: w,
          height: h,
          fit: 'fill',
          codec,
          quality: new mb.Quality({ bitrate: EXPORT_BITRATE }),
          forceTranscode: true,
          process: (sample) => {
            sample.draw(ctx, 0, 0, w, h)
            draw(ctx, w, h, sample.timestamp)
            return canvas
          },
        },
        audio: { codec: 'aac' },
        showWarnings: false,
      })
      if (!conversion.isValid) throw new Error('Questo browser non riesce a leggere il formato di questo video.')
      if (cancelled) return null
      conversion.onProgress = onProgress
      await conversion.execute()
    } catch (e) {
      if (cancelled) return null
      throw e
    } finally {
      input.dispose()
    }
    const name = `${file.name.replace(/\.[^.]+$/, '')} con dati.mp4`
    return new File([target.buffer!], name, { type: 'video/mp4' })
  }
  return {
    done: run(),
    cancel: () => {
      cancelled = true
      void conversion?.cancel()
    },
  }
}
