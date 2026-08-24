import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// =====================================================================
//  TZ 5.1 — maktab paneli va o'qituvchi PWA si BITTA kod bazasida.
//
//  PWA offline ma'lumot sinxronizatsiyasini QILMAYDI: moliyaviy
//  tizimda eskirgan raqam ko'rsatish zarardan boshqa narsa bermaydi.
//  Faqat ilova qobig'i keshlanadi, ma'lumot har doim tarmoqdan.
//
//  BASE YO'L: ilova ikki xil joyda ishlashi mumkin —
//    · mahalliy / Vercel        → "/"
//    · Supabase Edge Function   → "/functions/v1/panel/"
//  Ikkinchisi uchun `PANEL_BASE` muhit o'zgaruvchisi beriladi
//  (scripts/deploy-panel.mjs shuni qiladi).
// =====================================================================

const BASE = process.env.PANEL_BASE || '/';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg', 'apple-touch-icon.png', 'logo-mark.svg', 'logo-full.svg',
      ],
      workbox: {
        // Supabase so'rovlari HECH QACHON keshlanmaydi.
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//, /^\/storage\//],
        runtimeCaching: [],
      },
      manifest: {
        name: 'MaktabFinance',
        short_name: 'MaktabFinance',
        description: 'Maktab moliya va boshqaruv tizimi',
        lang: 'uz',
        theme_color: '#1E2B3D',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          // Android ikonkani kesib ko'rsatadi — maskable versiyada
          // belgi to'q ko'k fon ustida, markazda turadi.
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },

  build: {
    // Kutubxonalarni alohida bo'laklarga ajratamiz. Ular kamdan-kam
    // o'zgaradi, shuning uchun brauzer keshida uzoq turadi — ilova
    // yangilanganda foydalanuvchi faqat o'zgargan qismini yuklaydi.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          query: ['@tanstack/react-query'],
        },
      },
    },
    // Bo'laklarga ajratgandan keyin ogohlantirish chegarasi pasaytiriladi.
    chunkSizeWarningLimit: 400,
  },

  server: { port: 5173, strictPort: false },
});
