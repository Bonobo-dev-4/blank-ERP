-- Shadow database used by `prisma migrate dev` to diff migrations safely.
-- Without it, Prisma tries to create and drop one on the fly, which needs
-- CREATEDB and fails on managed Postgres instances.
CREATE DATABASE dnd_erp_shadow OWNER dnd;
