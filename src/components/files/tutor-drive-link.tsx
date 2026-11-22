'use client';
import { useEffect, useState } from 'react';
import { useSiteLanguage } from '@/components/site-language';
import styles from './files.module.css';

export function TutorDriveLink({ fileId }: { fileId: string }) {
  const language = useSiteLanguage();
  const [grant, setGrant] = useState<{fileId: string; url: string} | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/files/${fileId}/drive`, { cache: 'no-store', signal: controller.signal })
      .then(async response => response.ok ? (await response.json()).data?.url : null)
      .then(link => {
        if (!controller.signal.aborted && typeof link === 'string' && /^https:\/\/drive\.google\.com\/open\?id=[A-Za-z0-9_-]+$/.test(link)) setGrant({fileId, url: link});
      }).catch(() => {});
    return () => controller.abort();
  }, [fileId]);
  return grant?.fileId === fileId && <p><a className={styles.link} href={grant.url} target="_blank" rel="noopener noreferrer">{language === 'ar' ? 'فتح الشرائح في Google Drive' : 'Open slides in Google Drive'}</a></p>;
}
