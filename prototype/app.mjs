import { CONTRACTS, EQUIPMENT, createCompany, estimate, startJob, advance, reassign, settle } from './engine.mjs';

const $ = id => document.getElementById(id);
const company = createCompany();
let contractId = CONTRACTS.find(c => !c.recovery).id;
let equipmentId = 'none';
let team = { washers: 2, haulers: 2 };
let speed = 1;
let lastWall = performance.now();
let view = 'planning';
const gold = value => `${Math.round(value).toLocaleString('ko-KR')} G`;
const signedGold = value => `${value >= 0 ? '+' : '−'}${gold(Math.abs(value))}`;
const seconds = value => `${Math.round(value)}초`;
const contract = id => CONTRACTS.find(c => c.id === id);

function error(message = '') {
  $('error').textContent = message;
  $('error').hidden = !message;
}

function showView(nextView) {
  view = nextView;
  for (const id of ['planning', 'working', 'report']) $(id).hidden = id !== nextView;
  for (const id of ['board', 'team', 'work', 'report']) $(`step-${id}`).classList.remove('current');
  const step = nextView === 'planning' ? 'team' : nextView === 'working' ? 'work' : 'report';
  $(`step-${step}`).classList.add('current');
  if (nextView === 'planning') $('step-board').classList.add('current');
  updateCompany();
}

function updateCompany() {
  $('company-cash').textContent = Math.round(company.cash).toLocaleString('ko-KR');
  $('company-cash').classList.toggle('negative', company.cash < 0);
  $('completed').textContent = company.completed;
}

function renderContracts() {
  $('contracts').replaceChildren();
  for (const c of CONTRACTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'contract';
    button.dataset.contract = c.id;
    button.setAttribute('aria-pressed', String(c.id === contractId));
    button.innerHTML = `<span class="contract-name"><span>${c.name}</span><span class="badge">${c.recovery ? '자금 복구' : c.risk.split(' · ')[0]}</span></span><p>${c.summary}</p><span class="contract-money"><span>청소 보수 <strong>${gold(c.fee)}</strong></span><span>회수품 매각 <strong>${gold(c.salvage)}</strong></span></span><p>${c.risk}</p>`;
    button.addEventListener('click', () => {
      contractId = c.id;
      if (c.recovery) equipmentId = 'none';
      error();
      renderPlanning();
    });
    $('contracts').append(button);
  }
}

function renderEquipment() {
  $('equipment').replaceChildren();
  for (const item of EQUIPMENT) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.equipment = item.id;
    button.setAttribute('aria-pressed', String(item.id === equipmentId));
    button.innerHTML = `${item.name}<small>${item.cost ? `${gold(item.cost)} / 현장` : '임대료 없음'}</small>`;
    button.title = item.description;
    button.disabled = contract(contractId).recovery && item.id !== 'none';
    button.addEventListener('click', () => { equipmentId = item.id; renderPlanning(); });
    $('equipment').append(button);
  }
}

function renderPlanning() {
  updateCompany();
  const c = contract(contractId);
  renderContracts();
  renderEquipment();
  $('equipment-description').textContent = EQUIPMENT.find(e => e.id === equipmentId).description;
  $('selected-name').textContent = c.name;
  $('workload').textContent = `세척 물량 ${c.totalClean} · 운반 물량 ${c.totalCarry} · 적치 한도 ${c.queueCapacity}`;
  $('wash-count').textContent = team.washers;
  $('haul-count').textContent = team.haulers;
  $('team').value = team.washers;
  const quote = estimate(contractId, team, equipmentId);
  $('estimated-profit').textContent = signedGold(quote.profit);
  $('estimated-profit').classList.toggle('negative', quote.profit < 0);
  $('estimated-time').textContent = seconds(quote.duration);
  $('estimate-detail').textContent = `매출 ${gold(quote.fee + quote.salvage)} − 인건비 ${gold(quote.wages)} − 소모품 ${gold(quote.supplies)} − 장비 임대 ${gold(quote.equipmentCost)}`;
  $('estimate-cause').textContent = quote.cause;
  const blocked = !c.recovery && company.cash < quote.totalCost;
  $('start').disabled = blocked;
  $('start').textContent = blocked ? '운영자금 부족' : '수주하고 출발';
  $('funding-note').textContent = c.recovery
    ? '기본 도구로 진행합니다. 선지급 비용 없이 완료 후 임금을 정산합니다.'
    : blocked
      ? `필요 운영자금 ${gold(quote.totalCost)}. 장비·배치를 바꾸거나 자금 복구 의뢰를 선택하세요.`
      : `필요 운영자금 ${gold(quote.totalCost)} · 수주 후 작업 시간에만 인건비가 발생합니다.`;
}

$('team').addEventListener('input', event => {
  team = { washers: Number(event.target.value), haulers: 4 - Number(event.target.value) };
  renderPlanning();
});

$('start').addEventListener('click', () => {
  try {
    startJob(company, contractId, team, equipmentId);
    error();
    speed = 1;
    $('speed').textContent = '속도 ×1';
    lastWall = performance.now();
    $('working-heading').textContent = contract(contractId).name;
    $('live-team').disabled = false;
    showView('working');
    updateWork();
  } catch (e) { error(e.message); }
});

$('live-team').addEventListener('input', event => {
  try {
    const washers = Number(event.target.value);
    reassign(company, { washers, haulers: 4 - washers });
    error();
    updateWork();
  } catch (e) { error(e.message); updateWork(); }
});

$('speed').addEventListener('click', () => {
  speed = speed === 1 ? 4 : 1;
  $('speed').textContent = `속도 ×${speed}`;
});

function updateWork() {
  const job = company.active;
  if (!job) return;
  const c = contract(job.contractId);
  const cleanPercent = Math.min(100, job.cleaned / c.totalClean * 100);
  const haulPercent = Math.min(100, job.carried / c.totalCarry * 100);
  $('clean-percent').textContent = `${Math.round(cleanPercent)}%`;
  $('haul-percent').textContent = `${Math.round(haulPercent)}%`;
  $('clean-progress').value = cleanPercent;
  $('haul-progress').value = haulPercent;
  $('elapsed').textContent = seconds(job.elapsed);
  $('live-wages').textContent = gold(job.wages);
  $('queue').textContent = `${Math.round(job.queue)} / ${c.queueCapacity}`;
  $('live-wash-count').textContent = job.team.washers;
  $('live-haul-count').textContent = job.team.haulers;
  $('live-team').value = job.team.washers;
  $('live-team').disabled = job.done;
  $('settle').hidden = !job.done;
  $('scene-label').textContent = job.done ? '청소 완료!' : job.cleaned >= c.totalClean ? '남은 폐품 운반 중' : job.blocked ? '적치 공간이 가득 찼어요' : '직원들이 작업 중';
  $('work-status').textContent = job.done
    ? '깨끗해진 현장입니다. 비용은 더 발생하지 않습니다. 이번 판단의 결과를 확인하세요.'
    : job.cleaned >= c.totalClean
      ? '세척은 끝났습니다. 남은 폐품을 운반하고 있습니다.'
      : job.blocked
        ? '적치 공간이 가득 차 세척 속도가 운반 속도에 맞춰 줄었습니다. 운반 인력 비중을 높여보세요.'
        : '세척과 운반이 이어지고 있습니다. 적치량과 작업 흐름을 살펴보세요.';
  updateCompany();
  drawScene(job, c);
}

$('settle').addEventListener('click', () => {
  try { settle(company); renderReport(); showView('report'); error(); }
  catch (e) { error(e.message); }
});

function renderReport() {
  const r = company.lastReport;
  $('report-name').textContent = contract(contractId).name;
  $('actual-profit').textContent = signedGold(r.profit);
  $('actual-profit').classList.toggle('negative', r.profit < 0);
  const lines = [['청소 보수', r.fee], ['회수품 매각', r.salvage], ['인건비', -r.wages], ['소모품비', -r.supplies], ['장비 임대료', -r.equipmentCost]];
  $('report-lines').replaceChildren();
  for (const [label, amount] of lines) {
    const row = document.createElement('div');
    row.innerHTML = `<span>${label}</span><strong>${signedGold(amount)}</strong>`;
    $('report-lines').append(row);
  }
  $('report-comparison').innerHTML = `<div><span>예상 → 실제 이익</span><b>${signedGold(r.estimatedProfit)} → ${signedGold(r.profit)}</b></div><div><span>예상 → 실제 작업 시간</span><b>${seconds(r.estimatedDuration)} → ${seconds(r.duration)}</b></div><div><span>세척 대기 시간 · 비율 환산</span><b>${seconds(r.blockedSeconds)}</b></div>`;
  $('report-cause').textContent = r.cause;
}

$('next').addEventListener('click', () => {
  if (company.cash < 0) { contractId = CONTRACTS.find(c => c.recovery).id; equipmentId = 'none'; }
  renderPlanning();
  showView('planning');
});

// Placeholder art keeps gameplay readable without treating concept PNGs as production sprites.
function drawScene(job, c) {
  const ctx = $('scene').getContext('2d');
  const t = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : job.elapsed;
  const ratio = job.cleaned / c.totalClean;
  ctx.clearRect(0, 0, 720, 560);
  ctx.fillStyle = '#60865c'; ctx.fillRect(0, 0, 720, 560);
  for (let i = 0; i < 12; i++) {
    const x = i * 69 - 14, y = i % 2 ? 34 : 54;
    ctx.fillStyle = '#355d42'; ctx.beginPath(); ctx.ellipse(x, y, 48, 60, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#467448'; ctx.beginPath(); ctx.ellipse(x + 10, y - 12, 39, 40, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#6d704d'; ctx.fillRect(62, 117, 593, 378);
  ctx.fillStyle = '#b39563'; ctx.fillRect(72, 127, 573, 358);
  for (let row = 0; row < 6; row++) for (let col = 0; col < 10; col++) {
    const i = row * 10 + col, x = 82 + col * 55, y = 138 + row * 55;
    ctx.fillStyle = (row + col) % 2 ? '#d9cb9e' : '#e5d9b2';
    ctx.fillRect(x, y, 52, 52);
    const remaining = Math.max(0, Math.min(1, i + 1 - ratio * 60));
    if (remaining > 0) {
      ctx.globalAlpha = remaining; ctx.fillStyle = c.totalClean > c.totalCarry * 2 ? '#816895' : '#756944';
      ctx.beginPath(); ctx.ellipse(x + 26, y + 23, 19 + i % 8, 10 + i % 6, i * .7, 0, Math.PI * 2); ctx.fill();
      if (i % 3 === 0) { ctx.fillStyle = '#957d54'; ctx.fillRect(x + 6, y + 15, 24, 12); }
      ctx.globalAlpha = 1;
    }
  }
  ctx.fillStyle = '#456a57'; ctx.beginPath(); ctx.ellipse(363, 306, 32, 25, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#bfb784'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(363, 285); ctx.lineTo(363, 327); ctx.moveTo(338, 306); ctx.lineTo(388, 306); ctx.stroke();
  ctx.fillStyle = '#87643e'; ctx.fillRect(575, 417, 100, 72);
  ctx.fillStyle = '#bb985b'; ctx.fillRect(569, 411, 112, 10);
  ctx.fillStyle = '#2d4a39'; ctx.beginPath(); ctx.arc(589, 488, 13, 0, Math.PI * 2); ctx.arc(656, 488, 13, 0, Math.PI * 2); ctx.fill();
  const pile = Math.ceil(job.queue / c.queueCapacity * 8);
  for (let i = 0; i < pile; i++) { ctx.fillStyle = i % 2 ? '#826550' : '#a58a63'; ctx.fillRect(558 + (i % 4) * 25, 408 - Math.floor(i / 4) * 24, 28, 25); }
  for (let i = 0; i < 4; i++) {
    const washing = i < job.team.washers;
    const x = job.done ? 225 + i * 66 : washing ? 155 + (i * 129 + t * 10) % 350 : 465 + Math.sin(t * .5 + i) * 65;
    const y = job.done ? 356 : washing ? 213 + i * 52 + Math.sin(t * .8 + i) * 18 : 352 + Math.cos(t * .5 + i) * 36;
    ctx.fillStyle = '#27403235'; ctx.beginPath(); ctx.ellipse(x, y + 25, 24, 10, 0, 0, Math.PI * 2); ctx.fill();
    if (washing) {
      ctx.fillStyle = '#48999a'; ctx.beginPath(); ctx.moveTo(x, y - 14); ctx.lineTo(x - 19, y + 22); ctx.lineTo(x + 21, y + 22); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#edd4a3'; ctx.beginPath(); ctx.arc(x, y - 14, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#745791'; ctx.beginPath(); ctx.moveTo(x - 19, y - 25); ctx.lineTo(x + 15, y - 25); ctx.lineTo(x + 5, y - 51); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#cdbf78'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x + 10, y + 8); ctx.lineTo(x + 39, y + 2 + Math.sin(t * 4) * 5); ctx.stroke();
      if (!job.done) { ctx.fillStyle = '#a2ecdd'; ctx.beginPath(); ctx.arc(x + 38, y + 6, 7 + Math.sin(t * 4) * 2, 0, Math.PI * 2); ctx.fill(); }
    } else {
      ctx.fillStyle = '#54b39b'; ctx.beginPath(); ctx.ellipse(x, y, 26, 25, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#81d2b9'; ctx.beginPath(); ctx.ellipse(x - 7, y - 8, 14, 10, -.4, 0, Math.PI * 2); ctx.fill();
      if (!job.done && job.queue > 0) { ctx.fillStyle = '#bd955f'; ctx.fillRect(x + 15, y - 9, 24, 23); }
    }
    ctx.fillStyle = '#263d39'; ctx.beginPath(); ctx.arc(x - 5, y - (washing ? 15 : 4), 2.5, 0, Math.PI * 2); ctx.arc(x + 5, y - (washing ? 15 : 4), 2.5, 0, Math.PI * 2); ctx.fill();
  }
}

setInterval(() => {
  const now = performance.now();
  const dt = Math.min((now - lastWall) / 1000, 1);
  lastWall = now;
  if (view === 'working' && company.active && !company.active.done && !document.hidden) {
    advance(company, dt * speed);
    updateWork();
  }
}, 250);

renderPlanning();
showView('planning');
