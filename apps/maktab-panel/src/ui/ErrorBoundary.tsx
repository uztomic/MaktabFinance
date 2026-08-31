// =====================================================================
//  Xato chegarasi — OQ EKRANNING oldini oladi.
//
//  MUAMMO. Ilovada birorta ham xato chegarasi yo'q edi. React da bu
//  shuni anglatadi: bitta komponentda kutilmagan xato chiqsa, React
//  BUTUN daraxtni yechib tashlaydi va sahifa oq bo'lib qoladi. Odam
//  uchun bu "tizim qotib qoldi" — nima bo'lgani ham, nima qilish
//  kerakligi ham ko'rinmaydi. Faqat brauzerni yangilash yordam beradi,
//  buni esa har kim ham o'ylab topmaydi.
//
//  Aynan shu hol kuzatildi: "sozlamalarga o'tsam ekran oppoq bo'lib
//  qotib qolyabdi".
//
//  YECHIM. Chegara xatoni ushlaydi va o'qiladigan xabar ko'rsatadi:
//  nima bo'lgani, qaysi sahifada va ikkita tugma — qaytadan urinish
//  yoki bosh sahifaga qaytish. Ilovaning qolgan qismi ishlab turaveradi.
//
//  DIQQAT: bu chegara xatoni YASHIRMAYDI. Texnik tafsilot yig'ilgan
//  bo'limda qoladi va konsolga ham yoziladi — muammoni topish uchun
//  kerak bo'ladi.
// =====================================================================

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Chegara qayta ishga tushishi uchun kalit (odatda sahifa yo'li). */
  resetKey?: string;
  /** Xato matnlari — tarjima chegaradan tashqarida hisoblanadi. */
  labels: {
    title: string;
    hint: string;
    retry: string;
    home: string;
    details: string;
  };
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    //  Boshqa sahifaga o'tilganda chegara tozalanadi — aks holda
    //  bitta xatodan keyin butun ilova qulf bo'lib qolardi.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    //  Konsolga yoziladi: brauzer vositalarida ko'rish uchun.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { labels } = this.props;

    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <div className="rounded-lg border bg-[var(--bg)] p-5 shadow-sm">
          <h2 className="text-base font-semibold">{labels.title}</h2>
          <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
            {labels.hint}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-md bg-brand-900 px-3 py-1.5 text-[13px]
                font-medium text-white hover:opacity-90"
            >
              {labels.retry}
            </button>
            <button
              type="button"
              //  To'liq qayta yuklash: eskirgan bo'lak yoki buzilgan
              //  holat shu bilan tozalanadi.
              onClick={() => { globalThis.location.href = '/'; }}
              className="rounded-md border px-3 py-1.5 text-[13px]
                hover:bg-[var(--bg-inset)]"
            >
              {labels.home}
            </button>
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-[12px] text-[var(--text-faint)]
              hover:text-[var(--text-muted)]">
              {labels.details}
            </summary>
            <pre className="mt-2 overflow-x-auto rounded bg-[var(--bg-inset)] p-3
              text-[11px] leading-relaxed text-[var(--text-muted)]">
              {error.message}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
