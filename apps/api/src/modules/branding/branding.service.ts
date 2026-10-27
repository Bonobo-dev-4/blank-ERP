import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';

/** A brand mark is shown at most ~130px; 64 KB is generous for that. */
export const MAX_LOGO_BYTES = 64 * 1024;

/**
 * Raster formats only, each checked against the file's own signature bytes.
 * SVG is refused outright: it can carry script, and the logo is served from
 * the API's own origin.
 */
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
};

/**
 * The organisation's logo.
 *
 * Read publicly — the sign-in screen shows it before anyone has a session —
 * and written only with `admin.manage_settings`. Stored on the organisation
 * row rather than in `settings`, because a settings save replaces that whole
 * object and would silently drop the logo.
 */
@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Which organisation a public request means: the one named by code, or —
   * on a single-organisation install — the only active one. With several
   * organisations and no code, there is no single answer, so none is given.
   */
  private async resolveOrgId(code?: string): Promise<string | null> {
    if (code) {
      const org = await this.prisma.organization.findUnique({ where: { code }, select: { id: true } });
      return org?.id ?? null;
    }
    const orgs = await this.prisma.organization.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
      take: 2,
    });
    return orgs.length === 1 ? orgs[0]!.id : null;
  }

  async info(code?: string) {
    const id = await this.resolveOrgId(code);
    if (!id) return { logo: null };
    const org = await this.prisma.organization.findUnique({
      where: { id },
      select: { logoMime: true, logoUpdatedAt: true },
    });
    return {
      logo: org?.logoMime && org.logoUpdatedAt
        ? { mime: org.logoMime, updatedAt: org.logoUpdatedAt.toISOString() }
        : null,
    };
  }

  async logo(code?: string): Promise<{ mime: string; data: Buffer; updatedAt: Date } | null> {
    const id = await this.resolveOrgId(code);
    if (!id) return null;
    const org = await this.prisma.organization.findUnique({
      where: { id },
      select: { logoMime: true, logoData: true, logoUpdatedAt: true },
    });
    if (!org?.logoMime || !org.logoData || !org.logoUpdatedAt) return null;
    return { mime: org.logoMime, data: Buffer.from(org.logoData), updatedAt: org.logoUpdatedAt };
  }

  async setLogo(organizationId: string, actorUserId: string, dataUrl: string) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) {
      throw new BadRequestException({
        code: 'LOGO_FORMAT',
        message: 'Upload a PNG, JPEG or WebP image. SVG and other formats are not accepted.',
      });
    }
    const mime = match[1]!;
    const data = Buffer.from(match[2]!, 'base64');
    if (data.length === 0 || data.length > MAX_LOGO_BYTES) {
      throw new BadRequestException({
        code: 'LOGO_SIZE',
        message: `The logo must be at most ${MAX_LOGO_BYTES / 1024} KB after resizing.`,
        details: { bytes: data.length, maxBytes: MAX_LOGO_BYTES },
      });
    }
    if (!SIGNATURES[mime]!(data)) {
      throw new BadRequestException({
        code: 'LOGO_CONTENT',
        message: 'The file content does not match its image type.',
      });
    }

    const before = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { logoMime: true },
    });
    const updatedAt = new Date();
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { logoMime: mime, logoData: data, logoUpdatedAt: updatedAt },
    });
    await this.audit.record({
      organizationId, actorUserId, action: 'UPDATE',
      entityType: 'Organization', entityId: organizationId,
      diff: { logo: { from: before.logoMime ?? null, to: mime } },
      context: { field: 'logo', bytes: data.length },
    });
    return { logo: { mime, updatedAt: updatedAt.toISOString() } };
  }

  async clearLogo(organizationId: string, actorUserId: string) {
    const before = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { logoMime: true },
    });
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { logoMime: null, logoData: null, logoUpdatedAt: null },
    });
    if (before.logoMime) {
      await this.audit.record({
        organizationId, actorUserId, action: 'UPDATE',
        entityType: 'Organization', entityId: organizationId,
        diff: { logo: { from: before.logoMime, to: null } },
        context: { field: 'logo', removed: true },
      });
    }
    return { logo: null };
  }
}
