import { sessionLength } from '../modules/catalog/public-tuition';

export const en = {
  locale: 'en-EG',
  direction: 'ltr' as const,
  brand: 'Git Tutor',
  metadata: {
    title: 'Git Tutor | Work through it, together.',
    description: 'Bring your course materials to a private tutor or a small study group. Explore Computer Science, Engineering, Business and Business Intelligence.',
  },
  navigation: {
    label: 'Main navigation',
    skip: 'Skip to content',
    subjects: 'Subjects',
    offers: 'See session pricing',
    formats: 'Pricing',
    how: 'How it works',
    faq: 'Questions',
    explore: 'Explore subjects',
    account: 'My account',
    teach: 'Teach with us',
  },
  hero: {
    title: 'Bring the slide you are stuck on.',
    emphasis: 'stuck on.',
    lead: 'Your course. Your questions. A tutor who helps you work through them.',
    body: 'Upload your slides or course notes and tell us what you need help with. We’ll find the right tutor and arrange your session.',
    primary: 'Request a session',
    secondary: 'See how it works',
    note: 'Private sessions and groups of 2 to 4 students.',
  },
  example: {
    title: 'One question. A clearer next step.',
    caption: 'Try a Computer Science example',
    topic: 'Binary search',
    question: 'How do we find 23 without checking every number?',
    valuesLabel: 'Sorted numbers, searching for 23',
    steps: [
      'Start in the middle: 16. Our target, 23, is larger, so look in the right half.',
      'Now check 56. Our target is smaller, so narrow the search to the numbers before it.',
      'Found 23. Each comparison removed half of the remaining possibilities.',
    ],
    next: 'See the next step',
    reset: 'Try again',
    currentLabel: 'Checking',
    foundLabel: 'Found',
    sample: 'Interactive learning example',
  },
  subjects: {
    title: 'Find your subject.',
    lead: 'Start with the course you are taking. Bring the question you want to understand.',
    items: [
      { name: 'Computer Science', description: 'Algorithms, programming and the logic behind them.', symbol: '{ }' },
      { name: 'Engineering', description: 'Work through the method, then put it into practice.', symbol: 'x²' },
      { name: 'Business', description: 'Connect the concepts to the decisions they explain.', symbol: '%' },
      { name: 'Business Intelligence', description: 'Make sense of data, analysis and clear reporting.', symbol: 'Σ' },
    ],
  },
  formats: {
    title: 'A little company.\nA lot of clarity.',
    lead: 'Study with a small group, or give your own questions the full session.',
    groupTitle: 'Small study groups',
    groupBody: 'Share the session with students working through the same topic. Every student has their own booking and preparation space.',
    students: 'students',
    perStudent: 'per student, per session',
    privateTitle: 'One-to-one learning',
    privateBody: `${sessionLength} shaped around your course materials, pace and questions.`,
    terms: `Sessions last ${sessionLength}. These prices are per student, per session. We confirm the exact time and booking terms after reviewing your request.`,
  },
  how: {
    title: 'From “I’m stuck” to “I get it.”',
    steps: [
      { title: 'Tell us what you need', body: 'Choose a learner, describe your topic and share your preferred times. Any course is welcome for review.' },
      { title: 'Upload your material', body: 'Add lecture slides, notes or questions and submit your request.' },
      { title: 'Review your session', body: 'We review the material and arrange a tutor. Check the proposed time, tuition and terms before booking.' },
      { title: 'Work through it', body: 'Join your tutor and keep the materials in your account.' },
    ],
  },
  faq: {
    title: 'Before you get started.',
    lead: 'A few things worth knowing about learning with Git Tutor.',
    items: [
      { question: 'Can I bring my own course materials?', answer: 'Yes. Bring the slides, questions or course notes you want to work through. Your private preparation files stay separate from shared teaching resources.' },
      { question: 'What is the difference between private and group sessions?', answer: 'Private sessions focus on one learner. Small groups bring 2, 3 or 4 students together for the same topic. Each learner keeps their own booking, payment record and private preparation files.' },
      { question: 'How do payments work?', answer: 'Your booking shows the approved payment instructions and the amount required for confirmation. Upload your transfer receipt, then the service team independently checks the incoming funds. Receipt review and booking confirmation are separate steps.' },
      { question: 'Where will I find the session link?', answer: 'Once your booking is confirmed and the meeting is ready, your account shows the session link alongside its schedule and preparation materials.' },
    ],
  },
  footer: {
    title: 'Bring your questions.',
    body: 'Start with what you want to understand.',
    back: 'Back to top',
    copyright: 'Git Tutor',
    support: 'Talk to Git Tutor on WhatsApp or by phone.',
  },
};

export type Messages = typeof en;
