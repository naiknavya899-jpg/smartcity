import { useState } from 'react'
import { api } from '../services/api'
import './ProblemAnalysis.css'

const MAX_INPUT_LENGTH = 20000
const STATUSES = ['Pending', 'In Progress', 'Completed']

function isAnalysisResult(value) {
  return Boolean(value
    && typeof value.overall_summary === 'string'
    && typeof value.detected_intent === 'string'
    && Array.isArray(value.sections)
    && value.sections.every((section) => typeof section.section_id === 'string'
      && typeof section.section_name === 'string'
      && typeof section.section_summary === 'string'
      && Array.isArray(section.problems)
      && section.problems.every((problem) => typeof problem.problem_id === 'string'
        && typeof problem.title === 'string'
        && typeof problem.description === 'string'
        && ['High', 'Medium', 'Low'].includes(problem.priority)
        && STATUSES.includes(problem.status)
        && typeof problem.suggested_solution === 'string'
        && Array.isArray(problem.dependencies)
        && Array.isArray(problem.missing_information)
        && Array.isArray(problem.assumptions)))
    && Array.isArray(value.execution_plan)
    && Array.isArray(value.follow_up_questions))
}

export default function ProblemAnalysis() {
  const [inputText, setInputText] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editingId, setEditingId] = useState('')
  const [draft, setDraft] = useState(null)

  const analyze = async (event) => {
    event?.preventDefault()
    if (!inputText.trim()) {
      setError('Enter some text before analyzing it.')
      return
    }
    setLoading(true)
    setError('')
    setNotice('')
    setResult(null)
    setEditingId('')
    setDraft(null)
    try {
      const data = await api.analyzeProblemInput(inputText.trim())
      if (!isAnalysisResult(data)) throw new Error('The analysis response was incomplete or invalid. Please try again.')
      setResult(data)
    } catch (err) {
      setError(err.message || 'Analysis failed. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  const updateProblem = (sectionIndex, problemIndex, updates) => {
    setResult((current) => ({
      ...current,
      sections: current.sections.map((section, currentSectionIndex) => currentSectionIndex !== sectionIndex ? section : ({
        ...section,
        problems: section.problems.map((problem, currentProblemIndex) => currentProblemIndex !== problemIndex ? problem : ({ ...problem, ...updates })),
      })),
    }))
  }

  const updateStatus = (sectionIndex, problemIndex, status) => updateProblem(sectionIndex, problemIndex, { status })

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2))
      setNotice('Analysis JSON copied to clipboard.')
    } catch {
      setError('Could not access the clipboard. Use Export JSON to save the result instead.')
    }
  }

  const exportResult = () => {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'urban-eye-problem-analysis.json'
    link.click()
    URL.revokeObjectURL(url)
    setNotice('Analysis JSON downloaded.')
  }

  const beginEdit = (sectionIndex, problemIndex, problem) => {
    setEditingId(`${sectionIndex}:${problemIndex}`)
    setDraft({ title: problem.title, description: problem.description, suggested_solution: problem.suggested_solution })
  }

  const saveEdit = (sectionIndex, problemIndex) => {
    if (!draft.title.trim() || !draft.description.trim() || !draft.suggested_solution.trim()) return
    updateProblem(sectionIndex, problemIndex, {
      title: draft.title.trim(),
      description: draft.description.trim(),
      suggested_solution: draft.suggested_solution.trim(),
    })
    setEditingId('')
    setDraft(null)
  }

  return (
    <main className="problem-analysis-page">
      <div className="problem-analysis-shell">
        <header className="problem-analysis-heading">
          <span className="problem-analysis-eyebrow">URBAN EYE · SMART WORKSPACE</span>
          <h1>Turn your text into an action plan</h1>
          <p>Paste a question, project brief, feedback, or a list of issues. AI will organize the work into useful sections and next steps.</p>
        </header>

        <form className="problem-analysis-input-card" onSubmit={analyze}>
          <label htmlFor="problem-analysis-input">What would you like to organize?</label>
          <textarea
            id="problem-analysis-input"
            value={inputText}
            onChange={(event) => setInputText(event.target.value.slice(0, MAX_INPUT_LENGTH))}
            maxLength={MAX_INPUT_LENGTH}
            placeholder="Describe the problem, project, requirements, or questions…"
            rows={8}
            aria-describedby="problem-analysis-input-note"
          />
          <div className="problem-analysis-input-footer">
            <span id="problem-analysis-input-note">Your text is sent to the configured AI provider for analysis and is not saved by this app.</span>
            <span className="problem-analysis-count">{inputText.length.toLocaleString()} / {MAX_INPUT_LENGTH.toLocaleString()}</span>
          </div>
          <button className="problem-analysis-primary" type="submit" disabled={loading || !inputText.trim()}>
            {loading ? <><span className="problem-analysis-spinner" aria-hidden="true" />Analyzing…</> : result ? 'Reanalyze text' : 'Analyze text'}
          </button>
        </form>

        {error && <p className="problem-analysis-alert" role="alert">{error}</p>}
        {notice && <p className="problem-analysis-notice" role="status">{notice}</p>}
        {loading && <div className="problem-analysis-loading" role="status" aria-live="polite"><span className="problem-analysis-spinner" aria-hidden="true" />Reading the full input and organizing the work…</div>}

        {!result && !loading && !error && (
          <section className="problem-analysis-empty">
            <div className="problem-analysis-empty-mark" aria-hidden="true">AI</div>
            <h2>Your organized analysis will appear here</h2>
            <p>Sections are generated from the text you provide. The tool won’t invent missing facts or force your request into preset categories.</p>
          </section>
        )}

        {result && (
          <section className="problem-analysis-results" aria-live="polite">
            <div className="problem-analysis-result-heading">
              <div>
                <span className="problem-analysis-eyebrow">ANALYSIS OVERVIEW</span>
                <h2>Here’s the work I found</h2>
              </div>
              <div className="problem-analysis-result-actions">
                <button type="button" onClick={copyResult}>Copy JSON</button>
                <button type="button" onClick={exportResult}>Export JSON</button>
              </div>
            </div>

            <article className="problem-analysis-overview">
              <div><h3>Summary</h3><p>{result.overall_summary}</p></div>
              <div><h3>Detected intent</h3><p>{result.detected_intent}</p></div>
            </article>

            <div className="problem-analysis-sections">
              {result.sections.map((section, sectionIndex) => (
                <section className="problem-analysis-section" key={section.section_id}>
                  <div className="problem-analysis-section-heading">
                    <div><span>{section.section_id}</span><div><h3>{section.section_name}</h3><p>{section.section_summary}</p></div></div>
                    <small>{section.problems.length} {section.problems.length === 1 ? 'task' : 'tasks'}</small>
                  </div>
                  <div className="problem-analysis-task-list">
                    {section.problems.map((problem, problemIndex) => {
                      const editKey = `${sectionIndex}:${problemIndex}`
                      const isEditing = editingId === editKey
                      return (
                        <article className={`problem-analysis-task${problem.status === 'Completed' ? ' is-completed' : ''}`} key={problem.problem_id}>
                          <div className="problem-analysis-task-topline">
                            <label className="problem-analysis-check">
                              <input type="checkbox" checked={problem.status === 'Completed'} onChange={(event) => updateStatus(sectionIndex, problemIndex, event.target.checked ? 'Completed' : 'Pending')} />
                              <span className="sr-only">Mark {problem.title} complete</span>
                            </label>
                            {isEditing ? (
                              <input className="problem-analysis-edit-title" aria-label="Task title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
                            ) : <h4>{problem.title}</h4>}
                            <span className={`problem-analysis-priority priority-${problem.priority.toLowerCase()}`}>{problem.priority}</span>
                          </div>
                          {isEditing ? (
                            <div className="problem-analysis-edit-fields">
                              <label>Description<textarea rows="3" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
                              <label>Suggested solution<textarea rows="3" value={draft.suggested_solution} onChange={(event) => setDraft({ ...draft, suggested_solution: event.target.value })} /></label>
                              <div><button type="button" onClick={() => saveEdit(sectionIndex, problemIndex)} disabled={!draft.title.trim() || !draft.description.trim() || !draft.suggested_solution.trim()}>Save changes</button><button type="button" className="problem-analysis-secondary" onClick={() => { setEditingId(''); setDraft(null) }}>Cancel</button></div>
                            </div>
                          ) : (
                            <>
                              <p>{problem.description}</p>
                              <div className="problem-analysis-solution"><b>Suggested next step</b><span>{problem.suggested_solution}</span></div>
                              {(problem.dependencies.length > 0 || problem.missing_information.length > 0 || problem.assumptions.length > 0) && (
                                <details className="problem-analysis-details"><summary>Dependencies and context</summary>
                                  {problem.dependencies.length > 0 && <p><b>Depends on:</b> {problem.dependencies.join('; ')}</p>}
                                  {problem.missing_information.length > 0 && <p><b>Missing information:</b> {problem.missing_information.join('; ')}</p>}
                                  {problem.assumptions.length > 0 && <p><b>Assumptions:</b> {problem.assumptions.join('; ')}</p>}
                                </details>
                              )}
                              <div className="problem-analysis-task-footer">
                                <label>Status<select value={problem.status} onChange={(event) => updateStatus(sectionIndex, problemIndex, event.target.value)}>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
                                <button type="button" className="problem-analysis-secondary" onClick={() => beginEdit(sectionIndex, problemIndex, problem)}>Edit task</button>
                              </div>
                            </>
                          )}
                        </article>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>

            <section className="problem-analysis-plan">
              <span className="problem-analysis-eyebrow">RECOMMENDED ORDER</span>
              <h3>Execution plan</h3>
              <ol>{result.execution_plan.map((step, index) => <li key={`${index}-${step}`}><span>{index + 1}</span>{step}</li>)}</ol>
            </section>

            {result.follow_up_questions.length > 0 && (
              <section className="problem-analysis-questions"><h3>Questions that could improve this plan</h3><ul>{result.follow_up_questions.map((question, index) => <li key={`${index}-${question}`}>{question}</li>)}</ul></section>
            )}
            <p className="problem-analysis-disclaimer">AI-generated organization can miss context. Review the tasks, priorities, assumptions, and suggested actions before relying on them.</p>
          </section>
        )}
      </div>
    </main>
  )
}
