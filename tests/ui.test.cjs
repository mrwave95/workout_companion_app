const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

let browser, server, baseURL;
const root = path.resolve(__dirname, '..');
before(async () => {
  server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['index.html', 'sw.js', 'manifest.json', 'icon-192.png', 'icon-512.png'].includes(name)) {
      res.writeHead(404).end(); return;
    }
    res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html' : name.endsWith('.js') ? 'application/javascript' : name.endsWith('.json') ? 'application/json' : 'image/png');
    res.end(fs.readFileSync(path.join(root, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

const workout = {
  id: 'workout-1', name: 'Lower body', exercises: [
    { id: 'squat', name: 'Squat', weight: 20, reps: 8, notes: '' },
    { id: 'curl', name: 'Curl', weight: 5, reps: 10, notes: '' }
  ]
};
async function withPage(run, { active = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseURL);
    const state = { version: 1, workouts: [workout], sessions: [], measurements: [], activeSession: null };
    if (active) state.activeSession = {
      id: 'session-1', workoutId: workout.id, workoutName: workout.name, date: '2026-10-24T12:00:00.000Z',
      exercises: workout.exercises.map(ex => ({ ...ex, exerciseId: ex.id, startWeight: ex.weight, startReps: ex.reps,
        finished: false, sets: [{ weight: ex.weight, reps: ex.reps, time: '2026-10-24T12:00:00.000Z' }] }))
    };
    await page.evaluate(state => localStorage.setItem('racked_state_v1', JSON.stringify(state)), state);
    await page.reload();
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}
async function start(page) {
  await page.locator('#t-workouts').click();
  const button = page.getByRole('button', { name: 'Start or resume Lower body' });
  await button.focus();
  await page.keyboard.press('Enter');
  await page.locator('#sessCounter').waitFor();
}

test('keyboard users can start workouts and offscreen exercises stay out of the tab order', async () => {
  await withPage(async page => {
    await start(page);
    assert.equal(await page.locator('#sessCounter').textContent(), 'Exercise 1 of 2');
    assert.equal(await page.getByRole('spinbutton', { name: 'Weight (kg)', exact: true }).count(), 1);
    assert.equal(await page.getByRole('textbox', { name: 'Notes for Squat' }).count(), 1);
    assert.equal(await page.locator('#sessPrev').isDisabled(), true);
    assert.equal(await page.locator('#sessCarouselTrack > .card-slide').nth(1).evaluate(el => el.inert), true);
    await page.locator('#sessNext').click();
    assert.equal(await page.locator('#sessCarouselTrack > .card-slide').nth(0).evaluate(el => el.inert), true);
    assert.equal(await page.getByRole('textbox', { name: 'Notes for Curl' }).count(), 1);
    assert.equal(await page.locator('#sessNext').isDisabled(), true);
  });
});

test('session carousel relayout preserves the active exercise after viewport rotation', async () => {
  await withPage(async page => {
    await start(page);
    await page.locator('#sessNext').click();
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => {
      const viewport = document.getElementById('sessCarouselViewport');
      const track = document.getElementById('sessCarouselTrack');
      return track.children[0].style.width === `${viewport.clientWidth}px`
        && track.style.transform === `translateX(${-viewport.clientWidth}px)`;
    });
    assert.equal(await page.locator('#sessCounter').textContent(), 'Exercise 2 of 2');
  });
});

test('set editor traps keyboard focus, supports Escape, and restores focus after save', async () => {
  await withPage(async page => {
    await start(page);
    const chip = page.locator('.set-chip').first();
    await chip.click();
    assert.equal(await page.getByRole('dialog', { name: 'Edit Set' }).count(), 1);
    assert.equal(await page.locator('#app').evaluate(el => el.inert), true);
    assert.equal(await page.locator('#modal-set-weight').evaluate(el => el === document.activeElement), true);
    assert.equal(await page.getByRole('dialog').getByLabel('Weight (kg)', { exact: true }).count(), 1);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('#modal-set-cancel').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#modal-set-weight').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#app').evaluate(el => el.inert), false);
    assert.equal(await chip.evaluate(el => el === document.activeElement), true);
    await chip.click();
    await page.getByRole('dialog').getByLabel('Weight (kg)', { exact: true }).fill('25');
    await page.locator('#modal-set-save').click();
    await page.waitForFunction(() => document.activeElement?.classList.contains('set-chip'));
    assert.equal(await page.locator('.set-chip').first().textContent(), '25×8');
  }, { active: true });
});

test('workout and measurement fields have associated labels and zoom remains available', async () => {
  await withPage(async page => {
    assert(!await page.locator('meta[name=viewport]').getAttribute('content').then(text => text.includes('user-scalable=no')));
    await page.locator('#t-create').click();
    for (const label of ['Workout name', 'Exercise name', 'Start weight (kg)', 'Start reps']) {
      assert.equal(await page.getByLabel(label, { exact: true }).count(), 1, label);
    }
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.locator('#t-measure').click();
    assert.equal(await page.getByLabel('Date', { exact: true }).count(), 1);
    assert.equal(await page.getByLabel('Waist (cm)', { exact: true }).count(), 1);
    await page.getByLabel('Custom measurement name', { exact: true }).fill('Left forearm');
    await page.locator('#ms-addcustom').click();
    assert.equal(await page.getByLabel('Left forearm (cm)', { exact: true }).count(), 1);
    assert.equal(await page.locator('#toast').getAttribute('role'), 'status');
  });
});
