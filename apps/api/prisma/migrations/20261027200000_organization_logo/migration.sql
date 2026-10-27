-- The organisation's brand mark, uploaded from Administration -> Settings.
--
-- Additive only: three nullable columns, no row rewritten. With no logo the
-- interface keeps showing the D·D monogram.

ALTER TABLE "organizations" ADD COLUMN "logoMime" TEXT;
ALTER TABLE "organizations" ADD COLUMN "logoData" BYTEA;
ALTER TABLE "organizations" ADD COLUMN "logoUpdatedAt" TIMESTAMP(3);
