import { BadRequestException } from '@nestjs/common';
import { BrandingService, MAX_LOGO_BYTES } from './branding.service';

/** A real 1×1 transparent PNG. */
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function setup() {
  const prisma = {
    organization: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ logoMime: null }),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new BrandingService(prisma as never, audit as never);
  return { service, prisma, audit };
}

const codeOf = async (p: Promise<unknown>) => {
  try { await p; return 'resolved'; } catch (e) {
    return e instanceof BadRequestException ? (e.getResponse() as { code: string }).code : 'other';
  }
};

describe('BrandingService.setLogo', () => {
  it('stores a valid PNG and audits the change', async () => {
    const { service, prisma, audit } = setup();
    const res = await service.setLogo('org-1', 'user-1', `data:image/png;base64,${PNG_1PX}`);
    expect(res.logo?.mime).toBe('image/png');
    const data = prisma.organization.update.mock.calls[0][0].data;
    expect(data.logoMime).toBe('image/png');
    expect(Buffer.isBuffer(data.logoData)).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE', entityType: 'Organization' }));
  });

  it('refuses SVG, which can carry script', async () => {
    const { service, prisma } = setup();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    expect(await codeOf(service.setLogo('org-1', 'u', `data:image/svg+xml;base64,${svg}`))).toBe('LOGO_FORMAT');
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('refuses content that does not match its declared type', async () => {
    const { service } = setup();
    const notPng = Buffer.from('GIF89a-pretending-to-be-png').toString('base64');
    expect(await codeOf(service.setLogo('org-1', 'u', `data:image/png;base64,${notPng}`))).toBe('LOGO_CONTENT');
  });

  it('refuses a file over the size cap', async () => {
    const { service } = setup();
    const big = Buffer.concat([Buffer.from(PNG_1PX, 'base64'), Buffer.alloc(MAX_LOGO_BYTES)]).toString('base64');
    expect(await codeOf(service.setLogo('org-1', 'u', `data:image/png;base64,${big}`))).toBe('LOGO_SIZE');
  });
});

describe('BrandingService public resolution', () => {
  it('answers for the only active organisation', async () => {
    const { service, prisma } = setup();
    prisma.organization.findMany.mockResolvedValue([{ id: 'only' }]);
    prisma.organization.findUnique.mockResolvedValue({ logoMime: null, logoUpdatedAt: null });
    expect(await service.info()).toEqual({ logo: null });
    expect(prisma.organization.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'only' } }));
  });

  it('gives no answer when several organisations exist and none is named', async () => {
    const { service, prisma } = setup();
    prisma.organization.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    expect(await service.logo()).toBeNull();
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });
});
