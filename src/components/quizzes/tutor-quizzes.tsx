'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import type { FileView } from '@/modules/files/queries';
import type { TutorOccurrence } from '@/modules/booking/queries';
import type { SessionQuizzes } from '@/modules/teaching/quizzes';
import { quizCopy as copy } from '@/locales/quizzes';
import { cairoDate, cairoTime, Select } from '../booking/shared';
import { FileUpload } from '../files/file-upload';
import { IdentityForm, TextField } from '../identity-form';
import { PaymentReadState, usePaymentList, usePaymentRecord } from '../payments/shared';
import styles from './quizzes.module.css';

type TutorSession = Extract<SessionQuizzes, { view: 'tutor' }>;
type TutorQuiz = TutorSession['quizzes'][number];

export function TutorQuizzes({ initialOccurrence }: { initialOccurrence?: string }) {
  const [chosen, setChosen] = useState(initialOccurrence ?? '');
  const sessions = usePaymentList<TutorOccurrence>(initialOccurrence ? `tutor/occurrences?occurrence_id=${initialOccurrence}` : 'tutor/occurrences');
  return <section className={styles.workspace}>
    {initialOccurrence && <Link href="/tutor/quizzes">{copy.chooseSession}</Link>}
    <Select label={copy.session} name="quiz_session" value={chosen} onChange={setChosen}>
      <option value="">{copy.chooseSession}</option>
      {sessions.items?.filter(item => item.occurrence.state !== 'cancelled').map(({ occurrence, roster }) =>
        <option value={occurrence.occurrence_id} key={occurrence.occurrence_id}>
          {cairoDate(occurrence.start_at)} · {cairoTime(occurrence.start_at)} · {occurrence.format === 'group' ? copy.group : copy.individual}{roster.length ? ' · ' + roster.map(r => r.display_name).join(', ') : ''}
        </option>)}
    </Select>
    <PaymentReadState pending={!sessions.items} {...sessions} />
    {sessions.items?.length === 0 && <p>{copy.noSessions}</p>}
    {chosen && <QuizSession key={chosen} id={chosen} />}
  </section>;
}

function QuizSession({ id }: { id: string }) {
  const record = usePaymentRecord<SessionQuizzes>(`occurrences/${id}/quizzes?view=tutor`, true);
  const data = record.data;
  const [announcement, setAnnouncement] = useState('');
  function refresh(message: string) {
    setAnnouncement(message);
    record.reload();
  }
  return <div className={styles.workspace}>
    <p role="status">{announcement}</p>
    {data?.view === 'tutor' && <>
      <details className={styles.panel}><summary>{copy.add}</summary>
        <NewQuiz key={data.quizzes.length} id={id} quizzes={data.quizzes} onSaved={() => refresh(copy.published)} />
      </details>
      <h2>{copy.grades}</h2>
      {data.quizzes.length === 0 && <p className={styles.empty}>{copy.noQuizzes}</p>}
      {data.quizzes.map(quiz => <QuizGradebook key={quiz.quiz_id} quiz={quiz} roster={data.roster} onSaved={refresh} />)}
    </>}
    <PaymentReadState pending={!data} {...record} />
  </div>;
}

function NewQuiz({ id, quizzes, onSaved }: { id: string; quizzes: TutorQuiz[]; onSaved: () => void }) {
  const files = usePaymentList<FileView>(`files?occurrence_id=${id}&purpose=shared_handout`);
  const [recent, setRecent] = useState<FileView>();
  const [selected, setSelected] = useState('');
  const options = new Map<string, FileView>();
  for (const file of [...(files.items || []), ...(recent ? [recent] : [])]) {
    if (file.detected_type === 'application/pdf' && file.scan_state === 'clean' && file.can_download &&
        file.source_provenance === 'stored_object' && file.publication_state !== 'withdrawn' &&
        !quizzes.some(quiz => quiz.file_id === file.file_id)) options.set(file.file_id, file);
  }
  return <div className={styles.workspace}>
    <p>{copy.uploadHelp}</p>
    <FileUpload purpose="shared_handout" parentId={id} pdfOnly operationScope="session-quiz" onUploaded={() => setSelected('')}
      onReady={file => { setRecent(file); setSelected(file.file_id); files.reload(); }} />
    <PaymentReadState pending={!files.items} {...files} />
    <IdentityForm action={`occurrences/${id}/quizzes`} submitLabel={copy.publish} successMessage={copy.published}
      disabled={!options.has(selected)} onSaved={onSaved} payload={form => ({
        title: String(form.get('title')).trim(), file_id: selected, max_score: Number(form.get('max_score')),
      })}>
      <Select label={copy.available} name="file_id" value={options.has(selected) ? selected : ''} onChange={setSelected}>
        <option value="">{copy.chooseFile}</option>
        {Array.from(options.values(), file => <option key={file.file_id} value={file.file_id}>{file.filename}</option>)}
      </Select>
      <TextField name="title" label={copy.title} maxLength={160} />
      <PointField label={copy.max} name="max_score" min={0.01} max={10000} />
      <p>{copy.audience}</p>
    </IdentityForm>
  </div>;
}

function PointField({ label, name, min, max, initial }: { label: string; name: string; min: number; max: number; initial?: number }) {
  const id = useId();
  return <div className={styles.field}>
    <label htmlFor={id}>{label}</label>
    <input id={id} name={name} type="number" step="0.01" min={min} max={max} defaultValue={initial} required inputMode="decimal" />
  </div>;
}

function QuizGradebook({ quiz, roster, onSaved }: { quiz: TutorQuiz; roster: TutorSession['roster']; onSaved: (message: string) => void }) {
  const [selected, setSelected] = useState('');
  const grade = quiz.grades.find(row => row.learner_id === selected);
  return <details className={styles.panel}>
    <summary>{quiz.title}<span>{quiz.grades.length} / {roster.length} {copy.recorded}</span></summary>
    <div className={styles.workspace}>
      <p>{copy.max} · {quiz.max_score}{quiz.content_path === `/api/v1/files/${quiz.file_id}/content` && <> · <a href={quiz.content_path} download>{quiz.filename}</a></>}</p>
      {roster.length === 0 ? <p>{copy.noRoster}</p> : <Select label={copy.learner} name={'recipient-' + quiz.quiz_id} value={selected} onChange={setSelected}>
        <option value="">{copy.chooseLearner}</option>
        {roster.map(learner => <option value={learner.learner_id} key={learner.learner_id}>{learner.display_name}</option>)}
      </Select>}
      {selected && <IdentityForm key={selected + ':' + (grade?.version ?? 0)} action={`quizzes/${quiz.quiz_id}/grades`}
        submitLabel={grade ? copy.change : copy.save} successMessage={grade ? copy.updated : copy.saved}
        onSaved={() => onSaved(grade ? copy.updated : copy.saved)} payload={form => ({
          learner_id: selected, score: Number(form.get('score')), expected_version: grade?.version ?? 0,
        })}>
        <PointField label={copy.points} name="score" min={0} max={quiz.max_score} initial={grade?.score} />
        <p>{copy.privateGrade}</p>
      </IdentityForm>}
    </div>
  </details>;
}
