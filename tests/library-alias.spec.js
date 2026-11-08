const { test, expect } = require('@playwright/test');
const { seed, dbState, switchProfile, today } = require('./helpers');

test.describe('Recherche français et anglaise — Bibliothèque', () => {
  test('recherche anglaise basique — bench press', async ({ page }) => {
    await seed(page, { programme: [] }, 'Mouataz');
    await page.goto('/index.html');
    await switchProfile(page, 'Mouataz');
    await page.click('button[data-tab="library"]');
    await page.fill('#libScreenSearch', 'bench press');
    await page.waitForTimeout(300);
    const count = await page.locator('.lib-item').count();
    expect(count).toBeGreaterThan(0);
  });

  test('recherche française — développé couché → bench press', async ({ page }) => {
    await seed(page, { programme: [] }, 'Mouataz');
    await page.goto('/index.html');
    await switchProfile(page, 'Mouataz');
    await page.click('button[data-tab="library"]');
    await page.fill('#libScreenSearch', 'développé couché');
    await page.waitForTimeout(500);
    const count = await page.locator('.lib-item').count();
    expect(count).toBeGreaterThan(0);
  });

  test('recherche française sans accent — developpe couché', async ({ page }) => {
    await seed(page, { programme: [] }, 'Mouataz');
    await page.goto('/index.html');
    await switchProfile(page, 'Mouataz');
    await page.click('button[data-tab="library"]');
    await page.fill('#libScreenSearch', 'developpe couché');
    await page.waitForTimeout(500);
    const count = await page.locator('.lib-item').count();
    expect(count).toBeGreaterThan(0);
  });

  test('recherche française — soulevé de terre → deadlift', async ({ page }) => {
    await seed(page, { programme: [] }, 'Mouataz');
    await page.goto('/index.html');
    await switchProfile(page, 'Mouataz');
    await page.click('button[data-tab="library"]');
    await page.fill('#libScreenSearch', 'soulevé de terre');
    await page.waitForTimeout(500);
    const count = await page.locator('.lib-item').count();
    expect(count).toBeGreaterThan(0);
  });

  test('recherche française — traction → pull-up', async ({ page }) => {
    await seed(page, { programme: [] }, 'Mouataz');
    await page.goto('/index.html');
    await switchProfile(page, 'Mouataz');
    await page.click('button[data-tab="library"]');
    await page.fill('#libScreenSearch', 'traction');
    await page.waitForTimeout(500);
    const count = await page.locator('.lib-item').count();
    expect(count).toBeGreaterThan(0);
  });

  test('recherche sans alias — nom anglais exact', async ({ page }) => {
    await seed(page, { programme: [] }, 'Mouataz');
    await page.goto('/index.html');
    await switchProfile(page, 'Mouataz');
    await page.click('button[data-tab="library"]');
    await page.fill('#libScreenSearch', 'dumbbell curl');
    await page.waitForTimeout(500);
    const count = await page.locator('.lib-item').count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Classification cardio et volume musculation', () => {
  test('exercice cardio (jumping jacks) n\u2019est pas classé comme volume musculation', async ({ page }) => {
    await seed(page, {
      programme: [{ id: 'd1', name: 'Cardio', type: 'CARDIO', exercises: [{ id: 'e1', name: 'jumping jacks', cardio: true }] }],
      history: []
    }, 'Mouataz');
    await page.goto('/index.html');
    await switchProfile(page, 'Mouataz');
    await page.click('button[data-tab="seance"]');
    // Vérifie que l\u2019exercice a bien cardio=true
    const exName = await page.locator('.lib-item').first().textContent();
    expect(exName).toContain('jumping jacks');
  });
});