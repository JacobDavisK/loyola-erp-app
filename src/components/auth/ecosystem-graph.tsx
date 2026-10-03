/**
 * An abstract map of the university as one connected system: eight domains around a core, joined by fine
 * lines along which a faint signal travels. Pure SVG + CSS (see auth.css), decorative only.
 */
const NODES = ["Students", "Faculty", "Courses", "Research", "Mentoring", "Assessments", "Campus", "Analytics"];

export function EcosystemGraph({ core, className }: { core: string; className?: string }) {
  const W = 560, H = 420, cx = W / 2, cy = H / 2, rx = 215, ry = 150;
  const pts = NODES.map((label, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / NODES.length;
    return { label, x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a), w: label.length * 7.4 + 34 };
  });
  const coreW = core.length * 8 + 44;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="presentation" aria-hidden focusable="false">
      <g fill="none" strokeWidth="1">
        {/* outer ring: neighbours */}
        {pts.map((p, i) => {
          const q = pts[(i + 1) % pts.length];
          return <line key={`r${i}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="eco-line" strokeOpacity="0.55" />;
        })}
        {/* a few cross links */}
        {[[0, 3], [1, 5], [2, 6], [4, 7]].map(([a, b]) => (
          <line key={`x${a}${b}`} x1={pts[a].x} y1={pts[a].y} x2={pts[b].x} y2={pts[b].y} className="eco-line" strokeOpacity="0.35" strokeDasharray="2 4" />
        ))}
        {/* spokes to the core, with travelling signal on alternate spokes */}
        {pts.map((p, i) => (
          <g key={`s${i}`}>
            <line x1={cx} y1={cy} x2={p.x} y2={p.y} className="eco-line" />
            {i % 2 === 0 ? <line x1={cx} y1={cy} x2={p.x} y2={p.y} className="eco-flow" style={{ animationDelay: `${-i * 0.7}s` }} /> : <line x1={p.x} y1={p.y} x2={cx} y2={cy} className="eco-flow alt" style={{ animationDelay: `${-i * 0.9}s` }} />}
          </g>
        ))}
      </g>
      {pts.map((p, i) => (
        <g key={p.label} className="eco-node" transform={`translate(${p.x - p.w / 2} ${p.y - 15})`}>
          <rect width={p.w} height="30" rx="15" strokeWidth="1" />
          <circle cx="15" cy="15" r="3" fill={i % 2 === 0 ? "var(--brand)" : "var(--brand-2)"} />
          <text x="25" y="19.5" fontSize="12" fontWeight="500">{p.label}</text>
        </g>
      ))}
      <g transform={`translate(${cx - coreW / 2} ${cy - 20})`}>
        <rect className="eco-core" width={coreW} height="40" rx="20" fill="var(--brand)" fillOpacity="0.1" stroke="var(--brand)" strokeOpacity="0.45" />
        <text x={coreW / 2} y="25" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--text)">{core}</text>
      </g>
    </svg>
  );
}
