import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from '@/i18n';
import { AuthProvider } from '@/auth/AuthProvider';
import { applyTheme } from '@/layout/Controls';
import { ConfirmProvider, ToastProvider } from '@/ui/Feedback';
import App from './App';
import './index.css';

// Mavzuni birinchi bo'yashdan OLDIN qo'llaymiz — ekran "chaqnamasin".
try {
  const saved = localStorage.getItem('maktab-theme');
  if (saved === 'light' || saved === 'dark') applyTheme(saved);
} catch { /* maxfiy oyna */ }

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Moliyaviy ma'lumot — eskirgan raqam ko'rsatmaymiz.
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ConfirmProvider>
            <AuthProvider>
          {/* Ilova Supabase Edge Function ostida ham ishlashi mumkin,
              shuning uchun basename Vite ning BASE_URL idan olinadi. */}
              <BrowserRouter basename={import.meta.env.BASE_URL}>
                <App />
              </BrowserRouter>
            </AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);
