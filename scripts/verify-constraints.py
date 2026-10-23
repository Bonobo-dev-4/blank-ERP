#!/usr/bin/env python3
"""Offline check: every identifier referenced by the invariant-constraints
migration must exist in the schema the init migration creates.

Catches typos and drift without needing a live Postgres."""
import re, pathlib, sys

base = pathlib.Path(__file__).resolve().parent.parent / 'apps/api/prisma/migrations'
init = (base / '20261021000000_init/migration.sql').read_text()

tables = {}
for m in re.finditer(r'CREATE TABLE (?:"[^"]+"\.)?"(?P<t>[^"]+)" \((?P<body>.*?)\n\);', init, re.S):
    tables[m.group('t')] = set(re.findall(r'"([^"]+)"\s', m.group('body')))

cons = re.sub(r'--[^\n]*', '', (base / '20261021000100_invariant_constraints/migration.sql').read_text())

errors, checked = [], 0
# Constraint names live in the table's namespace, not the column list.
def check(table, text, where, skip=()):
    global checked
    if table not in tables:
        errors.append(f'unknown table "{table}" ({where})'); return
    for ident in sorted(set(re.findall(r'"([^"]+)"', text))):
        if ident in skip: continue
        checked += 1
        if ident not in tables[table]:
            errors.append(f'{table}: unknown column "{ident}" ({where})')

for m in re.finditer(r'ALTER TABLE "(?P<t>[^"]+)"(?P<body>.*?);', cons, re.S):
    body = m.group('body')
    names = set(re.findall(r'ADD CONSTRAINT "([^"]+)"', body))
    check(m.group('t'), body, 'ALTER TABLE', skip=names)

for m in re.finditer(r'CREATE UNIQUE INDEX "(?P<n>[^"]+)"\s+ON "(?P<t>[^"]+)" \((?P<cols>[^)]*)\)(?P<w>[^;]*);', cons, re.S):
    check(m.group('t'), m.group('cols') + m.group('w'), f'index {m.group("n")}')

print(f'tables in schema          : {len(tables)}')
print(f'identifier refs verified  : {checked}')
print(f'CHECK constraints         : {len(re.findall(r"CHECK ", cons))}')
if errors:
    print('\nPROBLEMS:'); [print('  -', e) for e in sorted(set(errors))]; sys.exit(1)
print('\nOK: all constraint identifiers resolve against the generated schema.')
