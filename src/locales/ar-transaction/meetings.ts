const number = new Intl.NumberFormat('ar-EG');

export const meetingCopy = {
  manage: "إدارة الدخول إلى الغرفة",
  privateMeetVerified: "نجح اختبار غرفة Google Meet الخاصة", practiceRooms: "تستخدم الحجوزات التدريبية غرفًا تجريبية. ويمكن لحجز اختباري مُعتمد على حدة أن يستخدم Google Meet للمدرّس والطالب المحددين في الحجز.", revokeHint: "يؤدي إلغاء الربط إلى فصل حساب المنظّم عن Git Tutor.",
  title: "غرفة الجلسة", starts: "تبدأ بعد", scheduledNow: "بدأت الجلسة المجدولة.", ended: "انتهت الجلسة المجدولة.", refresh: "تحديث حالة الاجتماع", refreshShort: "تحديث", loading: "جارٍ التحقّق من غرفة الجلسة…", failed: "تعذّر تحميل تفاصيل الاجتماع. حدّث الصفحة للمحاولة مجددًا.",
  join: "الانضمام إلى الجلسة", joining: "جارٍ التحقّق من صلاحية الدخول…", live: "Google Meet", preview: "معاينة الاجتماع التجريبي", simulated: "غرفة تدريب · اجتماع تجريبي", previewTitle: "معاينة الغرفة التجريبية", previewDescription: "تأكّد إذن الدخول. تفتح هذه الغرفة معاينة تدريبية فقط.", close: "إغلاق المعاينة", verification: "يلزم التحقّق من إعداد الغرفة الفعلية.",
  status: { not_requested: "لم يُطلب تجهيز الغرفة", pending: "جارٍ تجهيز الغرفة", ready: "الغرفة جاهزة", failed: "تحتاج الغرفة إلى مراجعة", revoked: "أُلغيت صلاحية الدخول" } as Record<string, string>,
  reasons: { CALENDAR_ORGANIZER_CAPACITY: "لدى جميع منظّمي Google Meet المتاحين جلسات تتداخل مع هذا الموعد. اربط حساب منظّم آخر أو غيّر موعد الجلسة.", NOT_CONFIRMED: "يمكن الانضمام إلى الاجتماع بعد تأكيد هذا الحجز.", PROVISIONING: "يجري تجهيز الغرفة. ستتحقّق هذه الصفحة من حالتها تلقائيًا.", AUTHORIZATION_REQUIRED: "لا يملك حسابك الحالي إذن الدخول إلى هذه الغرفة.", ACCESS_REVOKED: "أُلغيت صلاحية الدخول إلى الاجتماع.", PROVIDER_FAILED: "توجد مشكلة لدى مزوّد الخدمة. يجب على فريق الخدمة فحص الغرفة.", LIVE_VERIFICATION_REQUIRED: "يلزم التحقّق من إعداد مزوّد الخدمة الفعلي قبل استخدام هذه الغرفة.", SESSION_ENDED: "انتهت مهلة الانضمام إلى هذه الجلسة." } as Record<string, string>,
  retry: "إعادة التحقّق من تجهيز الغرفة", retried: "أُضيف طلب فحص الغرفة إلى قائمة الانتظار.", replace: "استبدال رابط الدخول إلى الاجتماع", replaceDescription: "يُلغي هذا الإجراء صلاحية الدخول القديمة من البوابة ويطلب تجهيز غرفة جديدة. إذا سبق نسخ رابط الاجتماع، يخضع الدخول منه لضوابط القبول لدى مزوّد الخدمة.", replaceReason: "سبب استبدال رابط الدخول", replaced: "طُلب الاستبدال. يمكن الانضمام بعد تجهيز الغرفة الجديدة.",
  integrations: "الخدمات المرتبطة", integrationTitle: "ربط التقويم", integrationDescription: "إدارة حسابات الاجتماعات وقنوات التواصل.",
  mode: "وضع التشغيل", fakeMode: "تقويم تجريبي", googleMode: "تقويم Google", connectionState: "حالة الربط", organizer: "المنظّم", lastVerified: "آخر تحقّق", neverVerified: "لم يُسجَّل بعد أي تحقّق من الاتصال الفعلي.", connect: "ربط تقويم Google", reconnect: "إعادة ربط تقويم Google", connectFake: "ربط التقويم التجريبي", connectedFake: "تم ربط حساب المنظّم التجريبي.", revoke: "إلغاء ربط التقويم", revoked: "أُلغي ربط التقويم.", connectFailed: "تعذّر بدء ربط التقويم. أعد المحاولة.",
  states: { not_connected: "غير متصل", connected: "متصل", preview_connected: "حساب المنظّم متصل للاختبار", reauthorization_required: "يلزم تجديد التفويض", revoked: "أُلغي الربط", simulated: "تجريبي", verification_required: "يلزم التحقّق", verified: "تم التحقّق" } as Record<string, string>,
  oauthResults: {
    connected: "وافقت Google على تفويض حساب المنظّم هذا.",
    verified: "تم التحقّق من Google Meet. يمكن لهذا المنظّم استضافة الجلسات.",
    check_required: "وافقت Google على تفويض الحساب، لكن فحص الغرفة لم يكتمل. اختر «إدارة» ثم أعد الربط والتحقّق قبل إسناد جلسة.",
    conflict: "حساب Google هذا مرتبط مسبقًا أو يختلف عن الحساب الذي اخترت إعادة ربطه.",
    reauthorize: "لم يكتمل تفويض Google. اختر حساب المنظّم وحاول مجددًا.",
    stale: "تغيّرت بيانات المنظّم أثناء الربط. حدّث قائمة الحسابات وحاول مجددًا.",
    unavailable: "تعذّر إتمام الربط. حدّث قائمة الحسابات وحاول مجددًا.",
  } as Record<string, string>,
  countdown: (days: number, hours: number, minutes: number) => `${days ? `${number.format(days)} ي · ` : ''}${number.format(hours)} س · ${number.format(minutes)} د`,
};
