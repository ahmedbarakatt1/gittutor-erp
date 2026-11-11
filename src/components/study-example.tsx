'use client';

import { useState } from 'react';
import type { Messages } from '@/locales/en';

const values = [2, 5, 8, 12, 16, 23, 38, 56, 72, 91];
const frames = [
  { low: 0, high: 9, middle: 4 },
  { low: 5, high: 9, middle: 7 },
  { low: 5, high: 6, middle: 5 },
];

export function StudyExample({ copy }: { copy: Messages['example'] }) {
  const [step, setStep] = useState(0);
  const frame = frames[step];
  const found = step === frames.length - 1;

  return (
    <section className="study-example" aria-labelledby="study-example-title">
      <div className="example-heading">
        <span>{copy.caption}</span>
        <span className="example-topic">{copy.topic}</span>
      </div>
      <h2 id="study-example-title">{copy.question}</h2>
      <div className="search-numbers" role="list" aria-label={copy.valuesLabel}>
        {values.map((value, index) => (
          <span
            key={value}
            role="listitem"
            className={[
              'search-number',
              index < frame.low || index > frame.high ? 'is-excluded' : '',
              index === frame.middle ? 'is-current' : '',
              found && index === frame.middle ? 'is-found' : '',
            ].filter(Boolean).join(' ')}
            aria-label={`${value}${index === frame.middle ? `, ${found ? copy.foundLabel : copy.currentLabel}` : ''}`}
          >
            {value}
          </span>
        ))}
      </div>
      <p className="example-explanation" role="status" aria-live="polite" aria-atomic="true">{copy.steps[step]}</p>
      <button className="example-button" type="button" onClick={() => setStep(found ? 0 : step + 1)}>
        {found ? copy.reset : copy.next}
      </button>
      <p className="example-caption">{copy.sample}</p>
    </section>
  );
}
