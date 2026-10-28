import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../services/api'
import { ASSISTANT_TUTORIALS } from './assistantTutorials'
import './AssistantChatbot.css'

const QUICK_OPTIONS = ['Report a Problem', 'Streetlight Not Working', 'Report a Pothole', 'Water Leakage', 'Track My Complaint', 'Tutorials', 'Photo and GPS Help']
const TUTORIAL_ACTIONS = ['Explain These Steps', 'Show Another Tutorial', 'Help Me Report an Issue', 'Check My Complaint Status', 'Ask Another Question']
const WELCOME = 'Hello! Welcome to Urban Eye. 👋\n\nI can help you report city problems, check your complaint status, and learn how to use the app. What would you like to do?'
const STATUS_HELP = {
  pending: 'Your complaint is awaiting review.',
  in_progress: 'Your complaint is being processed.',
  resolved: 'The complaint is marked resolved in the system.',
  rejected: 'The complaint is marked rejected in the system.',
  confirmed_fault: 'The reported fault has been confirmed in the system.',
  field_inspection_required: 'A field inspection is required.',
  more_evidence_required: 'More evidence is required for this complaint.',
}

function isTutorialRequest(value) {
  return /\b(tutorial|demo video|how do i use|how to use|show me how|how do i report|how to report|how do i upload|how to upload|explain how)\b/i.test(value)
}

function isStatusRequest(value) {
  return /\b(track|status|progress|update on|where is|check on)\b|\b(?:complaint|report)\s*#?\d+\b/i.test(value)
}

function parseComplaintId(value) {
  const match = value.match(/(?:\b(?:complaint|report)(?:\s+id)?\s*)?#?(\d+)\b/i)
  return match ? Number(match[1]) : null
}

function AssistantIcon({ size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <path d="M12 3.5a8.5 8.5 0 0 0-7.4 12.7L4 20l3.9-.7A8.5 8.5 0 1 0 12 3.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <path d="M8.5 10h.01M15.5 10h.01M8.5 14c.8 1 2 1.5 3.5 1.5s2.7-.5 3.5-1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M12 1.8v1.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
}

export default function AssistantChatbot() {
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [messages, setMessages] = useState([{ id: 'welcome', role: 'assistant', text: WELCOME }])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [listening, setListening] = useState(false)
  const [awaitingComplaintId, setAwaitingComplaintId] = useState(false)
  const [trackedComplaintId, setTrackedComplaintId] = useState(null)
  const [selectedTutorial, setSelectedTutorial] = useState(null)
  const [videoReady, setVideoReady] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const launcherRef = useRef(null)
  const inputRef = useRef(null)
  const transcriptRef = useRef(null)
  const closeTimerRef = useRef(null)
  const recognitionRef = useRef(null)
  const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

  useEffect(() => () => {
    window.clearTimeout(closeTimerRef.current)
    recognitionRef.current?.stop()
  }, [])
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])
  useEffect(() => { if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight }, [messages, sending])
  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event) => { if (event.key === 'Escape') closeChat() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const appendAssistant = (text, extra = {}) => setMessages((current) => [...current, { id: `assistant-${Date.now()}-${Math.random()}`, role: 'assistant', text, ...extra }])
  const openChat = () => { window.clearTimeout(closeTimerRef.current); setClosing(false); setOpen(true) }
  const closeChat = () => {
    if (!open || closing) return
    recognitionRef.current?.stop()
    setListening(false)
    setClosing(true)
    closeTimerRef.current = window.setTimeout(() => { setOpen(false); setClosing(false); launcherRef.current?.focus() }, 160)
  }

  const askForComplaintId = () => {
    setAwaitingComplaintId(true)
    appendAssistant('Please enter the numeric complaint ID shown in My Complaints (for example, #5). I’ll look up the saved status for your account.')
  }

  const lookupComplaint = async (id) => {
    setSending(true)
    setAwaitingComplaintId(false)
    setTrackedComplaintId(id)
    try {
      const complaint = await api.getComplaint(id)
      const status = complaint.status || 'unknown'
      const explanation = STATUS_HELP[status] || `The saved status is “${status.replaceAll('_', ' ')}”; no additional explanation is available.`
      const updated = complaint.updated_at ? new Date(complaint.updated_at) : null
      const submitted = complaint.created_at ? new Date(complaint.created_at) : null
      const hasUpdate = updated && (!submitted || updated.getTime() > submitted.getTime() + 1000)
      const timeText = updated && !Number.isNaN(updated.getTime())
        ? hasUpdate ? ` Last updated: ${updated.toLocaleString()}.` : ' No later status update is recorded.'
        : ''
      appendAssistant(`Complaint #${complaint.id}: ${complaint.title || 'Reported issue'}\nStatus: ${status.replaceAll('_', ' ')}. ${explanation}${timeText}`, { source: 'complaints' })
    } catch (error) {
      const reason = error.message || ''
      if (/not found/i.test(reason)) appendAssistant(`I couldn’t find complaint #${id} in your account. Check the numeric ID in My Complaints.`)
      else if (/access denied|forbidden/i.test(reason)) appendAssistant(`I can’t access complaint #${id} from this account. Please check My Complaints while signed in to the account that submitted it.`)
      else appendAssistant('I couldn’t reach the complaint service just now. Please try again from My Complaints in a moment.')
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const showTutorials = () => {
    setSelectedTutorial(null)
    setVideoReady(false)
    setVideoFailed(false)
    appendAssistant('Choose a tutorial and I’ll walk you through the steps.')
    setMessages((current) => [...current, { id: `tutorial-list-${Date.now()}`, role: 'assistant', tutorialList: true }])
  }

  const chooseTutorial = (tutorial) => {
    setSelectedTutorial(tutorial)
    setVideoReady(false)
    setVideoFailed(false)
    appendAssistant('', { tutorial })
  }

  const handleTutorialAction = (action) => {
    if (action === 'Show Another Tutorial' || action === 'Back to Tutorials') showTutorials()
    else if (action === 'Help Me Report an Issue') appendAssistant('Open the report form to describe the issue and choose its location.', { actionPath: '/report' })
    else if (action === 'Check My Complaint Status') { setSelectedTutorial(null); askForComplaintId() }
    else if (action === 'Explain These Steps') appendAssistant(selectedTutorial ? selectedTutorial.steps.map((step, index) => `${index + 1}. ${step}`).join('\n') : 'Choose a tutorial first.')
    else if (action === 'Ask Another Question') { setSelectedTutorial(null); inputRef.current?.focus() }
  }

  const sendMessage = async (rawMessage) => {
    const text = rawMessage.trim()
    if (!text || sending) return
    const lower = text.toLowerCase()
    const statusIntent = awaitingComplaintId || isStatusRequest(text)
    const privateStatus = statusIntent
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', text, private: privateStatus }])
    setDraft('')
    setVoiceError('')

    if (isTutorialRequest(text) && !awaitingComplaintId) { showTutorials(); return }
    if (awaitingComplaintId) {
      if (/\b(another|different|new)\b/i.test(text)) { askForComplaintId(); return }
      const id = parseComplaintId(text)
      if (!Number.isSafeInteger(id) || id < 1) { appendAssistant('I need the numeric complaint ID, such as #5. You can find it in My Complaints.'); return }
      await lookupComplaint(id)
      return
    }
    if (statusIntent) {
      if (/\b(another|different|new)\b/i.test(text)) setTrackedComplaintId(null)
      const id = parseComplaintId(text)
      if (id) { await lookupComplaint(id); return }
      if (/\b(again|same|it)\b/i.test(text) && trackedComplaintId) { await lookupComplaint(trackedComplaintId); return }
      askForComplaintId()
      return
    }

    if (/\b(tutorial|show another|show me how|how to use|how do i use)\b/i.test(lower)) { showTutorials(); return }
    setSending(true)
    try {
      const priorMessages = messages
      const history = priorMessages.filter((item) => !item.private && item.source !== 'complaints' && !item.tutorial && !item.tutorialList).slice(-12).map(({ role, text: content }) => ({ role, content }))
      const response = await api.sendChatbotMessage(text, history)
      appendAssistant(response.reply, { source: response.source, actionPath: response.action_path, configurationRequired: response.configuration_required })
    } catch (error) {
      appendAssistant(error.message || 'I couldn’t reach the assistant. You can still report an issue or track a complaint from your dashboard.', { source: 'error' })
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const startVoiceInput = () => {
    if (!SpeechRecognition) return
    if (listening) { recognitionRef.current?.stop(); setListening(false); return }
    setVoiceError('')
    const recognition = new SpeechRecognition()
    recognition.lang = navigator.language || 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (event) => setDraft((current) => `${current}${current ? ' ' : ''}${event.results[0][0].transcript}`)
    recognition.onerror = () => setVoiceError('Voice input was unavailable. You can type your message instead.')
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }

  return <div className="urban-assistant-root">
    {open && <section id="urban-eye-assistant-window" className={`urban-assistant-window${closing ? ' is-closing' : ''}`} role="dialog" aria-label="Civique, Urban Eye Assistant" aria-modal="false">
      <header className="urban-assistant-header">
        <span className="urban-assistant-avatar"><AssistantIcon size={22} /></span>
        <span className="urban-assistant-heading"><strong>Civique</strong><small>Your Smart City Helper · Urban Eye</small></span>
        <button type="button" className="urban-assistant-close" onClick={closeChat} aria-label="Close Civique" title="Close Civique">×</button>
      </header>
      <div className="urban-assistant-transcript" ref={transcriptRef} aria-live="polite" aria-relevant="additions text">
        {messages.map((message) => <article key={message.id} className={`urban-assistant-message is-${message.role}${message.source === 'error' ? ' is-error' : ''}`}>
          {message.text && <p>{message.text}</p>}
          {message.actionPath === '/report' && <Link className="urban-assistant-action" to="/report" onClick={closeChat}>Open report form</Link>}
          {message.tutorialList && <div className="urban-assistant-tutorial-list">{ASSISTANT_TUTORIALS.map((tutorial) => <button type="button" key={tutorial.id} onClick={() => chooseTutorial(tutorial)}>{tutorial.title}</button>)}</div>}
          {message.tutorial && <>
            <strong>{message.tutorial.title}</strong>
            {message.tutorial.videoSrc && !videoFailed && <div className="urban-assistant-video-wrap">
              {!videoReady && <span className="urban-assistant-video-loading" role="status">Loading tutorial…</span>}
              <video controls playsInline preload="metadata" src={message.tutorial.videoSrc} onLoadedData={() => setVideoReady(true)} onCanPlay={() => setVideoReady(true)} onError={() => { setVideoFailed(true); setVideoReady(false) }} />
            </div>}
            {(!message.tutorial.videoSrc || videoFailed) && <p className="urban-assistant-video-unavailable">I’m sorry, this tutorial video is not available yet. You can follow these steps instead.</p>}
            <ol>{message.tutorial.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            {TUTORIAL_ACTIONS.map((action) => <button className="urban-assistant-inline-action" type="button" key={action} onClick={() => handleTutorialAction(action)}>{action}</button>)}
          </>}
        </article>)}
        {(messages.length === 1 || messages[messages.length - 1]?.configurationRequired || messages[messages.length - 1]?.source === 'help' || messages[messages.length - 1]?.source === 'error') && <div className="urban-assistant-options" aria-label="Quick help options">{QUICK_OPTIONS.map((option) => <button type="button" key={option} onClick={() => sendMessage(option)} disabled={sending}>{option}</button>)}</div>}
        {sending && <div className="urban-assistant-message is-assistant urban-assistant-thinking" role="status"><span /><span /><span /><em>Thinking</em></div>}
      </div>
      <form className="urban-assistant-compose" onSubmit={(event) => { event.preventDefault(); sendMessage(draft) }}>
        {voiceError && <p className="urban-assistant-voice-error" role="status">{voiceError}</p>}
        <input ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={awaitingComplaintId ? 'Enter complaint ID, e.g. #5' : 'Ask me anything...'} aria-label="Message Civique" maxLength={1000} disabled={sending} />
        {SpeechRecognition && <button type="button" className={`urban-assistant-mic${listening ? ' is-listening' : ''}`} onClick={startVoiceInput} aria-label={listening ? 'Stop voice input' : 'Start voice input'} aria-pressed={listening} disabled={sending}>🎙</button>}
        <button type="submit" className="urban-assistant-send" aria-label="Send message" disabled={sending || !draft.trim()}><svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="m3 11 18-8-8 18-2-8-8-2Zm8 2 10-10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
      </form>
    </section>}
    <button ref={launcherRef} type="button" className={`urban-assistant-launcher${open ? ' is-open' : ''}`} onClick={open ? closeChat : openChat} aria-label={open ? 'Close Civique' : 'Open Civique, the Urban Eye Assistant'} aria-expanded={open} aria-controls="urban-eye-assistant-window" title="Open Civique, the Urban Eye Assistant"><AssistantIcon size={27} /><span className="urban-assistant-launcher-ping" /></button>
  </div>
}
