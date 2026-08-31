// =====================================================================
//  "Bugungi davomat" — direktor, buxgalter va navbatchi uchun.
//
//  NEGA ALOHIDA SAHIFA: shu manzil ilgari HAMMAGA bitta ekranni
//  ochardi va o'qituvchi ham butun maktabning davomatini ko'rardi.
//  O'qituvchiga faqat o'z sinfi kerak — boshqa sinflarning bolalari
//  unga tegishli emas.
//
//  Endi manzil bitta, ekran esa rolga qarab: o'qituvchida `MyAttendance`
//  (faqat o'z sinflari, belgilash bilan), qolganlarda esa shu sahifa
//  (butun maktab, faqat ko'rish).
// =====================================================================

import { useT } from '@/i18n';
import { Notice, PageHeader } from '@/ui';
import { useAuth } from '@/auth/AuthProvider';
import { AttendanceToday } from '@/features/AttendanceToday';

export default function SchoolAttendance() {
  const t = useT();
  const { can, profile } = useAuth();

  //  Huquq brauzerda emas, bazada tekshiriladi — bu yerda faqat
  //  keraksiz so'rov yubormaslik uchun.
  if (!can('absences.mark') && !can('reports.view')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }

  return (
    <>
      <PageHeader
        title={t('att.todayTitle')}
        subtitle={profile?.school_name ?? ''}
      />
      <AttendanceToday />
    </>
  );
}
