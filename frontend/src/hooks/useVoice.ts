import { useSyncExternalStore } from 'react'

/**
 * Voz para conductores: lectura en voz alta (speechSynthesis) y dictado (SpeechRecognition).
 * Estado a nivel de módulo para que cualquier callback/intervalo pueda llamar speak().
 */
const KEY = 'driver_voice_enabled'
let enabled = false
try { enabled = localStorage.getItem(KEY) === '1' } catch {}
let lastText = ''
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

export const voiceSupported =
  typeof window !== 'undefined' && 'speechSynthesis' in window

const SR: any =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null
export const dictationSupported = !!SR

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices()
  return (
    voices.find(v => v.lang === 'es-CO') ||
    voices.find(v => v.lang.startsWith('es-419') || v.lang === 'es-MX' || v.lang === 'es-US') ||
    voices.find(v => v.lang.startsWith('es'))
  )
}

/** Dice el texto en voz alta si la voz está activada (o si force = true). */
export function speak(text: string, opts: { force?: boolean; interrupt?: boolean } = {}) {
  if (!voiceSupported || !text) return
  if (!enabled && !opts.force) return
  lastText = text
  try {
    if (opts.interrupt) window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'es-CO'
    const v = pickVoice()
    if (v) u.voice = v
    u.rate = 1
    window.speechSynthesis.speak(u)
  } catch {}
}

export function repeatLast() {
  if (lastText) speak(lastText, { force: true, interrupt: true })
}

export function setVoiceEnabled(on: boolean) {
  enabled = on
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch {}
  if (!on && voiceSupported) window.speechSynthesis.cancel()
  emit()
  // El toque del usuario desbloquea el audio en móviles
  if (on) speak('Voz activada', { force: true, interrupt: true })
}

/** Escucha una frase y devuelve el texto dictado. */
export function listenOnce(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!SR) { reject(new Error('Tu navegador no soporta dictado por voz')); return }
    try { window.speechSynthesis?.cancel() } catch {}
    const rec = new SR()
    rec.lang = 'es-CO'
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.onresult = (e: any) => resolve(String(e.results?.[0]?.[0]?.transcript ?? '').trim())
    rec.onerror = (e: any) => reject(new Error(e?.error === 'not-allowed'
      ? 'Permite el micrófono para dictar'
      : e?.error === 'no-speech' ? 'No te escuché, intenta de nuevo' : 'No se pudo dictar'))
    rec.onend = () => resolve('')
    rec.start()
  })
}

export function useVoiceEnabled(): boolean {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => enabled,
  )
}