const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');

test.describe('Mannequin et création guidée du programme', () => {
  test('sélectionner une zone exacte sur le mannequin ouvre le catalogue filtré', async ({ page }) => {
    await seed(page);
    await page.click('button[data-tab="today"]');

    const quadriceps = page.locator('#todayBodyMap .bm-hit[data-muscle="quadriceps"]').first();
    await expect(quadriceps).toBeVisible();
    await quadriceps.click();

    await expect.poll(() => page.evaluate(() => currentTab)).toBe('library');
    await expect(page.locator('#libMapSub')).toContainText('quadriceps');
    await expect(page.locator('#libScreenMap .bm-hit[data-muscle="quadriceps"]').first())
      .toHaveAttribute('aria-pressed', 'true');

    const chest = page.locator('#libScreenMap .bm-hit[data-muscle="chest"]').first();
    await chest.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#libMapSub')).toContainText('chest');
    await expect(page.locator('#libScreenMap .bm-hit[data-muscle="chest"]').first())
      .toHaveAttribute('aria-pressed', 'true');
  });

  test('créer un programme puis plusieurs journées et remplir chacune d’exercices', async ({ page }) => {
    await seed(page);
    await page.click('button[data-tab="programme"]');

    await page.locator('button[onclick="openProgrammeEditor()"]:visible').click();
    await page.locator('#progNameInput').fill('Programme progression');
    await page.locator('#progDescInput').fill('Force et technique');
    await page.locator('#programmeEditorModal button[onclick="saveProgrammeEditor()"]')
      .click();
    await expect(page.locator('#newDayModal')).toHaveClass(/show/);
    await expect(page.locator('#dayProgramSelector option:checked'))
      .toContainText('Programme progression');

    await page.locator('#dayNameInput').fill('Haut du corps');
    await page.locator('#newDayModal button[onclick="saveNewDay()"]').click();
    await expect(page.locator('#dayDetailModal')).toHaveClass(/show/);
    await expect(page.locator('#libSearch')).toBeFocused();

    await page.locator('#libSearch').fill('bench');
    const firstBench = page.locator('#libGrid .lib-item').first();
    await expect(firstBench).toBeVisible();
    const benchName = await firstBench.getAttribute('data-name');
    await firstBench.click();
    await expect.poll(() => page.evaluate(name =>
      DB.programme.some(day => day.name === 'Haut du corps' && day.exercises.some(ex => ex.name === name)), benchName
    )).toBe(true);

    await page.locator('#dayDetailModal').getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('#daysList .programme-add-day').click();
    await page.locator('#dayNameInput').fill('Bas du corps');
    await page.locator('#newDayModal button[onclick="saveNewDay()"]').click();
    await expect(page.locator('#dayDetailModal')).toHaveClass(/show/);
    await page.locator('#libSearch').fill('squat');
    const firstSquat = page.locator('#libGrid .lib-item').first();
    await expect(firstSquat).toBeVisible();
    const squatName = await firstSquat.getAttribute('data-name');
    await firstSquat.click();

    const result = await page.evaluate(({ benchName, squatName }) => {
      const program = DB.programmes.find(item => item.name === 'Programme progression');
      const days = DB.programme.filter(day => day.programId === program.id);
      return {
        description: program.description,
        days: days.map(day => ({ name: day.name, exercises: day.exercises.map(ex => ex.name) })),
        expectedExercises: [benchName, squatName]
      };
    }, { benchName, squatName });

    expect(result.description).toBe('Force et technique');
    expect(result.days).toHaveLength(2);
    expect(result.days[0]).toMatchObject({ name: 'Haut du corps', exercises: [benchName] });
    expect(result.days[1]).toMatchObject({ name: 'Bas du corps', exercises: [squatName] });
  });
});
