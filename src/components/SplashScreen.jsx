import { useEffect, useState } from 'react'

export default function SplashScreen({ onComplete }) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const leaveTimer = window.setTimeout(() => setLeaving(true), 2800)
    const completeTimer = window.setTimeout(onComplete, 3250)
    return () => {
      window.clearTimeout(leaveTimer)
      window.clearTimeout(completeTimer)
    }
  }, [onComplete])

  return (
    <div className={`urban-eye-splash${leaving ? ' is-leaving' : ''}`} role="status" aria-label="Urban Eye is starting">
      <div className="urban-eye-splash-content">
        <div className="urban-eye-splash-logo-float">
          <img
            className="urban-eye-splash-logo"
            src="/images/urban-eye-logo-mark.png"
            alt="Urban Eye location pin and city skyline logo"
          />
        </div>
        <h1 className="urban-eye-splash-title">
          <span className="urban-eye-title-word urban-eye-title-urban">Urban</span>{' '}
          <span className="urban-eye-title-word urban-eye-title-eye">Eye</span>
        </h1>
        <p className="urban-eye-splash-tagline">See It. Report It. Improve It.</p>
        <span className="urban-eye-splash-caption">SMART CITY ISSUE REPORTING SYSTEM</span>
      </div>
    </div>
  )
}
