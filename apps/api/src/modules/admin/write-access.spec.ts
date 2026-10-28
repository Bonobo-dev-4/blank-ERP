import { AdminService } from './admin.service';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../common/auth/guards';
import { AdminController } from './admin.controller';

describe('integration write access', () => {
  function setup(found = true) {
    const conn = { id: 'c1', provider: 'UNICOMMERCE', allowExternalWrites: false, isEnabled: true };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      integrationConnection: {
        findFirst: jest.fn(async () => (found ? conn : null)),
        update: jest.fn(async ({ data }: { data: { allowExternalWrites: boolean } }) => ({ ...conn, ...data })),
      },
      inTransaction: jest.fn(async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(db)),
    };
    const audit = { record: jest.fn() };
    const service = new AdminService(db as never, audit as never);
    return { service, db, audit };
  }

  it('changes the flag and audits who, what and why', async () => {
    const s = setup();
    const r = await s.service.setIntegrationWriteAccess('org', 'u1', 'c1', { allow: true, reason: 'Go-live for switching' });
    expect(r.allowExternalWrites).toBe(true);
    expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'u1', entityType: 'IntegrationConnection', entityId: 'c1',
      context: expect.objectContaining({ field: 'allowExternalWrites', from: false, to: true, reason: 'Go-live for switching' }),
    }), expect.anything());
  });

  it('refuses a connection of another organisation', async () => {
    await expect(setup(false).service.setIntegrationWriteAccess('org', 'u1', 'c1', { allow: true, reason: 'whatever' }))
      .rejects.toMatchObject({ response: { code: 'INTEGRATION_NOT_FOUND' } });
  });

  it('is an administrator action', () => {
    expect(new Reflector().get(PERMISSIONS_KEY, AdminController.prototype.setWriteAccess)).toEqual(['admin.manage_settings']);
  });
});
