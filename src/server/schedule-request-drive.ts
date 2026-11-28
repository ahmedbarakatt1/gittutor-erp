import { after } from 'next/server';

export function scheduleRequestDrive(target: { fileId?: string; requestId?: string } = {}) {
  const scanFile = target.fileId && process.env.REQUEST_MATERIAL_SCAN_ADAPTER === 'vercel_sandbox';
  if (scanFile || process.env.REQUEST_DRIVE_ADAPTER === 'google') after(async () => {
    if (scanFile) {
      try {
        const { runRequestMaterialScan } = await import('./request-material-scan');
        await runRequestMaterialScan(target.fileId);
      } catch { console.warn('Git Tutor request material scan pending'); }
    }
    try {
      const { syncRequestDrive } = await import('./request-drive-sync');
      await syncRequestDrive(target);
    } catch { console.warn('Git Tutor Drive material sync unavailable'); }
  });
}
