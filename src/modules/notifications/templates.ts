import { z } from 'zod';

export const notificationKinds = [
  'relationship', 'tutor_review', 'tutor_agreement', 'package', 'reservation', 'amendment',
  'session', 'receipt', 'payment', 'refund', 'preparation', 'handout', 'completion', 'earning',
  'payout', 'support', 'export', 'exception',
] as const;

export const notificationContentSchema = z.object({
  kind: z.enum(notificationKinds),
  locale: z.enum(['en', 'ar']),
  audience: z.enum(['customer', 'tutor', 'staff']),
  action_path: z.string().regex(/^\/(learn|tutor|admin|service)(\/[a-z0-9-]+)*(\?[a-z_]+=[a-f0-9-]{36})?$/),
  starts_at: z.iso.datetime({ offset: true }).nullable(),
}).strict();
export type NotificationContent = z.infer<typeof notificationContentSchema>;

type MessageCopy = [subject: string, body: string, action: string];
const messages = {
  en: {
    relationship: ['Your account permissions have changed', 'You can see the current permissions for your account in your portal.', 'View account'],
    tutor_review: ['Your teaching profile has an update', 'Your portal has the latest information about your teaching profile.', 'View profile update'],
    tutor_agreement: ['Your teaching agreement is ready to review', 'Open your tutor portal to read the agreement for this session.', 'Review agreement'],
    package: ['Your package has an update', 'Your package history shows the current balance and recent activity.', 'View package'],
    reservation: ['Your booking has an update', 'Check the current reservation status and any next steps in your bookings.', 'View booking'],
    amendment: ['Review a proposed session change', 'The session record has the details of the change and its current status.', 'View session change'],
    session: ['Your session has an update', 'Check the latest schedule and meeting details in your portal.', 'View session'],
    receipt: ['Your payment evidence has an update', 'Check the status of your receipt and any instructions from the review team.', 'View receipt status'],
    payment: ['Your payment record has an update', 'The payment record shows the current status and any remaining balance.', 'View payment'],
    refund: ['Your refund has an update', 'The refund record shows its current status and history.', 'View refund'],
    preparation: ['Preparation material is ready', 'Open the session in your portal to find the preparation material.', 'View session materials'],
    handout: ['Session resources are ready', 'You can find the shared resources for this session in your portal.', 'View resources'],
    completion: ['Your session record has an update', 'Open your portal to review the latest session record.', 'View session record'],
    earning: ['Your teaching statement has an update', 'Open the teaching statement to review recent entries.', 'View statement'],
    payout: ['Your payout has an update', 'The payout record shows the current status and recent activity.', 'View payout'],
    support: ['Your support conversation has an update', 'Open the conversation to see its latest activity.', 'View conversation'],
    export: ['Your requested export has an update', 'Check the status of the export in your portal.', 'View export'],
    exception: ['An operation needs your attention', 'Open the record to review the issue and available actions.', 'Review details'],
  },
  ar: {
    relationship: ['تم تحديث صلاحيات حسابك', 'يمكنك الاطلاع على صلاحيات حسابك الحالية من خلال بوابتك.', 'عرض الحساب'],
    tutor_review: ['يوجد تحديث لملفك التعليمي', 'ستجد في بوابتك أحدث المعلومات حول ملفك التعليمي.', 'عرض تحديث الملف'],
    tutor_agreement: ['اتفاق التدريس جاهز للمراجعة', 'افتح بوابة المدرس للاطلاع على اتفاق التدريس الخاص بهذه الجلسة.', 'مراجعة الاتفاق'],
    package: ['يوجد تحديث لباقتك', 'يعرض سجل الباقة رصيدك الحالي وآخر العمليات.', 'عرض الباقة'],
    reservation: ['يوجد تحديث لحجزك', 'يمكنك الاطلاع على حالة الحجز والخطوات التالية في صفحة الحجوزات.', 'عرض الحجز'],
    amendment: ['راجع التغيير المقترح للجلسة', 'يتضمن سجل الجلسة تفاصيل التغيير وحالته الحالية.', 'عرض تغيير الجلسة'],
    session: ['يوجد تحديث لجلستك', 'يمكنك مراجعة أحدث مواعيد الجلسة وتفاصيل الاجتماع في بوابتك.', 'عرض الجلسة'],
    receipt: ['يوجد تحديث لإثبات الدفع', 'راجع حالة الإيصال وأي تعليمات من فريق المراجعة.', 'عرض حالة الإيصال'],
    payment: ['يوجد تحديث لسجل الدفع', 'يوضح سجل الدفع الحالة الحالية وأي رصيد متبقٍ.', 'عرض سجل الدفع'],
    refund: ['يوجد تحديث لطلب الاسترداد', 'يوضح سجل الاسترداد حالة الطلب وتاريخه.', 'عرض طلب الاسترداد'],
    preparation: ['مواد التحضير جاهزة', 'افتح الجلسة في بوابتك للاطلاع على مواد التحضير.', 'عرض مواد الجلسة'],
    handout: ['موارد الجلسة جاهزة', 'ستجد الموارد التي تمت مشاركتها لهذه الجلسة في بوابتك.', 'عرض الموارد'],
    completion: ['يوجد تحديث لسجل الجلسة', 'افتح بوابتك للاطلاع على أحدث تفاصيل سجل الجلسة.', 'عرض سجل الجلسة'],
    earning: ['يوجد تحديث لكشف التدريس', 'افتح كشف مستحقات التدريس لمراجعة آخر القيود.', 'عرض الكشف'],
    payout: ['يوجد تحديث لمستحقاتك', 'يوضح سجل المستحقات حالة الصرف وآخر العمليات.', 'عرض المستحقات'],
    support: ['يوجد تحديث لمحادثة الدعم', 'افتح المحادثة للاطلاع على آخر المستجدات.', 'عرض المحادثة'],
    export: ['يوجد تحديث للتصدير المطلوب', 'يمكنك مراجعة حالة طلب التصدير في بوابتك.', 'عرض طلب التصدير'],
    exception: ['توجد عملية تحتاج إلى انتباهك', 'افتح السجل لمراجعة المشكلة والإجراءات المتاحة.', 'مراجعة التفاصيل'],
  },
} satisfies Record<NotificationContent['locale'], Record<NotificationContent['kind'], MessageCopy>>;

const labels = {
  en: { time: 'Session time in Cairo', footer: 'You received this email because of activity linked to your Git Tutor account.', staffAction: 'Open workspace', staffBody: 'Open your workspace to review the current record and any follow-up.' },
  ar: { time: 'موعد الجلسة بتوقيت القاهرة', footer: 'وصلتك هذه الرسالة بشأن نشاط مرتبط بحسابك على Git Tutor.', staffAction: 'فتح مساحة العمل', staffBody: 'افتح مساحة العمل لمراجعة السجل الحالي وأي متابعة مطلوبة.' },
};
// Staff may receive the same event as a learner or tutor without owning the booking or payout.
const staffSubjects: Record<NotificationContent['locale'], Partial<Record<NotificationContent['kind'], string>>> = {
  en: { reservation: 'Booking update', amendment: 'Session change update', session: 'Session update', receipt: 'Receipt review update', payment: 'Payment record update', refund: 'Refund update', completion: 'Session record update', earning: 'Teaching statement update', payout: 'Payout update', support: 'Support conversation update', export: 'Export request update' },
  ar: { reservation: 'تحديث الحجز', amendment: 'تحديث حول تغيير الجلسة', session: 'تحديث الجلسة', receipt: 'تحديث مراجعة الإيصال', payment: 'تحديث سجل الدفع', refund: 'تحديث طلب الاسترداد', completion: 'تحديث سجل الجلسة', earning: 'تحديث كشف مستحقات التدريس', payout: 'تحديث صرف المستحقات', support: 'تحديث محادثة الدعم', export: 'تحديث طلب التصدير' },
};

const htmlEntities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escape(value: string) {
  return value.replace(/[&<>"']/g, character => htmlEntities[character]);
}

export function notificationTitle(kind: NotificationContent['kind'], locale: NotificationContent['locale']) {
  return messages[locale][kind][0];
}

/** Only the validated notification projection may supply content to an email. */
export function renderNotification(input: NotificationContent, baseUrl: string) {
  const value = notificationContentSchema.parse(input);
  const base = new URL(baseUrl);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('NOTIFICATION_CONFIGURATION_INVALID');
  }
  if (value.audience === 'customer' && (['tutor_agreement', 'earning', 'payout'].includes(value.kind) || !value.action_path.startsWith('/learn'))) {
    throw new Error('NOTIFICATION_AUDIENCE_INVALID');
  }
  if (value.audience === 'tutor' && !value.action_path.startsWith('/tutor')) {
    throw new Error('NOTIFICATION_AUDIENCE_INVALID');
  }

  const { locale, kind } = value;
  const [personalSubject, personalBody, kindAction] = messages[locale][kind];
  const label = labels[locale];
  const staff = value.audience === 'staff';
  const subject = staff ? staffSubjects[locale][kind] ?? personalSubject : personalSubject;
  const body = staff ? label.staffBody : personalBody;
  const action = staff ? label.staffAction : kindAction;
  const url = new URL(value.action_path, base.origin).toString();
  const when = value.starts_at && new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value.starts_at));
  const text = [subject, body, when && `${label.time}\n${when}`, `${action}\n${url}`, label.footer].filter(Boolean).join('\n\n');
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const align = locale === 'ar' ? 'right' : 'left';
  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(subject)}</title></head>
<body dir="${dir}" style="margin:0;padding:0;background:#F8F6EF;color:#202121;font-family:Arial,Tahoma,sans-serif">
<div aria-hidden="true" style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escape(body)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F8F6EF"><tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="max-width:560px;border:1px solid #DDD9CE;border-top:4px solid #A92C2C;border-radius:8px">
<tr><td align="${align}" style="padding:22px 24px;border-bottom:1px solid #E5E2DA"><span lang="en" dir="ltr" style="display:inline-block;font-size:22px;line-height:28px;font-weight:bold;letter-spacing:-1px;color:#202121">Git Tutor<span style="color:#A92C2C">.</span></span></td></tr>
<tr><td align="${align}" dir="${dir}" style="padding:28px 24px;color:#202121">
<h1 style="margin:0;font-size:28px;line-height:1.25;font-weight:bold">${escape(subject)}</h1>
<p style="margin:14px 0 0;font-size:16px;line-height:1.6;color:#414342">${escape(body)}</p>
${when ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px"><tr><td align="${align}" bgcolor="#F8F6EF" style="padding:12px 16px"><p style="margin:0;font-size:14px;line-height:20px;color:#555852">${escape(label.time)}</p><p style="margin:2px 0 0;font-size:17px;line-height:24px;font-weight:bold">${escape(when)}</p></td></tr></table>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td height="22" aria-hidden="true"></td></tr><tr><td align="center" bgcolor="#A92C2C" style="border-radius:5px"><a href="${escape(url)}" style="display:inline-block;border:solid #A92C2C;border-width:12px 20px;border-radius:5px;background:#A92C2C;color:#FFFFFF;text-decoration:none;font-size:16px;line-height:22px;font-weight:bold">${escape(action)}</a></td></tr></table>
</td></tr>
<tr><td align="${align}" style="padding:16px 24px;border-top:1px solid #E5E2DA;font-size:13px;line-height:20px;color:#555852">${escape(label.footer)}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
  return { subject, text, html };
}
