/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Loyihada ishlatiladigan muhit o'zgaruvchilari.
// Faqat VITE_ prefiksi bilan boshlangalari brauzerga chiqadi —
// service_role kaliti bu yerga HECH QACHON kelmaydi.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
