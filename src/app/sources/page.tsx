import { providerSummaries } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";

const ACCESS: Record<string, string> = {
  official_api: "Official API",
  public_web: "Public web pages",
  manual: "Manual check",
  mock: "Mock data",
  ai: "AI model",
};

const STATE: Record<string, { label: string; tone: string }> = {
  ok: { label: "Working", tone: "good" },
  not_configured: { label: "Needs configuration", tone: "warn" },
  manual: { label: "Manual entry", tone: "" },
  unavailable: { label: "Unavailable", tone: "bad" },
};

export default function SourcesPage() {
  const providers = providerSummaries();
  return (
    <>
      <h1>Research sources</h1>
      <p className="muted">
        What the app can check automatically, what needs an API key, and what you need to check by hand. API keys live in server environment variables and are
        never sent to the browser.
      </p>
      {(["live", "mock"] as const).map((mode) => (
        <section className="card" key={mode}>
          <h2>{mode === "live" ? "Live sources" : "Mock mode"}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Access</th>
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {providers
                  .filter((p) => p.mode === mode)
                  .map((p) => (
                    <tr key={p.id}>
                      <td>
                        <b>{p.label}</b>
                        <div className="muted" style={{ fontSize: "0.8rem" }}>
                          {p.role === "candidates" ? "Finds brands" : "Finds evidence"}
                        </div>
                      </td>
                      <td>{ACCESS[p.access]}</td>
                      <td>
                        <span className={`badge ${STATE[p.state]?.tone ?? ""}`}>{STATE[p.state]?.label ?? p.state}</span>
                      </td>
                      <td>
                        {p.description}
                        <div className="muted" style={{ fontSize: "0.85rem" }}>
                          {p.message}
                          {p.configVars.length > 0 && <> Config: {p.configVars.map((v) => <code key={v}>{v} </code>)}</>}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <section className="card">
        <h2>Ground rules</h2>
        <ul>
          <li>A missing result from any source doesn&apos;t mean a brand doesn&apos;t advertise or sponsor. Coverage is partial everywhere.</li>
          <li>Ads show marketing activity, not sponsorship budget or interest.</li>
          <li>&quot;UGC-style&quot; is a read of the ad&apos;s style. It doesn&apos;t tell us whether the person is a customer, a paid creator, or an actor.</li>
          <li>Evidence without a source link, or that you flag as conflicting or inaccessible, earns no points.</li>
          <li>We don&apos;t log in, bypass bot protection, or ignore robots.txt.</li>
        </ul>
      </section>
    </>
  );
}
