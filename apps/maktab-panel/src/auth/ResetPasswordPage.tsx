// =====================================================================
//  Parolni tiklash sahifasi.
//
//  NEGA ALOHIDA SAHIFA: kirish sahifasidagi "Parolni unutdim" xat
//  yuboradi va xatdagi havola `/parol-tiklash` ga olib keladi.
//  Bu sahifa bo'lmasa havola bosh sahifaga tushib qolardi — ya'ni
//  foydalanuvchi ichkariga kirar, lekin YANGI PAROLNI QO'YOLMASDI
//  va keyingi safar yana kira olmasdi.
//
//  Havoladagi token supabase-js tomonidan avtomatik o'qiladi va
//  vaqtinchalik sessiya ochiladi. Shu sessiya ichida `updateUser`
//  yangi parolni o'rnatadi.
// =====================================================================

import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useT } from '@/i18n';
import { Button, Field, Input, Notice, Spinner } from '@/ui';
import { LangSwitcher, ThemeToggle } from '@/layout/Controls';

/** Supabase minimal 8 ta belgini talab qiladi. */
const MIN_LENGTH = 8;

export default function ResetPasswordPage() {
  const t = useT();
  const navigate = useNavigate();

  const [ready, setReady] = useState(false);
  const [valid, setValid] = useState(false);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Havoladagi token sessiyaga aylanganini kutamiz. Xat eskirgan
  // bo'lsa sessiya bo'lmaydi — buni foydalanuvchiga aytamiz.
  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setValid(!!data.session);
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      if (event === 'PASSWORD_RECOVERY' || session) {
        setValid(true);
        setReady(true);
      }
    });

    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(t('auth.passwordShort', { n: MIN_LENGTH }));
      return;
    }
    if (password !== repeat) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);

    if (err) { setError(err.message); return; }

    setDone(true);
    // Yangi parol bilan ishlashda davom etadi — qayta kirish shart emas.
    setTimeout(() => navigate('/', { replace: true }), 1500);
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
            <img src="/logo-mark.svg" alt="" className="h-16 w-16"
                 width={64} height={64} />
            <h1 className="mt-3 text-lg font-semibold tracking-tight">
              <span className="text-brand-900 dark:text-brand-100">Maktab</span>
              <span className="text-accent-600">Finance</span>
            </h1>
          </div>

          <div className="rounded-lg border bg-[var(--bg)] p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold">
              {t('auth.newPassword')}
            </h2>

            {!ready
              ? <div className="py-6 text-center"><Spinner /></div>
              : done
              ? (
                <div className="space-y-3 py-2 text-center">
                  <div className="text-3xl">✅</div>
                  <p className="text-[13px]">{t('auth.passwordChanged')}</p>
                </div>
              )
              : !valid
              ? (
                <div className="space-y-3">
                  <Notice tone="danger">{t('auth.linkExpired')}</Notice>
                  <Button className="w-full"
                          onClick={() => navigate('/', { replace: true })}>
                    {t('auth.backToLogin')}
                  </Button>
                </div>
              )
              : (
                <form onSubmit={onSubmit} className="space-y-3">
                  <p className="text-[13px] text-[var(--text-muted)]">
                    {t('auth.newPasswordHint', { n: MIN_LENGTH })}
                  </p>

                  <Field label={t('auth.newPassword')} required>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      autoFocus
                      required
                    />
                  </Field>

                  <Field label={t('auth.repeatPassword')} required>
                    <Input
                      type="password"
                      value={repeat}
                      onChange={(e) => setRepeat(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                  </Field>

                  {error && <Notice tone="danger">{error}</Notice>}

                  <Button
                    type="submit" variant="primary" className="w-full"
                    disabled={busy || !password || !repeat}
                  >
                    {busy ? t('common.saving') : t('auth.savePassword')}
                  </Button>
                </form>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
