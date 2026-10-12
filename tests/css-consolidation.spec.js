/* K8 : consolidation CSS — les composants clés ont UN seul bloc de base ;
   les reclarations restantes ne sont que des couches contextuelles
   (app shell, media queries, @supports, variants .none/.seen/...).
   Filet contre la re-accumulation de regles dupliquees (source de regressions). */
const { test, expect } = require('@playwright/test');
const fs = require('fs');

const css = () => fs.readFileSync('css/app.css', 'utf8');

test.describe('K8 : consolidation CSS', () => {

  test('un seul bloc de base par composant (tabbar, fab, crew-ring, story-view)', () => {
    const c = css();
    /* tabbar : base + neutralisation dans l'app shell (position:relative) */
    expect((c.match(/\.tabbar\{/g) || []).length,
      'tabbar : base + bloc app shell uniquement').toBe(2);
    /* fab : un seul bloc de base */
    expect((c.match(/\.fab\{/g) || []).length, 'fab : un seul bloc').toBe(1);
    /* crew-ring : base + variants d'etat descendants (.skeleton/.live/.seen) */
    expect((c.match(/\.crew-ring\{/g) || []).length,
      'crew-ring : base + 3 variants d\'etat').toBe(4);
    /* story-view : base + media 9:16 + reduced-motion + fix dvh + repli @supports */
    expect((c.match(/\.story-view\{/g) || []).length,
      'story-view : base + media + reduced-motion + dvh + @supports').toBe(5);
  });

  test('les proprietes du chrome translucide sont fondues dans la base (pas de couche separee)', () => {
    const c = css();
    /* le bloc de base .tabbar porte directement blur+saturate et l'ombre haute */
    const base = (c.match(/\/\* -+ TABBAR -+ \*\/\s*\.tabbar\{[^}]*\}/) || [])[0];
    expect(base, 'bloc de base .tabbar apres la remarque TABBAR').toBeTruthy();
    expect(base).toContain('blur(24px) saturate(180%)');
    expect(base).toContain('inset');
    /* plus aucun bloc .tabbar orors shell qui re-declare backdrop-filter */
    const others = (c.match(/\.tabbar\{[^}]*\}/g) || []).filter(b => b.includes('backdrop-filter'));
    expect(others, 'une seule declaration de backdrop-filter .tabbar').toHaveLength(1);
  });

  test('le CSS reste equilibre, sans nouveau replacement character', () => {
    const c = css();
    expect((c.match(/\{/g) || []).length).toBe((c.match(/\}/g) || []).length);
    /* 4 U+FFFD historiques dans d'anciens commentaires : autorises, jamais plus */
    expect((c.match(/\uFFFD/g) || []).length).toBeLessThanOrEqual(4);
  });
});
