// =====================================================================
//  Tashkilot turi: maktab yoki o'quv markazi.
//
//  Tur almashtirilganda MA'LUMOT O'CHMAYDI — faqat menyu, atamalar va
//  bosh sahifa almashadi. Shuning uchun direktor bemalol sinab ko'ra
//  oladi. Moliya (hisoblanma, to'lov, qarzdorlik, oylik) ikkala turda
//  bir xil ishlaydi.
// =====================================================================

import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useT } from '@/i18n';
import { Card } from '@/ui';
import { useConfirm, useToast } from '@/ui/Feedback';

const TYPES = [
  { id: 'school', icon: '🏫' },
  { id: 'learning_center', icon: '🎓' },
  { id: 'kindergarten', icon: '🧸' },
] as const;

export function OrgTypeCard() {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const { profile, reload } = useAuth();

  const save = useMutation({
    mutationFn: async (type: string) => {
      const { error } = await supabase.rpc('set_org_type', { p_type: type });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.ok(t('ux.saved'));
      await reload();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (profile?.role !== 'director') return null;

  return (
    <Card title={t('org.title')} className="mb-4">
      <p className="mb-3 text-[13px] text-[var(--text-muted)]">{t('org.hint')}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {TYPES.map((x) => {
          const on = profile.org_type === x.id;
          return (
            <button key={x.id} type="button" disabled={on || save.isPending}
              onClick={async () => {
                if (await confirm({ title: t(`org.${x.id}`), message: t('org.confirm') })) save.mutate(x.id);
              }}
              aria-pressed={on}
              className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors
                ${on ? 'border-[var(--sel-border)] bg-[var(--sel-bg)]' : 'hover:bg-[var(--bg-subtle)]'}`}>
              <span className="text-2xl leading-none" aria-hidden>{x.icon}</span>
              <span>
                <span className="block text-[14px] font-semibold">
                  {t(`org.${x.id}`)}{on && <span className="ml-2 text-[12px] font-medium text-[var(--ok)]">✓ {t('org.current')}</span>}
                </span>
                <span className="block text-[12px] text-[var(--text-muted)]">{t(`org.${x.id}Hint`)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
