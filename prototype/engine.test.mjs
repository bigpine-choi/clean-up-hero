import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACTS, EQUIPMENT, RATES, createCompany, estimate, startJob, advance, reassign, settle } from './engine.mjs';

const balanced = { washers: 2, haulers: 2 };
const close = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} vs ${expected}`);
const finish = (company) => { advance(company, 100_000); assert.equal(company.active.done, true); settle(company); return company.lastReport; };

test('every disclosed plan has the same actual duration and profit as its estimate', () => {
  for (const contract of CONTRACTS) {
    for (const equipment of EQUIPMENT) {
      if (contract.recovery && equipment.id !== 'none') continue;
      for (let washers = 1; washers <= 3; washers++) {
        const team = { washers, haulers: 4 - washers };
        const expected = estimate(contract.id, team, equipment.id);
        const company = createCompany();
        company.cash = 1_000;
        startJob(company, contract.id, team, equipment.id);
        const report = finish(company);
        close(report.duration, expected.duration, `${contract.id}/${equipment.id}/${washers} duration`);
        // Independent throughput bound: either cleaning or hauling determines
        // total duration. The bounded pipeline cannot exceed either capacity.
        const analyticDuration = Math.max(
          contract.totalClean / (team.washers * RATES.clean * equipment.cleanMultiplier),
          contract.totalCarry / (team.haulers * RATES.haul * equipment.haulMultiplier),
        );
        close(report.duration, analyticDuration, 'independent throughput calculation');
        close(report.profit, expected.profit, 'profit');
        close(report.wages, report.duration * 4 * RATES.wage, 'active-time wages');
        close(report.revenue - report.totalCost, report.profit, 'profit bridge');
        close(company.cash, report.startCash + report.profit, 'cash bridge');
        assert.equal(company.completed, 1);
      }
    }
  }
});

test('cleaning and hauling conserve waste with bounded stockpiles at arbitrary frame rates', () => {
  const company = createCompany();
  startJob(company, 'vault', balanced);
  const contract = CONTRACTS.find((item) => item.id === 'vault');
  for (let frame = 0; frame < 2000 && !company.active.done; frame++) {
    advance(company, [0.07, 0.13, 0.61, 1.4][frame % 4]);
    const active = company.active;
    close(active.queue, active.cleaned * contract.totalCarry / contract.totalClean - active.carried);
    assert.ok(active.queue >= -1e-7 && active.queue <= contract.queueCapacity + 1e-7);
    assert.ok(active.cleaned <= contract.totalClean && active.carried <= contract.totalCarry);
  }
  assert.equal(company.active.done, true);
  const report = finish(company);
  close(report.duration, estimate('vault', balanced).duration);
  close(report.blockedSeconds, estimate('vault', balanced).blockedSeconds);
});

test('1x and 4x playback charge identical wages and produce identical economics', () => {
  const normal = createCompany();
  const fast = createCompany();
  startJob(normal, 'vault', balanced);
  startJob(fast, 'vault', balanced);
  // The UI renders at the same frequency; 4x advances four times as much
  // simulated time per frame. Compare equal simulated time, not wall time.
  for (let frame = 0; frame < 320; frame++) advance(normal, 0.25);
  for (let frame = 0; frame < 80; frame++) advance(fast, 1);
  for (const field of ['elapsed', 'cleaned', 'carried', 'queue', 'wages', 'blockedSeconds']) {
    close(normal.active[field], fast.active[field], `equal game time: ${field}`);
  }
  close(normal.cash, fast.cash, 'equal game time: cash');
  while (!normal.active.done) advance(normal, 0.25);
  while (!fast.active.done) advance(fast, 1);
  settle(normal);
  settle(fast);
  for (const field of ['duration', 'wages', 'totalCost', 'profit', 'blockedSeconds', 'endCash']) {
    close(normal.lastReport[field], fast.lastReport[field], `settlement: ${field}`);
  }
  close(normal.cash, fast.cash, 'settled cash');
});

test('different sites reward different staffing; rental is a site cost, not ownership', () => {
  const washHeavy = { washers: 3, haulers: 1 };
  const haulHeavy = { washers: 1, haulers: 3 };
  assert.ok(estimate('bath', washHeavy).profit > estimate('bath', haulHeavy).profit);
  assert.ok(estimate('vault', haulHeavy).profit > estimate('vault', washHeavy).profit);
  assert.ok(estimate('bath', washHeavy, 'washer').profit > estimate('bath', washHeavy).profit);
  assert.ok(estimate('vault', haulHeavy, 'cart').profit > estimate('vault', haulHeavy).profit);
  assert.ok(estimate('camp', balanced).profit > estimate('camp', balanced, 'cart').profit);
  const company = createCompany();
  startJob(company, 'bath', washHeavy, 'washer');
  finish(company);
  const cash = company.cash;
  startJob(company, 'camp', balanced);
  close(company.cash, cash - 8, 'only next contract supplies charged');
  assert.equal(company.active.equipmentId, 'none');
});

test('reassignment relieves a visible hauling bottleneck and changes results', () => {
  const unchanged = createCompany();
  const adjusted = createCompany();
  startJob(unchanged, 'vault', balanced);
  startJob(adjusted, 'vault', balanced);
  advance(unchanged, 20);
  advance(adjusted, 20);
  assert.equal(adjusted.active.blocked, true);
  close(adjusted.active.queue, 24);
  reassign(adjusted, { washers: 1, haulers: 3 });
  const better = finish(adjusted);
  const baseline = finish(unchanged);
  assert.ok(better.duration < baseline.duration);
  assert.ok(better.profit > baseline.profit);
  assert.equal(better.reassignments, 1);
  close(better.estimatedProfit, baseline.profit, 'initial estimate preserved');
});

test('no payroll accrues after completion, while reviewing results, or between contracts', () => {
  const company = createCompany();
  startJob(company, 'camp', balanced);
  advance(company, 10_000);
  const cash = company.cash;
  const wages = company.active.wages;
  const elapsed = company.active.elapsed;
  advance(company, 10_000);
  close(company.cash, cash);
  close(company.active.wages, wages);
  close(company.active.elapsed, elapsed);
  settle(company);
  const settledCash = company.cash;
  advance(company, 10_000);
  close(company.cash, settledCash);
});

test('whole projected cost is funded before ordinary acceptance without partial mutations', () => {
  const company = createCompany();
  company.cash = 10;
  const before = structuredClone(company);
  assert.throws(() => startJob(company, 'camp', balanced), { code: 'INSUFFICIENT_FUNDS' });
  assert.deepEqual(company, before);
  company.cash = estimate('camp', balanced).totalCost;
  startJob(company, 'camp', balanced);
  advance(company, 100_000);
  close(company.cash, 0, 'exact funding covers completion');
  settle(company);
  close(company.cash, 88, 'fee and salvage paid at settlement');
});

test('loss from poor reassignment can be recovered without a cash or equipment deadlock', () => {
  const company = createCompany();
  const goodBathTeam = { washers: 3, haulers: 1 };
  company.cash = estimate('bath', goodBathTeam).totalCost;
  startJob(company, 'bath', goodBathTeam);
  reassign(company, { washers: 1, haulers: 3 });
  const loss = finish(company);
  assert.ok(loss.profit < 0);
  assert.ok(company.cash < estimate('camp', balanced).totalCost);
  for (let attempt = 0; attempt < 10 && company.cash < estimate('camp', balanced).totalCost; attempt++) {
    const priorCash = company.cash;
    startJob(company, 'recovery', balanced);
    advance(company, 5);
    close(company.cash, priorCash, 'recovery payroll deferred to settlement');
    const report = finish(company);
    assert.ok(report.profit > 0);
    close(company.cash, priorCash + report.profit);
  }
  startJob(company, 'camp', balanced);
  assert.equal(company.active.contractId, 'camp');
  for (let washers = 1; washers <= 3; washers++) {
    assert.ok(estimate('recovery', { washers, haulers: 4 - washers }).profit > 0);
  }
  const indebted = createCompany();
  indebted.cash = -20;
  startJob(indebted, 'recovery', balanced);
  finish(indebted);
  assert.ok(indebted.cash > -20, 'negative balance still permits recovery');
});

test('contracts do not settle early and invalid choices do not change company state', () => {
  const company = createCompany();
  assert.throws(() => startJob(company, 'camp', { washers: 0, haulers: 4 }), { code: 'INVALID_TEAM' });
  assert.throws(() => startJob(company, 'recovery', balanced, 'cart'), { code: 'RECOVERY_BASIC_TOOLS' });
  assert.equal(company.active, null);
  startJob(company, 'vault', balanced);
  advance(company, 30);
  assert.equal(company.active.done, false);
  assert.throws(() => settle(company), { code: 'JOB_INCOMPLETE' });
  assert.throws(() => startJob(company, 'camp', balanced), { code: 'JOB_ACTIVE' });
  const before = structuredClone(company);
  assert.throws(() => advance(company, -1), { code: 'INVALID_TIME' });
  assert.throws(() => reassign(company, { washers: 2, haulers: 3 }), { code: 'INVALID_TEAM' });
  assert.deepEqual(company, before);
});

test('cleaning completion alone does not finish a hauling-heavy contract', () => {
  const company = createCompany();
  startJob(company, 'vault', balanced);
  advance(company, 185);
  close(company.active.cleaned, 45);
  assert.ok(company.active.carried < 260);
  assert.equal(company.active.done, false);
  assert.throws(() => settle(company), { code: 'JOB_INCOMPLETE' });
  advance(company, 15);
  assert.equal(company.active.done, true);
  close(company.active.carried, 260);
});
