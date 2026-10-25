import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { z } from 'zod'
import { Providers } from '@/app/providers'
import { router } from '@/app/router'
// Self-hosted font: the venue network should not depend on Google Fonts.
import '@fontsource/noto-sans-thai/400.css'
import '@fontsource/noto-sans-thai/500.css'
import '@fontsource/noto-sans-thai/600.css'
import '@fontsource/noto-sans-thai/700.css'
import '@/styles/index.css'

// The production CSP forbids eval; keep Zod off its `new Function` fast path.
z.config({ jitless: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
)
