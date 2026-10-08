/* App shell : #mainApp occupe l'écran (position:fixed), le header et la
   tabbar sont des enfants de flex, seul .app défile. La barre du bas ne
   dépend donc plus du viewport du document — même avec du contenu trop
   large ou une page plus haute que l'écran, elle reste collée en bas. */
const { test, expect } = require('@playwright/test');
const { seed, daysAgo } = require('./helpers');
const { withSocial, signedIn, openFeed, mockApi, post } = require('./social-mock');

const TABS = ['programme', 'seance', 'calendrier', 'stats', 'feed'];

test.describe('App shell : tabbar collée en bas sur les 5 onglets', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await withSocial(page);

    const history = [];
    for (let i = 0; i < 14; i++){
      history.push({ id: 'h' + i, date: daysAgo(i * 2 + 1), dayId: 'd1', dayName: 'PUSH',
        exercises: [{ id: 'e1', name: 'Développé couché', sets: [{ weight: 60, reps: 8 }] }],
        totalSets: 1, volume: 480, note: '' });
    }
    const programme = [];
    for (let d = 0; d < 14; d++){
      programme.push({ id: 'p' + d, name: 'Jour ' + (d + 1) + ' — poussée, tirage et jambes',
        type: d % 2 ? 'LEGS' : 'PUSH',
        exercises: [{ id: 'e' + d, name: 'Exercice ' + (d + 1) }] });
    }
    await seed(page, { programme, history }, 'Mouataz');
    await signedIn(page);
    mockApi(page, { posts: Array.from({ length: 24 }, (_, i) => post(i)) });
  });

  for (const tab of TABS){
    test(`onglet ${tab} : bas de la barre = bas de l'écran, document pas plus large`, async ({ page }) => {
      if (tab === 'feed') await openFeed(page);
      else await page.evaluate(t => window.showTab(t), tab);
      await page.waitForTimeout(150);

      /* scroll jusqu'en bas du conteneur qui défile */
      await page.evaluate(() => {
        const sc = document.querySelector('.app');
        sc.scrollTop = sc.scrollHeight;
      });
      await page.waitForTimeout(150);

      const r = await page.evaluate(() => {
        const b = document.querySelector('.tabbar').getBoundingClientRect();
        const sc = document.querySelector('.app');
        const header = document.querySelector('#mainApp .header').getBoundingClientRect();
        const over = [...document.querySelectorAll('#mainApp *')].filter(e => {
          const rect = e.getBoundingClientRect();
          return rect.width > 0 && (rect.right > window.innerWidth + 1 || rect.left < -1);
        }).map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')).slice(0, 6);
        return {
          gap: window.innerHeight - b.bottom,
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
          docScrollY: window.scrollY,
          scrolledToBottom: sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 1,
          headerTop: header.top,
          headerBottom: header.bottom,
          tabbarTop: b.top,
          overflowers: over
        };
      });

      expect(Math.abs(r.gap), 'tabbar collée au bas (gap = innerHeight - bottom)').toBeLessThanOrEqual(1);
      expect(r.scrollW,
        'le document n\'est pas plus large que le viewport (débordants : ' +
        r.overflowers.join(', ') + ')').toBeLessThanOrEqual(r.clientW);
      expect(r.docScrollY, 'le document ne défile plus').toBe(0);
      expect(r.scrolledToBottom, '.app a bien défilé jusqu\'en bas').toBe(true);
      expect(r.headerTop, 'header en haut').toBeLessThanOrEqual(1);
      expect(r.tabbarTop, 'la barre est sous le header, jamais au-dessus').toBeGreaterThan(r.headerBottom);
    });
  }

  test('onglet feed : le bouton + et la tabbar se chevauchent jamais', async ({ page }) => {
    await openFeed(page);
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => {
      const fab = document.getElementById('newPostFab');
      const bar = document.querySelector('.tabbar');
      const f = fab.getBoundingClientRect(), b = bar.getBoundingClientRect();
      return { hidden: fab.classList.contains('hidden'), fabBottom: f.bottom, barTop: b.top };
    });
    if (!r.hidden) expect(r.fabBottom).toBeLessThanOrEqual(r.barTop + 1);
  });

  test('modale et toast : toujours au-dessus de la tabbar', async ({ page }) => {
    await page.evaluate(() => { if (typeof openNewDay === 'function') openNewDay(); });
    await page.waitForSelector('.overlay.show');
    await page.waitForTimeout(400); /* fin de l'animation d'entrée */
    const m = await page.evaluate(() => {
      const ov = document.querySelector('.overlay.show');
      const bar = document.querySelector('.tabbar');
      const r = ov.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        id: ov.id, position: getComputedStyle(ov).position,
        covers: r.top <= 1 && Math.abs(r.height - window.innerHeight) <= 2,
        ovZ: parseInt(getComputedStyle(ov).zIndex, 10) || 0,
        barZ: parseInt(getComputedStyle(bar).zIndex, 10) || 0,
        hitInOverlay: !!hit && ov.contains(hit)
      };
    });
    expect(m.covers, 'la modale couvre tout l\'écran, la barre comprise — ' + JSON.stringify(m)).toBe(true);
    expect(m.ovZ).toBeGreaterThan(m.barZ);
    expect(m.hitInOverlay, 'le centre de l\'écran pointe la modale, pas la tabbar').toBe(true);

    await page.evaluate(() => {
      document.querySelector('.overlay.show').classList.remove('show');
      toast('Toast de test au-dessus de la barre');
    });
    await page.waitForTimeout(400);
    const t = await page.evaluate(() => {
      const el = document.getElementById('toast');
      const r = el.getBoundingClientRect();
      const bar = document.querySelector('.tabbar').getBoundingClientRect();
      return { shown: el.classList.contains('show'), bottom: r.bottom, barTop: bar.top,
               z: parseInt(getComputedStyle(el).zIndex, 10) || 0 };
    });
    expect(t.shown, 'le toast est affiché').toBe(true);
    expect(t.bottom, 'le toast reste au-dessus de la barre').toBeLessThanOrEqual(t.barTop + 1);
    expect(t.z).toBeGreaterThan(0);
  });
});
