import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { lazy, Suspense } from 'react'
const Content = lazy(() => location.search === '?controls' ? import('./components/DetachedControls').then(module=>({default:module.DetachedControls})) : import('./App'))
import './styles.css'
import { guardEventCleanup } from './lib/eventCleanup'

guardEventCleanup(window as Parameters<typeof guardEventCleanup>[0]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}><Content /></Suspense>
  </StrictMode>,
)
