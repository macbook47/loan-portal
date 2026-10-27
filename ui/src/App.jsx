import React, { useEffect, useRef, useState } from 'react'

const idr = n => 'Rp ' + Math.round(n).toLocaleString('id-ID')

async function api(method, path, body) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  const t0 = performance.now()
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    })
    const ms = Math.round(performance.now() - t0)
    let data = null
    try { data = await res.json() } catch { /* non-JSON error page */ }
    return { ok: res.ok, status: res.status, ms, pod: res.headers.get('X-Served-By') || '-', data }
  } catch (e) {
    return { ok: false, status: e.name === 'AbortError' ? 'timeout' : 'no response',
             ms: Math.round(performance.now() - t0), pod: '-', data: null }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------- simulator
function Simulator({ products, onApplied }) {
  const [product, setProduct] = useState('KUR')
  const [amount, setAmount] = useState(50000000)
  const [tenor, setTenor] = useState(24)
  const [applicant, setApplicant] = useState('')
  const [quote, setQuote] = useState(null)
  const [message, setMessage] = useState(null)
  const selected = products.find(p => p.code === product)

  async function simulate() {
    setMessage(null)
    const r = await api('POST', '/api/simulate', { product, amount: Number(amount), tenor_months: Number(tenor) })
    if (r.ok) setQuote(r.data)
    else { setQuote(null); setMessage({ bad: true, text: r.data?.error || `Service unavailable (${r.status})` }) }
  }
  async function apply() {
    const r = await api('POST', '/api/applications',
      { product, amount: Number(amount), tenor_months: Number(tenor), applicant })
    if (r.ok) { setMessage({ bad: false, text: `Application ${r.data.id} submitted` }); setApplicant(''); onApplied() }
    else setMessage({ bad: true, text: r.data?.error || `Could not submit (${r.status})` })
  }

  return (
    <section className="card">
      <h2>Loan simulator</h2>
      <div className="form">
        <label>Product
          <select value={product} onChange={e => setProduct(e.target.value)}>
            {products.map(p => <option key={p.code} value={p.code}>{p.name} ({p.annual_rate_pct}% p.a.)</option>)}
          </select>
        </label>
        <label>Amount (IDR)
          <input type="number" min="1000000" step="1000000" value={amount} onChange={e => setAmount(e.target.value)} />
        </label>
        <label>Tenor (months{selected ? `, max ${selected.max_tenor_months}` : ''})
          <input type="number" min="1" value={tenor} onChange={e => setTenor(e.target.value)} />
        </label>
        <button className="primary" onClick={simulate}>Calculate installment</button>
      </div>

      {quote && (
        <div className="quote">
          <div><span>Monthly installment</span><strong>{idr(quote.monthly_installment)}</strong></div>
          <div><span>Total payment</span><strong>{idr(quote.total_payment)}</strong></div>
          <div><span>Interest rate</span><strong>{quote.annual_rate_pct}% p.a.</strong></div>
          <div className="apply">
            <input placeholder="Applicant name" value={applicant} onChange={e => setApplicant(e.target.value)} />
            <button onClick={apply} disabled={!applicant.trim()}>Submit application</button>
          </div>
        </div>
      )}
      {message && <p className={message.bad ? 'msg bad' : 'msg good'}>{message.text}</p>}
    </section>
  )
}

// ------------------------------------------------------------- applications
function Applications({ refreshKey }) {
  const [items, setItems] = useState([])
  const [pod, setPod] = useState('')
  useEffect(() => {
    api('GET', '/api/applications').then(r => { if (r.ok) { setItems(r.data.items); setPod(r.pod) } })
  }, [refreshKey])
  return (
    <section className="card">
      <h2>Recent applications</h2>
      <p className="hint">Stored in memory per pod, so the list depends on which pod answers{pod && <> (this one: <code>{pod}</code>)</>}.</p>
      {items.length === 0 ? <p className="empty">No applications yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Applicant</th><th>Product</th><th>Amount</th><th>Monthly</th></tr></thead>
            <tbody>{items.map(a => (
              <tr key={a.id}><td><code>{a.id}</code></td><td>{a.applicant}</td><td>{a.product}</td>
                <td>{idr(a.amount)}</td><td>{idr(a.monthly_installment)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ------------------------------------------------------- health monitor
function HealthMonitor() {
  const [running, setRunning] = useState(false)
  const [checks, setChecks] = useState([])   // last 120 requests, for the timeline only
  const empty = { total: 0, ok: 0, msSum: 0, streak: 0, worst: 0, worstAt: null, outages: 0, since: null, pods: {} }
  const [session, setSession] = useState(empty) // whole session since Start/Clear
  const timer = useRef(null)
  const tick = useRef(0)

  useEffect(() => {
    if (!running) return
    setSession(s => s.since ? s : { ...s, since: new Date() })
    timer.current = setInterval(async () => {
      tick.current++
      const r = tick.current % 2
        ? await api('GET', '/api/products')
        : await api('POST', '/api/simulate', { product: 'KUR', amount: 25000000, tenor_months: 12 })
      const at = new Date()
      setChecks(c => [...c.slice(-119), { ok: r.ok, ms: r.ms, pod: r.pod, status: r.status, at }])
      setSession(s => {
        const streak = r.ok ? 0 : s.streak + 1
        const pods = r.ok ? { ...s.pods, [r.pod]: (s.pods[r.pod] || 0) + 1 } : s.pods
        return {
          ...s,
          total: s.total + 1,
          ok: s.ok + (r.ok ? 1 : 0),
          msSum: s.msSum + r.ms,
          streak,
          outages: s.outages + (!r.ok && s.streak === 0 ? 1 : 0),
          worst: Math.max(s.worst, streak),
          worstAt: streak > s.worst ? at : s.worstAt,
          pods
        }
      })
    }, 500)
    return () => clearInterval(timer.current)
  }, [running])

  const clear = () => { setChecks([]); setSession({ ...empty, since: running ? new Date() : null }) }
  const availability = session.total ? (session.ok / session.total) * 100 : null
  const t = d => d ? d.toLocaleTimeString() : ''

  return (
    <section className="card monitor">
      <div className="monitor-head">
        <div>
          <h2>Customer experience monitor</h2>
          <p className="hint">Simulates customers using the portal twice a second. Run it while Krkn breaks things.
            {session.since && <> Session started {t(session.since)}.</>}</p>
        </div>
        <div className="actions">
          <button className={running ? 'danger' : 'primary'} onClick={() => setRunning(r => !r)}>
            {running ? 'Stop traffic' : 'Start traffic'}
          </button>
          <button onClick={clear} disabled={!session.total}>Clear</button>
        </div>
      </div>

      <div className="timeline" aria-label="Last 120 requests: green ok, red failed">
        {checks.map((c, i) => (
          <span key={i} className={c.ok ? (c.ms > 1000 ? 'slow' : 'ok') : 'fail'}
                title={`${t(c.at)} · ${c.status} · ${c.ms} ms · ${c.pod}`} />
        ))}
        {!checks.length && <p className="empty">Each square is one customer request (last 60 s shown): green OK, amber slower than 1 s, red failed.</p>}
      </div>

      {session.total > 0 && (
        <>
          <dl className="stats">
            <div><dt>Availability (session)</dt><dd className={availability < 100 ? 'bad' : ''}>{availability.toFixed(1)}%</dd></div>
            <div><dt>Avg response</dt><dd>{Math.round(session.msSum / session.total)} ms</dd></div>
            <div><dt>Longest outage</dt><dd className={session.worst ? 'bad' : ''}>{(session.worst * 0.5).toFixed(1)} s</dd>
              {session.worstAt && <small>ended ~{t(session.worstAt)}</small>}</div>
            <div><dt>Outages / requests</dt><dd className={session.outages ? 'bad' : ''}>{session.outages} / {session.total}</dd></div>
          </dl>
          <p className="pods">Served by: {Object.entries(session.pods).map(([p, n]) => <code key={p}>{p} ({n})</code>)}</p>
        </>
      )}
    </section>
  )
}

// ------------------------------------------------------------------- app
export default function App() {
  const [title, setTitle] = useState('Loan Portal')
  const [products, setProducts] = useState([])
  const [status, setStatus] = useState({ ok: null, pod: '' })
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    fetch('/config.json').then(r => r.json()).then(c => {
      if (c.title) { setTitle(c.title); document.title = c.title }
    }).catch(() => {})
    api('GET', '/api/products').then(r => { if (r.ok) setProducts(r.data.items) })
    const check = () => api('GET', '/api/info').then(r => setStatus({ ok: r.ok, pod: r.pod }))
    check()
    const t = setInterval(check, 3000)
    return () => clearInterval(t)
  }, [])

  return (
    <>
      <header>
        <div className="brand"><span className="logo">◆</span>{title}</div>
        <div className={'status ' + (status.ok === null ? '' : status.ok ? 'up' : 'down')}>
          {status.ok === null ? 'Checking service…' : status.ok ? `Service online · ${status.pod}` : 'Service unavailable'}
        </div>
      </header>
      <main>
        <div className="grid">
          <Simulator products={products} onApplied={() => setRefreshKey(k => k + 1)} />
          <Applications refreshKey={refreshKey} />
        </div>
        <HealthMonitor />
      </main>
    </>
  )
}
