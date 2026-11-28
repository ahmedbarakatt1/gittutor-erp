import { mergeConfig } from 'vitest/config';
import project from '../../vitest.config';

export default mergeConfig(project, {
  test: { setupFiles: ['tools/evidence/count-assertions.ts'] },
});
