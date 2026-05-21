import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// NOTE: the "ABS" stereo flag is hidden by seeding Ketcher's saved options in
// index.html (before this bundle loads) — doing it here would be too late,
// since Ketcher reads the option at module-init time.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
