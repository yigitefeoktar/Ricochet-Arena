import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {initializeGameplayAnalytics} from './analytics/gameplayAnalytics.ts';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Initialization only loads configuration/SDK code. Gameplay events remain
// non-blocking and are flushed later by the isolated analytics queue.
initializeGameplayAnalytics();
