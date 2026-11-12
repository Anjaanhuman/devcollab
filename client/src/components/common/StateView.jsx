export function LoadingState({ label = 'Loading…' }) {
  return <div className="state-card" role="status"><span className="loading-dot" />{label}</div>;
}

export function ErrorState({ message, onRetry }) {
  return <div className="state-card state-error" role="alert"><span>{message}</span>{onRetry && <button type="button" className="button button-quiet" onClick={onRetry}>Try again</button>}</div>;
}

export function EmptyState({ title, description, action }) {
  return <div className="state-card state-empty"><span className="empty-mark">∅</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
