// =====================================================================
//  Kunlik davomat — BUTUN MAKTAB bo'yicha.
//
//  MUAMMO: sinf rahbari har kuni ertalab davomat olardi, lekin
//  natijasini faqat o'zi ko'rardi. Direktor, navbatchi va buxgalter
//  uchun "bugun kim keldi" degan savolga javob yo'q edi — har bir
//  sinfni alohida ochib chiqishdan boshqa yo'l qolmasdi.
//
//  ENG MUHIM USTUN — "davomat olinmagan" sinflar. Ular tepada va
//  sariq bo'lib turadi. Chunki e'tibor talab qiladigan hol aynan shu:
//  kelmagan bola emas (u yozib qo'yilgan), balki UMUMAN yozilmagan
//  sinf. Bunday sinfda bola yo'qolib qolsa hech kim bilmaydi.
//
//  Sinfni bosib ichkariga kirish mumkin — kim kelgani, kim kelmagani
//  va sababi ko'rinadi (TZ 4.12.6: har qanday raqamdan uni tashkil
//  qilgan yozuvlarga o'tish).
// =====================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { date, dateTime, isoDate } from '@/lib/format';
import { exportTable } from '@/lib/export';
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, Loading, Modal,
  Table, Td, Th, Tr,
} from '@/ui';

type ClassRow = {
  class_id: string;
  class_name: string;
  grade_level: number | null;
  teacher_name: string | null;
  total: number;
  present: number;
  absent: number;
  checked: boolean;
  marked_at: string | null;
};

export function AttendanceToday() {
  const t = useT();
  const { lang } = useI18n();
  const { branchId } = useAuth();

  const [day, setDay] = useState(isoDate());
  const [open, setOpen] = useState<ClassRow | null>(null);

  const rows = useQuery({
    queryKey: ['attendance-today', day, branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_attendance_today', {
        p_day: day,
        p_branch_id: branchId ?? undefined,
      });
      if (error) throw error;
      return (data ?? []) as ClassRow[];
    },
  });

  if (rows.isLoading) return <Loading />;
  if (rows.error) {
    return <ErrorState message={(rows.error as Error).message}
                       onRetry={() => rows.refetch()} />;
  }

  const list = rows.data ?? [];
  const totals = list.reduce((a, r) => ({
    total: a.total + r.total,
    present: a.present + r.present,
    absent: a.absent + r.absent,
  }), { total: 0, present: 0, absent: 0 });

  const unchecked = list.filter((r) => !r.checked && r.total > 0);

  //  Davomat olinmagan sinflar TEPADA — e'tibor talab qiladigan hol shu.
  const ordered = [...list].sort((a, b) => {
    if (a.checked !== b.checked) return a.checked ? 1 : -1;
    return (a.grade_level ?? 99) - (b.grade_level ?? 99)
      || a.class_name.localeCompare(b.class_name);
  });

  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[13px]">
            <span className="mb-1 block text-[var(--text-muted)]">
              {t('common.date')}
            </span>
            <Input type="date" value={day} max={isoDate()}
                   onChange={(e) => setDay(e.target.value)}
                   className="w-auto" />
          </label>

          <div className="flex flex-wrap gap-4">
            <Stat label={t('att.came')} value={totals.present} tone="ok" />
            <Stat label={t('att.notCame')} value={totals.absent} tone="danger" />
            <Stat label={t('att.students')} value={totals.total} />
          </div>

          <div className="flex-1" />

          <Button
            size="sm"
            onClick={() => exportTable(
              'davomat',
              [
                { header: t('students.class'), value: (r: ClassRow) => r.class_name },
                { header: t('cls.teacher'), value: (r: ClassRow) => r.teacher_name },
                { header: t('att.students'), value: (r: ClassRow) => r.total, numeric: true },
                { header: t('att.came'), value: (r: ClassRow) => r.present, numeric: true },
                { header: t('att.notCame'), value: (r: ClassRow) => r.absent, numeric: true },
                {
                  header: t('att.checked'),
                  value: (r: ClassRow) => (r.checked ? t('common.yes') : t('common.no')),
                },
              ],
              ordered,
              [t('att.overviewTitle'), date(day, lang)],
            )}
          >
            {t('common.export')}
          </Button>
        </div>

        {unchecked.length > 0 && (
          <p className="mt-3 rounded-md bg-[var(--warn-bg)] px-3 py-2 text-[13px]">
            {t('att.uncheckedHint', { count: String(unchecked.length) })}
          </p>
        )}
      </Card>

      <Card title={t('att.byClass')} padded={false}>
        {ordered.length === 0 ? <EmptyState /> : (
          <Table>
            <thead>
              <tr>
                <Th>{t('students.class')}</Th>
                <Th>{t('cls.teacher')}</Th>
                <Th align="right">{t('att.students')}</Th>
                <Th align="right">{t('att.came')}</Th>
                <Th align="right">{t('att.notCame')}</Th>
                <Th>{t('att.checked')}</Th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((r) => (
                <Tr key={r.class_id} className={!r.checked && r.total > 0
                  ? 'bg-[var(--warn-bg)]' : ''}>
                  <Td>
                    <button
                      type="button"
                      onClick={() => setOpen(r)}
                      className="font-medium hover:underline"
                    >
                      {r.class_name}
                    </button>
                  </Td>
                  <Td className="text-[13px] text-[var(--text-muted)]">
                    {r.teacher_name ?? '—'}
                  </Td>
                  <Td align="right" mono>{r.total}</Td>
                  <Td align="right" mono className="text-[var(--ok)]">
                    {r.present}
                  </Td>
                  <Td align="right" mono
                      className={r.absent > 0 ? 'text-[var(--danger)]' : ''}>
                    {r.absent || '—'}
                  </Td>
                  <Td>
                    {r.total === 0
                      ? <span className="text-[var(--text-faint)]">—</span>
                      : r.checked
                      ? (
                        <span className="text-[12px] text-[var(--text-muted)]">
                          {r.marked_at ? dateTime(r.marked_at, lang) : '✓'}
                        </span>
                      )
                      : <Badge tone="warn">{t('att.notChecked')}</Badge>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {open && (
        <ClassStudents row={open} day={day} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------

function Stat({ label, value, tone }: {
  label: string;
  value: number;
  tone?: 'ok' | 'danger';
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
      <div className={`num text-lg font-semibold ${
        tone === 'ok' ? 'text-[var(--ok)]'
          : tone === 'danger' && value > 0 ? 'text-[var(--danger)]' : ''}`}>
        {value}
      </div>
    </div>
  );
}

/** Sinf ichida kim kelgani. */
function ClassStudents({ row, day, onClose }: {
  row: ClassRow;
  day: string;
  onClose: () => void;
}) {
  const t = useT();
  const { lang } = useI18n();

  const students = useQuery({
    queryKey: ['class-attendance', row.class_id, day],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('class_attendance_students', {
        p_class_id: row.class_id,
        p_day: day,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Modal
      open
      wide
      title={`${row.class_name} — ${date(day, lang)}`}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      {students.isLoading ? <Loading /> : (students.data?.length ?? 0) === 0
        ? <EmptyState />
        : (
          <Table>
            <thead>
              <tr>
                <Th>{t('common.fullName')}</Th>
                <Th>{t('common.status')}</Th>
                <Th>{t('absences.reason')}</Th>
              </tr>
            </thead>
            <tbody>
              {students.data!.map((s) => (
                <Tr key={s.student_id}>
                  <Td>
                    <Link to={`/oquvchilar/${s.student_id}`}
                          className="font-medium hover:underline">
                      {s.full_name}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={s.is_present ? 'ok' : 'danger'}>
                      {s.is_present ? t('att.came') : t('att.notCame')}
                    </Badge>
                  </Td>
                  <Td className="text-[13px] text-[var(--text-muted)]">
                    {s.is_present ? '—' : (s.reason_name ?? t('att.noReason'))}
                    {s.note && (
                      <span className="ml-1.5 text-[11px] text-[var(--text-faint)]">
                        {s.note}
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
    </Modal>
  );
}
