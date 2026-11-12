// src/replay/recorder.ts

/**
 * Step 13-15 implementation target.
 *
 * This file will contain:
 *  - ReplayRunner: loads decision + payment traces, re-executes simulation
 *  - ReplayComparisonResult: compares tick snapshots, event fingerprints, final metrics
 *
 * The InMemoryDecisionRecorder in agents/models/recorded.ts already supports:
 *  - record(decision)
 *  - serialize() / hydrate()
 *  - integrityHash()
 *
 * Steps 13-15 checklist:
 *  [ ] Load .wt-trace.json and hydrate recorder
 *  [ ] Construct RecordedAgentModel (uses stored decisions, no new model calls)
 *  [ ] Run SimulationEngine with mode='replay'
 *  [ ] Compare tickSnapshots: every tick hash must match original run
 *  [ ] Compare event fingerprints: type + tick + agentId sequence must match
 *  [ ] Compare final metrics: conversion rate, per-phenotype summaries
 *  [ ] Emit REPLAY_INTEGRITY_WARNING for any hash mismatch
 */

export {}
