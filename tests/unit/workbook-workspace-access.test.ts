import { expect, test, vi } from 'vitest';
import { getWorkflowOperations } from '../../src/modules/workflow-import/operational-queries';

test('each workbook read names its workspace and validates the matching response role before returning data', async () => {
  for (const [workspace, role] of [['learn', 'customer'], ['tutor', 'tutor'], ['service', 'service'], ['admin', 'owner']] as const) {
    const data = { enabled: true, role, mapping_options: { learners: [], tutors: [] }, sections: [] };
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    expect(await getWorkflowOperations({ rpc }, workspace)).toEqual(data);
    expect(rpc).toHaveBeenCalledWith('get_workspace_operations', { p_workspace: workspace });
    const otherRole = role === 'owner' ? 'service' : 'owner';
    rpc.mockResolvedValue({ data: { ...data, role: otherRole }, error: null });
    await expect(getWorkflowOperations({ rpc }, workspace)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  }
});
