// =====================================================================
//  Kirish sahifasi.
//
//  Bitta maydon email VA telefon raqamni qabul qiladi (foydalanuvchi
//  tanlovi bo'yicha ikkalasi ham qo'llab-quvvatlanadi):
//    · direktor va buxgalter — email bilan, parol tiklash ishlaydi
//    · navbatchi va o'qituvchi — telefon bilan; raqam sintetik
//      pochtaga aylantiriladi va parolni administrator tiklaydi
// =====================================================================

import { type FormEvent, useState } from 'react';
import { looksLikePhone, phoneToEmail, supabase } from '@/lib/supabase';
import { useT } from '@/i18n';
import { Button, Field, Input, Notice, Spinner } from '@/ui';
import { PasswordInput } from '@/ui/PasswordInput';
import { LangSwitcher, ThemeToggle } from '@/layout/Controls';

export default function LoginPage() {
  const t = useT();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const isPhone = looksLikePhone(login);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);

    const email = isPhone ? phoneToEmail(login) : login.trim();

    // Parol chetidagi bo'sh joy OLIB TASHLANADI. Odam ataylab
    // parolni bo'sh joy bilan boshlamaydi yoki tugatmaydi — bu
    // deyarli har doim mobil klaviaturaning ishi (so'z taklifidan
    // keyin avtomatik qo'shiladi) yoki nusxa ko'chirishdagi ortiqcha
    // belgi. Tizim yaratadigan parollarda ham bo'sh joy yo'q.
    const { error: err } = await supabase.auth.signInWithPassword({
      email,
      password: password.trim(),
    });

    setBusy(false);
    if (err) setError(t('auth.invalid'));
  }

  async function onForgot() {
    setError(null);
    setInfo(null);

    // Telefon bilan kirganlarda sintetik pochta bor — unga xat bormaydi.
    if (isPhone || !login.includes('@')) {
      setInfo(t('auth.resetPhoneOnly'));
      return;
    }

    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(login.trim(), {
      redirectTo: `${window.location.origin}/parol-tiklash`,
    });
    setBusy(false);

    if (err) setError(err.message);
    else setInfo(t('auth.resetSent'));
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-subtle)]">
      <div className="flex justify-end gap-2 p-4">
        <LangSwitcher />
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-start justify-center px-4 pb-16 pt-[6vh]">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center">
            <img
              src="/logo-mark.svg"
              alt=""
              className="h-16 w-16"
              width={64}
              height={64}
            />
            <h1 className="mt-3 text-lg font-semibold tracking-tight">
              <span className="text-[var(--brand-text)]">Maktab</span>
              <span className="text-accent-600">Finance</span>
            </h1>
            <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
              {t('app.tagline')}
            </p>
          </div>

          <form
            onSubmit={onSubmit}
            className="rounded-lg border bg-[var(--bg)] p-5 shadow-sm"
          >
            <h2 className="mb-1 text-sm font-semibold">{t('auth.title')}</h2>
            <p className="mb-4 text-[13px] text-[var(--text-muted)]">
              {t('auth.subtitle')}
            </p>

            <div className="space-y-3">
              <Field label={t('auth.login')} hint={t('auth.loginHint')} required>
                <Input
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  autoComplete="username"
                  inputMode={isPhone ? 'tel' : 'email'}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  required
                />
              </Field>

              <Field label={t('auth.password')} required>
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </Field>
            </div>

            {error && (
              <div className="mt-3 space-y-2">
                <Notice tone="danger">{error}</Notice>
                {/* Qaysi maydon xato ekani AYTILMAYDI — bu hujumchiga
                    "bunday login bor" degan ma'lumot berardi. Lekin
                    eng ko'p uchraydigan sababni eslatib qo'yish
                    hech narsani oshkor qilmaydi va yordam beradi. */}
                <p className="text-[12px] text-[var(--text-muted)]">
                  {t('auth.invalidHint')}
                </p>
              </div>
            )}
            {info && (
              <div className="mt-3">
                <Notice tone="neutral">{info}</Notice>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              disabled={busy || !login || !password}
              className="mt-4 w-full"
            >
              {busy && <Spinner />}
              {busy ? t('auth.signingIn') : t('auth.submit')}
            </Button>

            <button
              type="button"
              onClick={onForgot}
              disabled={busy}
              className="mt-3 w-full text-center text-[13px] text-[var(--text-muted)]
                hover:text-[var(--text)] hover:underline"
            >
              {t('auth.forgot')}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-[var(--text-faint)]">
            Uztomic Solutions
          </p>
        </div>
      </div>
    </div>
  );
}
