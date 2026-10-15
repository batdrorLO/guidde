import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import './index.css';

// Last-resort logging for anything that escapes React and the API client.
window.addEventListener('error', (e) => console.error('[ui] uncaught error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[ui] unhandled promise rejection', e.reason));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
