/*
 * INTER, ACTUALLY LOADED.
 *
 * --font-sans has named Inter since the theme was written and nothing ever fetched it, so every
 * screen in Raptor has been rendering in whatever ui-sans-serif resolves to — San Francisco on a
 * Mac or an iPad, Segoe on Windows, something else again on a Linux box. That is survivable at
 * 14px and it is not at 52px: a system stack has no proper light cut, so the Collections headline
 * was being synthesised or substituted, which is exactly what the firm was looking at when they
 * said the font looked wrong.
 *
 * SELF-HOSTED RATHER THAN FETCHED FROM GOOGLE. A webfont request carries the viewer's IP to a
 * third party on every page load, and this is a firm whose users are handling other people's
 * personal information all day. One dependency is cheaper than that conversation.
 */
import '@fontsource-variable/inter'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
