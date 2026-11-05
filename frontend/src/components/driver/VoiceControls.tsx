import { useVoiceEnabled, setVoiceEnabled, repeatLast, speak, voiceSupported } from '../../hooks/useVoice'

export function VoiceControls() {
  const on = useVoiceEnabled()
  if (!voiceSupported) return null
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-2">
      <button
        onClick={() => setVoiceEnabled(!on)}
        className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border transition
          ${on ? 'bg-teal-500/15 border-teal-500/40 text-teal-300'
               : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
        {on ? '🔊 Voz activada' : '🔇 Activar voz'}
      </button>
      {on && (
        <>
          <button onClick={repeatLast}
            className="px-3 py-2.5 rounded-lg text-xs border border-slate-700 text-slate-300 hover:bg-slate-800">
            🔁 Repetir
          </button>
          <button onClick={() => speak('Prueba de voz. Si me escuchas, todo está bien.', { force: true, interrupt: true })}
            className="px-3 py-2.5 rounded-lg text-xs border border-slate-700 text-slate-300 hover:bg-slate-800">
            Probar
          </button>
        </>
      )}
    </div>
  )
}