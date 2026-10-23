const Sequencer = require('@jest/test-sequencer').default;

/**
 * Run the end-to-end phase suites in phase order.
 *
 * Jest's default sequencer orders files by size and previous timing, which for
 * these suites is arbitrary. They are not independent: each phase drives the
 * real API against one seeded database, and a later phase legitimately changes
 * state an earlier one set up (phase 2 reserves and re-stocks the materials
 * phase 1 received). Run out of order, phase 1 fails for reasons that have
 * nothing to do with phase 1.
 *
 * The suites are deliberately NOT isolated from each other. Isolating them
 * would mean each phase seeding its own materials, locations and suppliers,
 * which would stop them testing the thing that actually breaks in an ERP:
 * modules composing over shared master data.
 *
 * Each suite still assumes a FRESHLY SEEDED database. See testing-strategy.md.
 */
class PhaseSequencer extends Sequencer {
  sort(tests) {
    return [...tests].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
}

module.exports = PhaseSequencer;
