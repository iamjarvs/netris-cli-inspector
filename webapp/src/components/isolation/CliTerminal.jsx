import { useEffect, useRef, useState } from 'react'
import { postLaunchIterm } from '../../api'

export default function CliTerminal({
  title = 'Terminal Session',
  lines = [],
  prompt = 'cumulus@switch:~$ ',
  onRunCommand,
  onClear,
  loading = false,
  height = 'h-[500px]',
  showInput = false,
  placeholder = 'Type command (e.g. show vrf, show evpn vni, show ip route)...',
  extraAction = null,
  targetDevice = '',
  mgmtIp = '',
  deviceType = 'switch',
}) {
  const [copied, setCopied] = useState(false)
  const [cleared, setCleared] = useState(false)
  const [adHocOpen, setAdHocOpen] = useState(false)
  const [adHocCmd, setAdHocCmd] = useState('')
  const [itermState, setItermState] = useState({ loading: false, msg: '' })
  const [fontSizeClass, setFontSizeClass] = useState('text-[13.5px]') // Larger default text
  const bodyRef = useRef(null)
  const adHocInputRef = useRef(null)

  // Internal-only scroll: Prevents jumping the entire browser window/page!
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [lines, loading])

  // Focus input when modal opens
  useEffect(() => {
    if (adHocOpen) {
      setTimeout(() => {
        adHocInputRef.current?.focus()
      }, 50)
    }
  }, [adHocOpen])

  function handleCopy() {
    const text = typeof lines === 'string' ? lines : lines.join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function handleLaunchIterm() {
    if (!targetDevice && !mgmtIp) return
    setItermState({ loading: true, msg: 'Launching iTerm...' })
    try {
      const res = await postLaunchIterm({
        target: targetDevice,
        ip: mgmtIp,
        device_type: deviceType,
      })
      if (res.ok) {
        setItermState({
          loading: false,
          msg: res.launched ? 'Launched in iTerm!' : 'Command copied',
        })
        if (res.command) {
          navigator.clipboard.writeText(res.command).catch(() => {})
        }
      } else {
        setItermState({ loading: false, msg: 'Launch failed' })
      }
    } catch (err) {
      setItermState({ loading: false, msg: 'Error launching' })
    } finally {
      setTimeout(() => {
        setItermState({ loading: false, msg: '' })
      }, 3000)
    }
  }

  // Reset cleared state when new lines or loading occurs
  useEffect(() => {
    setCleared(false)
  }, [lines, loading])

  function handleClear() {
    if (onClear) {
      onClear()
    }
    setCleared(true)
  }

  function handleSendAdHoc(e) {
    if (e) e.preventDefault()
    const trimmed = adHocCmd.trim()
    if (!trimmed || loading) return
    setAdHocOpen(false)
    setAdHocCmd('')
    if (onRunCommand) onRunCommand(trimmed)
  }

  const rawLines = typeof lines === 'string' ? lines.split('\n') : lines
  const renderedLines = cleared ? [prompt] : rawLines

  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-800 bg-gray-950 font-mono shadow-2xl">
      {/* Terminal Title Bar */}
      <div className="flex items-center justify-between border-b border-gray-800/80 bg-gray-900/90 px-3.5 py-2 select-none gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Window control dots */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80 hover:bg-rose-500 transition-colors" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80 hover:bg-amber-500 transition-colors" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80 hover:bg-emerald-500 transition-colors" />
          </div>
          <span className="text-theme-xs font-semibold text-gray-200 truncate">
            {title}
          </span>
          {targetDevice && (
            <span className="hidden xl:inline-block rounded bg-gray-800/80 px-1.5 py-0.5 text-[10px] text-gray-400 border border-gray-700/50 shrink-0">
              {targetDevice}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {loading && (
            <div className="flex items-center gap-1 text-brand-400 text-[11px] mr-1">
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span className="hidden sm:inline">Executing…</span>
            </div>
          )}

          {/* Font Size Toggle Buttons */}
          <div className="flex items-center rounded bg-gray-800/70 border border-gray-700/50 p-0.5 text-[10px]">
            <button
              type="button"
              onClick={() => setFontSizeClass('text-xs')}
              className={`px-1.5 py-0.5 rounded ${fontSizeClass === 'text-xs' ? 'bg-gray-700 text-white font-bold' : 'text-gray-400 hover:text-gray-200'}`}
              title="Small Text"
            >
              A-
            </button>
            <button
              type="button"
              onClick={() => setFontSizeClass('text-[13.5px]')}
              className={`px-1.5 py-0.5 rounded ${fontSizeClass === 'text-[13.5px]' ? 'bg-gray-700 text-white font-bold' : 'text-gray-400 hover:text-gray-200'}`}
              title="Normal Text"
            >
              A
            </button>
            <button
              type="button"
              onClick={() => setFontSizeClass('text-[15px]')}
              className={`px-1.5 py-0.5 rounded ${fontSizeClass === 'text-[15px]' ? 'bg-gray-700 text-white font-bold' : 'text-gray-400 hover:text-gray-200'}`}
              title="Large Text (Demo Friendly)"
            >
              A+
            </button>
          </div>

          {/* Ad hoc Command Modal Trigger */}
          {onRunCommand && (
            <button
              type="button"
              onClick={() => setAdHocOpen(true)}
              disabled={loading}
              className="flex items-center gap-1 rounded bg-brand-500/20 px-2 py-1 text-theme-xs font-medium text-brand-300 border border-brand-500/40 hover:bg-brand-500/30 hover:text-white transition-all shadow-sm"
              title="Open Ad hoc Command Runner"
            >
              <span>⚡</span>
              <span className="hidden sm:inline">Ad hoc</span>
            </button>
          )}

          {/* iTerm Local Launch Button */}
          {(targetDevice || mgmtIp) && (
            <button
              type="button"
              onClick={handleLaunchIterm}
              disabled={itermState.loading}
              className="flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-theme-xs font-medium text-gray-200 border border-gray-700 hover:bg-gray-700 hover:text-white hover:border-gray-600 transition-all shadow-sm"
              title="Launch interactive SSH session in local macOS iTerm"
            >
              <svg className="h-3 w-3 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              <span>{itermState.msg || 'iTerm'}</span>
            </button>
          )}

          {extraAction}

          {/* Clear Terminal Session Output */}
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1 rounded bg-gray-800/80 px-2 py-1 text-theme-xs text-gray-300 border border-gray-700/60 hover:bg-gray-700 hover:text-white transition-colors"
            title="Clear terminal session screen"
          >
            <svg className="h-3 w-3 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span className="hidden sm:inline">Clear</span>
          </button>

          {/* Copy Terminal Text Button */}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 rounded bg-gray-800/80 px-1.5 py-1 text-theme-xs text-gray-300 border border-gray-700/60 hover:bg-gray-700 hover:text-white transition-colors"
            title="Copy terminal contents"
          >
            {copied ? (
              <span className="text-emerald-400 font-medium">Copied!</span>
            ) : (
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Terminal Output Body (Internal Scroll Only & Configurable Bigger Text) */}
      <div
        ref={bodyRef}
        className={`${height} ${fontSizeClass} overflow-y-auto p-4 leading-relaxed text-gray-200 select-text`}
      >
        {renderedLines.map((line, idx) => {
          const isPrompt = line.includes('cumulus@') || line.includes('root@')
          const isOk =
            line.includes('OK') ||
            line.includes('0% packet loss') ||
            line.includes('Dedicated Tenant') ||
            line.includes('ISOLATED 🛡️')
          const isDrop =
            line.includes('No route to host') ||
            line.includes('AIR-GAP') ||
            line.includes('Timeout') ||
            line.includes('100% packet loss') ||
            line.includes('100% Drop')
          const isNotice = line.startsWith('[') || line.startsWith('#') || line.startsWith('---')

          let colorClass = 'text-gray-300'
          if (isPrompt) colorClass = 'text-emerald-400 font-semibold'
          else if (isDrop) colorClass = 'text-amber-400 font-medium'
          else if (isOk) colorClass = 'text-emerald-300'
          else if (isNotice) colorClass = 'text-sky-400 opacity-90'

          return (
            <div key={idx} className={`${colorClass} whitespace-pre-wrap break-all font-mono`}>
              {line}
            </div>
          )
        })}
        {loading && (
          <div className="flex items-center gap-2 text-brand-400 animate-pulse mt-2">
            <span className="h-2 w-2 rounded-full bg-brand-400 animate-ping" />
            <span>&gt; Executing on target hardware via SSH hop...</span>
          </div>
        )}
      </div>

      {/* Optional Legacy Bottom Input */}
      {showInput && (
        <div className="flex items-center gap-2 border-t border-gray-800 bg-gray-900/60 px-4 py-2.5">
          <span className="text-emerald-400 font-bold select-none">{prompt}</span>
          <input
            type="text"
            className="flex-1 bg-transparent text-gray-100 placeholder-gray-500 focus:outline-none font-mono text-xs"
            placeholder={placeholder}
            value={adHocCmd}
            onChange={(e) => setAdHocCmd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSendAdHoc(e)
            }}
            disabled={loading}
          />
        </div>
      )}

      {/* Ad hoc Command Runner Modal */}
      {adHocOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/70 backdrop-blur-sm p-4"
          onClick={() => setAdHocOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setAdHocOpen(false)
            }}
          >
            <div className="flex items-center justify-between pb-3 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/20 text-brand-400">
                  ⚡
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-white">Execute Ad hoc Switch Command</h3>
                  <p className="text-[11px] text-gray-400">
                    Target: <span className="text-emerald-400 font-mono">{targetDevice || 'Active Switch'}</span>
                    {mgmtIp ? ` (${mgmtIp})` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAdHocOpen(false)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSendAdHoc} className="mt-4 space-y-4">
              <div>
                <label className="block text-theme-xs font-medium text-gray-300 mb-1.5">
                  Command Line:
                </label>
                <div className="flex items-center rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-mono text-gray-100 focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500">
                  <span className="text-emerald-400 mr-2 select-none">{prompt}</span>
                  <input
                    ref={adHocInputRef}
                    type="text"
                    value={adHocCmd}
                    onChange={(e) => setAdHocCmd(e.target.value)}
                    placeholder="e.g. show vrf, show evpn vni, nv show router vrf"
                    className="w-full bg-transparent text-gray-100 placeholder-gray-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Quick suggestions */}
              <div>
                <p className="text-[11px] text-gray-400 mb-1.5">Quick Presets:</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'show vrf',
                    'show evpn vni',
                    'show ip route vrf default',
                    'nv show router vrf',
                    'ip link show type vrf',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAdHocCmd(preset)}
                      className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-700 hover:text-white border border-gray-700/60 transition-colors"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
                <button
                  type="button"
                  onClick={() => setAdHocOpen(false)}
                  className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                >
                  Cancel (Esc)
                </button>
                <button
                  type="submit"
                  disabled={!adHocCmd.trim() || loading}
                  className="rounded-lg bg-brand-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50 transition-colors shadow-sm"
                >
                  Execute ↵
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
