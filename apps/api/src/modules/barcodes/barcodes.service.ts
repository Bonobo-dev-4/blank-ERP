import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit';
import { assertScannable, normaliseScannedCode, type BarcodeKind } from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { pageArgs, paginated, searchFilter } from '../../common/pagination';

export interface LabelSpec {
  readonly code: string;
  readonly kind: BarcodeKind;
  readonly title: string;
  readonly lines: readonly string[];
}

/**
 * Barcode generation, label printing and scan resolution.
 *
 * The printed symbol encodes ONLY the identifier. Every piece of context on the
 * label - SKU, shade, quantity - is read from the database at print time, so a
 * label can never assert something that has since changed; and a scan resolves
 * through this service, so the server is always the authority on what a code
 * refers to.
 */
@Injectable()
export class BarcodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    organizationId: string,
    query: {
      page: number; pageSize: number; sortDir: 'asc' | 'desc'; sortBy?: string;
      search?: string; kind?: BarcodeKind;
    },
  ) {
    const where: Prisma.BarcodeIdentifierWhereInput = {
      organizationId,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(searchFilter(query.search, ['code']) ?? {}),
    };
    const args = pageArgs(query, ['code', 'createdAt', 'lastPrintedAt', 'printCount'], 'createdAt');
    const [rows, total] = await Promise.all([
      this.prisma.barcodeIdentifier.findMany({
        where,
        skip: args.skip,
        take: args.take,
        orderBy: query.sortBy ? args.orderBy : { createdAt: 'desc' },
        include: {
          materialLot: { select: { lotCode: true, shade: true, rawMaterial: { select: { materialCode: true, name: true, baseUom: true } } } },
          fabricRoll: { select: { rollNo: true, currentLength: true, shade: true, status: true } },
          receipt: { select: { grnNo: true, receiptDate: true } },
        },
      }),
      this.prisma.barcodeIdentifier.count({ where }),
    ]);
    return paginated(rows, total, query);
  }

  /**
   * Resolve a scanned code to the thing it identifies.
   *
   * Used by every scan screen, so an unknown or revoked barcode is refused in
   * exactly one place with exactly one message.
   */
  async resolve(organizationId: string, scannedCode: string, expectedKinds?: readonly BarcodeKind[]) {
    const code = normaliseScannedCode(scannedCode);
    const identifier = await this.prisma.barcodeIdentifier.findUnique({
      where: { organizationId_code: { organizationId, code } },
      include: {
        materialLot: {
          include: {
            rawMaterial: { select: { id: true, materialCode: true, name: true, baseUom: true, category: true } },
            balances: { include: { location: { select: { code: true, name: true, kind: true } } } },
          },
        },
        fabricRoll: {
          include: {
            rawMaterial: { select: { id: true, materialCode: true, name: true } },
            location: { select: { code: true, name: true } },
          },
        },
        receipt: { include: { supplier: { select: { name: true } }, lines: true } },
      },
    });

    assertScannable(
      identifier
        ? { code: identifier.code, kind: identifier.kind as BarcodeKind, isActive: identifier.isActive, revokedAt: identifier.revokedAt }
        : null,
      code,
      expectedKinds,
    );

    return identifier!;
  }

  /** Render one barcode as a PNG. Code 128 for scanners, QR where asked for. */
  async renderImage(
    organizationId: string,
    code: string,
    options: { symbology?: 'code128' | 'qrcode'; scale?: number; height?: number } = {},
  ): Promise<Buffer> {
    const identifier = await this.prisma.barcodeIdentifier.findUnique({
      where: { organizationId_code: { organizationId, code: normaliseScannedCode(code) } },
      select: { code: true },
    });
    if (!identifier) {
      throw new NotFoundException({ code: 'BARCODE_UNKNOWN', message: 'This barcode is not known to the system' });
    }

    return bwipjs.toBuffer({
      bcid: options.symbology ?? 'code128',
      text: identifier.code,
      scale: options.scale ?? 3,
      height: options.symbology === 'qrcode' ? undefined : (options.height ?? 12),
      includetext: true,
      textxalign: 'center',
      textsize: 8,
    });
  }

  /**
   * Print a sheet of labels as a PDF.
   *
   * Laid out for 70 x 37 mm thermal label stock, three across, which is what a
   * typical garment unit uses. Each label carries the Code 128 symbol plus the
   * human-readable context an operator needs when the scanner fails.
   */
  async renderLabelSheet(
    organizationId: string,
    actorUserId: string,
    codes: readonly string[],
    options: { symbology?: 'code128' | 'qrcode'; copies?: number } = {},
  ): Promise<Buffer> {
    const identifiers = await this.prisma.barcodeIdentifier.findMany({
      where: { organizationId, code: { in: codes.map(normaliseScannedCode) } },
      include: {
        materialLot: { include: { rawMaterial: { select: { materialCode: true, name: true, baseUom: true } } } },
        fabricRoll: { select: { rollNo: true, currentLength: true, shade: true, width: true, lengthUom: true } },
        receipt: { select: { grnNo: true, receiptDate: true, supplier: { select: { name: true } } } },
      },
    });

    if (identifiers.length === 0) {
      throw new NotFoundException({
        code: 'BARCODE_UNKNOWN',
        message: 'None of the supplied barcodes exist',
        details: { requested: codes.length },
      });
    }

    const specs: LabelSpec[] = identifiers.flatMap((i) => {
      const spec = this.toLabelSpec(i);
      return Array.from({ length: Math.max(1, options.copies ?? 1) }, () => spec);
    });

    const pdf = await this.buildPdf(specs, options.symbology ?? 'code128');

    await this.prisma.barcodeIdentifier.updateMany({
      where: { id: { in: identifiers.map((i) => i.id) } },
      data: { printCount: { increment: options.copies ?? 1 }, lastPrintedAt: new Date() },
    });

    await this.audit.record({
      organizationId,
      actorUserId,
      action: 'POST',
      entityType: 'BarcodeIdentifier',
      context: { printedCodes: identifiers.map((i) => i.code), copies: options.copies ?? 1 },
    });

    return pdf;
  }

  /**
   * Revoke a barcode and issue a replacement.
   *
   * The old code keeps resolving for history but can no longer be scanned, so
   * a damaged label on a fabric roll does not strand the roll, and a found
   * old label cannot be used to post work twice.
   */
  async reissue(organizationId: string, actorUserId: string, code: string, reason: string) {
    return this.prisma.inTransaction(async (tx) => {
      const existing = await tx.barcodeIdentifier.findUnique({
        where: { organizationId_code: { organizationId, code: normaliseScannedCode(code) } },
      });
      if (!existing) {
        throw new NotFoundException({ code: 'BARCODE_UNKNOWN', message: 'This barcode is not known to the system' });
      }

      await tx.barcodeIdentifier.update({
        where: { id: existing.id },
        data: { isActive: false, revokedAt: new Date(), revokeReason: reason },
      });

      // The replacement carries a reprint suffix so the two are distinguishable
      // on a bench covered in labels.
      const reprintNo = existing.printCount + 1;
      const newCode = `${existing.code}-R${reprintNo}`;

      const replacement = await tx.barcodeIdentifier.create({
        data: {
          organizationId,
          code: newCode,
          kind: existing.kind,
          productionBatchId: existing.productionBatchId,
          productionUnitId: existing.productionUnitId,
          materialLotId: existing.materialLotId,
          fabricRollId: existing.fabricRollId,
          receiptId: existing.receiptId,
          finishedInwardId: existing.finishedInwardId,
          labelData: existing.labelData ?? undefined,
        },
      });

      await this.audit.record(
        {
          organizationId, actorUserId, action: 'UPDATE',
          entityType: 'BarcodeIdentifier', entityId: replacement.id,
          context: { revokedCode: existing.code, newCode, reason },
        },
        tx,
      );
      return replacement;
    });
  }

  private toLabelSpec(i: {
    code: string; kind: string;
    materialLot: { lotCode: string; shade: string | null; width: Prisma.Decimal | null; rawMaterial: { materialCode: string; name: string; baseUom: string } } | null;
    fabricRoll: { rollNo: string; currentLength: Prisma.Decimal; shade: string | null; width: Prisma.Decimal | null; lengthUom: string } | null;
    receipt: { grnNo: string; receiptDate: Date; supplier: { name: string } } | null;
  }): LabelSpec {
    if (i.fabricRoll) {
      return {
        code: i.code,
        kind: 'FABRIC_ROLL',
        title: `ROLL ${i.fabricRoll.rollNo}`,
        lines: [
          `${i.fabricRoll.currentLength.toFixed(2)} ${i.fabricRoll.lengthUom}`,
          i.fabricRoll.shade ? `Shade ${i.fabricRoll.shade}` : '',
          i.fabricRoll.width ? `Width ${i.fabricRoll.width.toFixed(1)}"` : '',
        ].filter(Boolean),
      };
    }
    if (i.materialLot) {
      return {
        code: i.code,
        kind: 'MATERIAL_LOT',
        title: i.materialLot.rawMaterial.materialCode,
        lines: [
          i.materialLot.rawMaterial.name.slice(0, 34),
          `Lot ${i.materialLot.lotCode}`,
          i.materialLot.shade ? `Shade ${i.materialLot.shade}` : '',
        ].filter(Boolean),
      };
    }
    if (i.receipt) {
      return {
        code: i.code,
        kind: 'GOODS_RECEIPT',
        title: `GRN ${i.receipt.grnNo}`,
        lines: [
          i.receipt.supplier.name.slice(0, 34),
          i.receipt.receiptDate.toISOString().slice(0, 10),
        ],
      };
    }
    return { code: i.code, kind: i.kind as BarcodeKind, title: i.code, lines: [] };
  }

  private buildPdf(specs: readonly LabelSpec[], symbology: 'code128' | 'qrcode'): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const MM = 2.834_645_7; // 1 mm in PDF points
      const LABEL_W = 70 * MM;
      const LABEL_H = 37 * MM;
      const COLS = 3;
      const MARGIN = 6 * MM;

      const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const perPage = COLS * Math.floor((842 - 2 * MARGIN) / LABEL_H);

      void (async () => {
        try {
          for (let idx = 0; idx < specs.length; idx += 1) {
            const spec = specs[idx]!;
            const slot = idx % perPage;
            if (slot === 0) doc.addPage();

            const col = slot % COLS;
            const row = Math.floor(slot / COLS);
            const x = MARGIN + col * LABEL_W;
            const y = MARGIN + row * LABEL_H;

            doc.rect(x + 2, y + 2, LABEL_W - 4, LABEL_H - 4).lineWidth(0.4).strokeColor('#cccccc').stroke();

            doc.fontSize(8).fillColor('#000000').font('Helvetica-Bold')
              .text(spec.title, x + 8, y + 7, { width: LABEL_W - 16, ellipsis: true });

            doc.fontSize(6).font('Helvetica').fillColor('#333333');
            spec.lines.slice(0, 3).forEach((line, li) => {
              doc.text(line, x + 8, y + 19 + li * 7.5, { width: LABEL_W - 16, ellipsis: true });
            });

            const png = await bwipjs.toBuffer({
              bcid: symbology,
              text: spec.code,
              scale: 2,
              height: symbology === 'qrcode' ? undefined : 9,
              includetext: false,
            });

            const imgH = 13 * MM;
            const imgW = symbology === 'qrcode' ? imgH : LABEL_W - 20;
            doc.image(png, x + 10, y + LABEL_H - imgH - 16, { width: imgW, height: imgH });

            doc.fontSize(6).font('Courier').fillColor('#000000')
              .text(spec.code, x + 8, y + LABEL_H - 13, { width: LABEL_W - 16, align: 'center' });
          }
          doc.end();
        } catch (e) {
          reject(e as Error);
        }
      })();
    });
  }
}
