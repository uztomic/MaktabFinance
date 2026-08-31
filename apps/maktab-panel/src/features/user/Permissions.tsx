// =====================================================================
//  HUQUQLAR — rol nima berayotgani va shaxsiy o'zgartirish
//
//  Ilgari xodim qo'shayotgan odam ROL NOMINI ko'rardi va tamom:
//  "Qabul menejeri" degan yozuv unga aniq nima ruxsat berilishini
//  aytmasdi. Natijada keraksiz keng rol tanlanardi — "direktor
//  qilib qo'yaqolay, keyin ko'ramiz".
//
//  Endi tanlangan rol beradigan huquqlar to'liq ko'rinadi. Ustiga
//  har birini alohida qo'shish yoki olib qo'yish mumkin: maktabda
//  bitta buxgalterga qarzdorlik ishonib topshiriladi, ikkinchisiga
//  yo'q. Ilgari bunday holatda yagona yo'l rolni o'zgartirish edi va
//  u keragidan ko'p ruxsat berardi.
// =====================================================================

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useT } from '@/i18n';
import { Badge, Loading, Notice } from '@/ui';

export interface PermRow {
  permission: string;
  from_role: boolean;
  override: boolean | null;
  effective: boolean;
}

/** Rol bo'yicha huquqlar — hali yaratilmagan xodim uchun ham. */
export function useRolePermissions(role: string) {
  return useQuery({
    queryKey: ['role-permissions', role],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('role_permissions')
        .select('permission, allowed, school_id')
        .eq('role', role as 'director' | 'accountant' | 'manager' | 'duty' | 'teacher');
      if (error) throw error;

      //  Maktab moslamasi platforma standartidan ustun.
      const merged = new Map<string, boolean>();
      for (const p of data ?? []) {
        if (p.school_id === null && !merged.has(p.permission)) {
          merged.set(p.permission, p.allowed);
        }
      }
      for (const p of data ?? []) {
        if (p.school_id !== null) merged.set(p.permission, p.allowed);
      }
      return [...merged.entries()]
        .map(([permission, allowed]) => ({ permission, allowed }))
        .sort((a, b) => a.permission.localeCompare(b.permission));
    },
  });
}

/**
 *  Yangi xodim qo'shayotganda — faqat ko'rsatish.
 *
 *  Bu bosqichda xodim hali yo'q, shuning uchun shaxsiy o'zgartirish
 *  ham bo'lishi mumkin emas. Saqlangandan keyin kartochkasidan
 *  o'zgartiriladi.
 */
export function RolePermissionList({ role }: { role: string }) {
  const t = useT();
  const perms = useRolePermissions(role);

  if (perms.isLoading) return <Loading />;

  const allowed = (perms.data ?? []).filter((p) => p.allowed);
  const denied = (perms.data ?? []).filter((p) => !p.allowed);

  return (
    <div className="rounded-md border bg-[var(--bg-subtle)] p-3">
      <div className="mb-2 text-[12px] font-medium">
        {t('perm.roleGives', { count: allowed.length })}
      </div>

      <div className="flex flex-wrap gap-1">
        {allowed.map((p) => (
          <Badge key={p.permission} tone="ok">
            {t(`perm.${p.permission}`)}
          </Badge>
        ))}
        {allowed.length === 0 && (
          <span className="text-[12px] text-[var(--text-muted)]">
            {t('perm.none')}
          </span>
        )}
      </div>

      {denied.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 opacity-60">
          {denied.map((p) => (
            <Badge key={p.permission} tone="neutral">
              {t(`perm.${p.permission}`)}
            </Badge>
          ))}
        </div>
      )}

      <p className="mt-2 text-[11px] text-[var(--text-muted)]">
        {t('perm.afterSave')}
      </p>
    </div>
  );
}

/**
 *  Mavjud xodim — o'zgartirish bilan.
 *
 *  Har bir huquq uchun uchta holat bor: roldan kelgan, qo'lda
 *  qo'shilgan va qo'lda olib qo'yilgan. Ularni ajratib ko'rsatish
 *  shart — aks holda bir oydan keyin nega bu odamda shu ruxsat
 *  borligini hech kim tushuntira olmaydi.
 */
export function UserPermissionEditor({ userId, canEdit, onToggle, busy }: {
  userId: string;
  canEdit: boolean;
  onToggle: (permission: string, next: boolean | null) => void;
  busy: boolean;
}) {
  const t = useT();

  const matrix = useQuery({
    queryKey: ['user-permissions', userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('user_permission_matrix', {
        p_user_id: userId,
      });
      if (error) throw error;
      return (data ?? []) as PermRow[];
    },
  });

  if (matrix.isLoading) return <Loading />;
  const rows = matrix.data ?? [];

  return (
    <div className="space-y-2">
      <Notice tone="neutral">{t('perm.editorHint')}</Notice>

      <div className="divide-y rounded-md border">
        {rows.map((r) => {
          const changed = r.override !== null && r.override !== r.from_role;
          return (
            <label
              key={r.permission}
              className="flex items-center gap-3 px-3 py-2 text-[13px]"
            >
              <input
                type="checkbox"
                checked={r.effective}
                disabled={!canEdit || busy}
                onChange={(e) => {
                  const next = e.target.checked;
                  //  Rol beradigan holatga qaytsa — o'zgartirish
                  //  butunlay olib tashlanadi. Aks holda rol
                  //  o'zgartirilganda eski o'zgartirish yopishib
                  //  qolardi.
                  onToggle(r.permission, next === r.from_role ? null : next);
                }}
                className="h-4 w-4 shrink-0"
              />
              <span className="min-w-0 flex-1">
                {t(`perm.${r.permission}`)}
                <span className="ml-2 text-[11px] text-[var(--text-faint)]">
                  {r.permission}
                </span>
              </span>
              {changed
                ? (
                  <Badge tone={r.override ? 'brand' : 'danger'}>
                    {r.override ? t('perm.added') : t('perm.removed')}
                  </Badge>
                )
                : r.from_role
                  ? <Badge tone="neutral">{t('perm.fromRole')}</Badge>
                  : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}
