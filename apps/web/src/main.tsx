import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './tokens.css';
import './components.css';
import './ui.css';

// /economy is the public economy page: no session, no wallet code, its own chunk.
// Everything else is the game.
const Economy = lazy(() => import('./Economy'));
const isEconomy = window.location.pathname.replace(/\/+$/, '') === '/economy';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isEconomy ? <Suspense fallback={null}><Economy /></Suspense> : <App />}
  </StrictMode>,
);
// SW registration happens inside App (needs the update-prompt callback).
