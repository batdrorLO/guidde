import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ErrorBox, Loading } from './components/Status';
import { AccountDetailPage } from './pages/AccountDetailPage';
import { AccountsPage } from './pages/AccountsPage';
import { LoginPage } from './pages/LoginPage';
import { MethodologyPage } from './pages/MethodologyPage';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`;

export function App() {
  const { pathname } = useLocation();
  const { state, signOut, recheck } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <span className="font-semibold text-slate-900">
            <span className="text-indigo-600">guidde</span> · Account Health
          </span>
          {state.status === 'signedIn' && (
            <div className="flex items-center gap-4">
              <nav className="flex gap-1">
                <NavLink to="/" end className={navClass}>
                  Accounts
                </NavLink>
                <NavLink to="/methodology" className={navClass}>
                  Methodology
                </NavLink>
              </nav>
              <div className="flex items-center gap-3 border-l border-slate-200 pl-4 text-sm">
                <span className="hidden text-slate-600 sm:inline" title={state.user.email}>
                  {state.user.name}
                </span>
                <button type="button" onClick={signOut} className="font-medium text-slate-600 hover:text-slate-900">
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {state.status === 'checking' && <Loading />}
        {state.status === 'unreachable' && <ErrorBox error={state.error} onRetry={recheck} />}
        {/* Rendered in place of the page (no redirect), so signing in continues to the URL they opened. */}
        {state.status === 'signedOut' && <LoginPage notice={state.notice} />}
        {state.status === 'signedIn' && (
          <ErrorBoundary resetKey={pathname}>
            <Routes>
              <Route path="/" element={<AccountsPage />} />
              <Route path="/accounts/:slug" element={<AccountDetailPage />} />
              <Route path="/methodology" element={<MethodologyPage />} />
              <Route path="*" element={<p className="text-slate-600">Page not found.</p>} />
            </Routes>
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
