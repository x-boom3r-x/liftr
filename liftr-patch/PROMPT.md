# PROMPT OPENCODE — Liftr : layout, stories, crop, musique, gestes, nouvelle architecture, nutrition, social

> Tu travailles sur **Liftr**, une PWA (HTML + `css/app.css` + `js/app.js` modules + Supabase). Tu as accès à tout le dépôt, **y compris le JS que l'auteur de ce prompt n'a pas pu lire**. Ce document contient une analyse faite sur `index.html` + `app.css` uniquement, du code déjà **testé** (dossier `liftr-patch/`) et des hypothèses à **confirmer dans le JS avant de coder**.
>
> **Règle n°1 : audit d'abord (Phase 0), code ensuite.** Ne réécris rien au hasard : chaque chantier dit quoi vérifier, quoi changer et comment prouver que c'est réglé.

---

## 0. Contenu du dossier `liftr-patch/` (déjà fourni, déjà testé)

| Fichier | Rôle | Testé |
|---|---|---|
| `css/patch-layout.css` | À **ajouter à la fin de `css/app.css`** : tabbar, anneaux de story, visionneuse de story, éditeur plein écran, musique, sous-navigation, actions de post, cartes de partage, nutrition | rendu Chromium 390×844 et 375×667, safe-area simulées |
| `js/audio-controller.js` | Lecteur audio **unique** (corrige « je ne peux plus arrêter la musique ») | 9 tests Playwright |
| `js/gestures.js` | `onSwipe`, `dragToDismiss`, pile retour (`pushLayer`/`popLayer`/`goBack`), `installStoryGestures`, `installEdgeBack` | 12 tests Playwright |
| `js/cropper.js` | Crop + zoom (pan, pinch, molette, double-tap, ratios, cadre rond, rotation, miroir, export) | 19 tests Playwright |
| `js/nutrition.js` | BMR/TDEE, objectif kcal, macros, repas multi-ingrédients, progression, import-check Atwater | 8 tests Node |
| `js/insights.js` | 1RM, plateaux, double progression, volume/muscle, charge aiguë/chronique, régularité, conseils | 10 tests Node |
| `tests/modules.test.mjs` | `node --test tests/modules.test.mjs` → **18/18** | oui |
| `prototype/prototype.html` | Maquette statique de la nouvelle structure (3 onglets, post, nutrition) : **cible visuelle** | oui |
| `data/nutrition.xlsx` | **Fichier Excel d'aliments/nutriments ajouté par l'auteur** (voir §J1) — à analyser, pas encore lu | — |

**Copie `css/` et `js/` dans le projet** (`js/` → `js/lib/` par exemple), garde les tests. Ne modifie ces modules que si un test te le justifie, et relance les tests.

## 0.1 Règles du projet à respecter (déjà en place, ne pas casser)

- `index.html` porte `data-build="44"` et le JS déclare `window.__LIFTR_BUILD__` : un garde-fou recharge la page si les deux diffèrent. **À chaque lot de changements : incrémenter les deux au même endroit + la version de cache du service worker** (sinon l'iPhone garde l'ancien CSS/JS et rien ne semble corrigé). Garder le test « builds synchronisés » vert.
- `css/app.css` est en **CRLF** : ne pas le reformater ni le ré-encoder.
- `#mainApp` est déjà un **app shell** (`position:fixed; display:flex; column`) : `.header` et `.tabbar` sont des éléments de flex, **seul `.app` défile**. Donc : `window.scrollTo`, `scrollY`, listeners `scroll` sur `window` ne fonctionnent plus → utiliser `document.querySelector('.app')`.
- Accessibilité : garder `aria-*`, cibles ≥ 44 px (≥ 38 px tolérées dans une rangée), `prefers-reduced-motion` respecté.
- Sécurité : tout contenu venant d'autres utilisateurs (posts, cartes partagées, notes, noms de pistes) est **non fiable** → `textContent`, jamais `innerHTML` avec des données brutes ; valider les JSON reçus (voir §9).


## 0.2 Ce que `js/app.js` révèle de l'architecture (lu par l'auteur du prompt)

`js/app.js` n'est que le point d'entrée : `window.__LIFTR_BUILD__ = '44'` puis des **imports à effet de bord** (`state.js`, `data.js`, `idb.js`, `store.js`, `ui.js`, `programme.js`, `suggest.js`, `seance.js`, `calendrier.js`, `stats.js`, `comments.js`, `motivation.js`, `install.js`, `share.js`, `export.js`, `social/index.js`). Conséquences pour toi :

- **Le code audio, stories, éditeur d'image et musique n'est PAS dans `app.js`** : il est dans `social/*` (et `ui.js` pour les modales/toasts). C'est là que la Phase 0 doit chercher en priorité (`grep -rn` sur tout `js/`, sous-dossiers compris).
- **Le projet fonctionne avec des fonctions globales** (`boot`, `setUser`, `currentUser`, `toast`, `showTab`, `closeModal`… utilisées sans import). Mes modules (`audio-controller.js`, `gestures.js`, `cropper.js`, `nutrition.js`, `insights.js`) sont des **modules ES avec `export`** : adapte l'intégration au style du projet — soit `import { player } from './lib/audio-controller.js'` dans les fichiers concernés, soit un fichier d'entrée qui expose `window.LiftrAudio = player` si le reste du code appelle des globales. Ne pas mélanger les deux styles dans un même fichier.
- **Stockage** : `idb.js` + `store.js` → les données Gym sont (très probablement) en **IndexedDB**. Réponse attendue à la Phase 0 Q4 : lis `idb.js`/`store.js`/`data.js` et **stocke la nutrition de la même façon** (nouveaux object stores, migration de version de la base incluse, jamais de perte des données existantes). `localStorage` n'est utilisé que pour de petits réglages (ex. `at_lastUser`).
- **Un nouveau module = une ligne d'import dans `app.js`** (ex. `import './nutrition-ui.js'; import './insights-ui.js';`) ; ne rien déclarer d'autre dans `app.js`.
- **Le build** : `window.__LIFTR_BUILD__ = '44'` est la 3ᵉ pièce du triplet (`data-build` dans `index.html`, `liftr-vXX` dans `sw.js`). Un test (`handlers.spec.js`) impose leur cohérence : le lancer après chaque bump.
- **Nouveaux fichiers à mettre en cache** par `sw.js` : `data/foods.json`, `js/lib/*.js`, les nouveaux modules — sinon l'app hors ligne casse.
- Le garde-fou d'erreurs de `app.js` (`_warnOnce`) avale les erreurs avec un toast générique : pendant le développement, **regarde la console** ; ne te fie pas à l'absence de toast.

---

## PHASE 0 — Audit obligatoire (avant toute modification)

Lance ces recherches, **note les résultats**, puis seulement applique les chantiers. Si une hypothèse ci-dessous est fausse, adapte le correctif et dis-le.

```bash
# scroll de fenêtre (cassé depuis l'app shell)
grep -rnE "scrollTo\(|scrollY|pageYOffset|scrollingElement|scrollIntoView|addEventListener\(['\"]scroll" js/
# audio : combien d'endroits créent un lecteur ?
grep -rnE "new Audio\(|createElement\(['\"]audio|\.play\(\)|\.pause\(\)|\.src *=" js/
# stories : anneau, viewer, durée
grep -rnE "crew-ring|crew-cell|has-story|\bring\b|\blive\b|\bseen\b|storyView|openStoryViewer|closeStoryViewer|expires_at|stories" js/
# éditeur d'image : où est-il utilisé ? (post, story, avatar ?)
grep -rnE "editorModal|openEditor|useEditedImage|editorCanvas|editorZoom|profAvatarBtn|avatar.*(upload|file|input)" js/
# musique
grep -rnE "musicModal|openMusicPicker|closeMusicPicker|music-row|music-play|mchip|itunes|preview_url|previewUrl|pickPostMusic|pickStoryMusic|pickNoteMusic" js/
# stockage & schéma
grep -rnE "localStorage|indexedDB|\.from\(['\"]|\.rpc\(" js/ | head -80
ls supabase/ migrations/ sql/ 2>/dev/null
```

Réponds par écrit à ces questions avant de coder :
1. D'où vient la musique (iTunes Search / Deezer / Spotify / autre) et quelle durée a l'extrait ? Combien d'objets `Audio` peuvent exister en même temps aujourd'hui ?
2. Comment `live/seen/none/me/find` (anneaux) sont-ils choisis, et à partir de quelle donnée ? Une story expirée ou « Forever » est-elle gérée ?
3. L'éditeur d'image est-il appelé depuis : post ? story ? **avatar** ? note ? (l'avatar semble sauter l'éditeur.)
4. Où sont stockés les données Gym (localStorage / IndexedDB / Supabase) ? Quel est le format d'une séance ? (pour écrire l'adaptateur de `insights.js`.)
5. Quelles tables Supabase existent pour likes/commentaires/follows/stories, et comment est écrit leur RLS ? (pour dupliquer le style au §8.)

---

## CHANTIER A — La tabbar doit coller en bas (toutes pages)

**Diagnostic.** Après l'app shell, la barre est bien au bord de l'écran, mais il reste trop d'espace *sous* les libellés : `padding-bottom = 8px + (safe-area − 12px)` = **30 px** sur iPhone (safe-area 34 px). La zone réellement occupée par l'indicateur d'accueil iOS ne fait qu'environ 13 px. Mesuré : barre = 91 px de haut avant, **71 px après le patch** (libellés à 10 px du bord).

**Correctif** (déjà dans `patch-layout.css`, section 0-1) :

```css
:root{
  --tabbar-pad-b:max(8px,calc(var(--safe-bottom) - 24px));   /* iPhone : 10px ; sans encoche : 8px */
  --tabbar-h:calc(61px + var(--tabbar-pad-b));               /* défaut ; affiné en JS ci-dessous */
}
.tabbar{padding:8px 10px var(--tabbar-pad-b)}
.fab{bottom:calc(var(--tabbar-h) + 14px)}
.toast{bottom:calc(var(--tabbar-h) + 20px)}
```

Et **supprime la ligne opencode précédente** `padding:8px 10px calc(8px + max(0px, calc(var(--safe-bottom) - 12px)))` de la règle `.tabbar` d'origine (elle est surchargée mais crée de la confusion).

Mesure réelle de la hauteur (au lieu de nombres magiques) — à ajouter au démarrage :

```js
const bar = document.querySelector('.tabbar');
const setH = () => document.documentElement.style.setProperty('--tabbar-h', bar.offsetHeight + 'px');
new ResizeObserver(setH).observe(bar); setH();
```

**Réglage fin sur appareil** : si les libellés frôlent la barre d'accueil → `--tabbar-pad-b` +2 px ; s'il reste du vide → −2 px. Une seule variable à toucher.
**Critère d'acceptation** : sur iPhone, en Safari **et** en PWA installée, la barre est au même endroit sur *tous* les onglets ; le fab et les toasts flottent juste au-dessus.

---

## CHANTIER B — Stories : layout, anneau, visionneuse

### B1. Analyse de la visionneuse (mesurée, pas supposée)

Rendu de `#storyView` avec ton CSS, safe-top 47 px / safe-bottom 34 px :

| Défaut | Mesure | Cause |
|---|---|---|
| Barres de progression **sous l'encoche / Dynamic Island** | y = 10–13 px (l'encoche occupe 0–47) | `.sv-top{padding:10px 12px}` ignore `--safe-top` |
| Chip musique **chevauche l'en-tête** (« 2h ») | chip y = 58, en-tête y = 23–59 | `.sv-music{top:58px}` en dur |
| Légende **entre en collision avec les boutons** Delete / Add to your story | légende à y≈723–772, boutons à y≈761 | `.sv-caption{padding-bottom:72px}` < hauteur réelle du pied (99 px + safe-area) |
| Photo paysage **rognée de force** | 1200×800 zoomée plein cadre | `.sv-img{object-fit:cover}` |
| Avatar de l'en-tête carré | — | pas de `border-radius:50%` |
| Hauteur fragile | `height:100dvh` + `bottom:auto` | `100vh` (fallback) est trop haut dans Safari < 15.4 → pied rogné ; `inset:0` est toujours juste |
| Une notification Liftr passe **par-dessus** la story | z-index 55 > 50 | — |
| Aperçu de création trompeur | `.story-preview img{max-height:260px; object-fit:cover}` | ne ressemble pas à ce que verra le spectateur |

Après patch (mesuré) : barre de progression y = 57–60 (sous l'encoche), en-tête 70–106, chip musique 127–173, pied 745–844, légende 597–844 **sans chevauchement**, photo entière visible sur fond flou.

### B2. Bon layout (référence Instagram, adapté web)

- Cadre **9:16**. Mobile : plein écran. Écran large : cadre 9:16 centré, le reste assombri (déjà dans le patch).
- Photo déjà 9:16 (cadrée par l'éditeur, voir C) → `cover` plein cadre (`.is-916`). Autre ratio → `contain` sur **fond flou** de la même photo.
- Ordre vertical : progression → en-tête (avatar rond, nom, heure, ✕) → chip musique → contenu → légende → pied (Delete / Add to your story).
- **Création de story** : l'éditeur impose `aspect = 9/16`, export `{width:1080,height:1920}`. L'aperçu dans `#storyModal` doit avoir `aspect-ratio:9/16; max-height:42vh; object-fit:cover`.

**JS à faire dans le rendu de la story** (là où `#svStage` est rempli) :

```js
stage.classList.toggle('plain', !story.image_url);
stage.classList.toggle('is-916', Math.abs(img.naturalWidth / img.naturalHeight - 9/16) < 0.02);
stage.style.setProperty('--sv-src', `url("${story.image_url}")`);   // fond flou (CSS ::before)
```

### B3. L'anneau de story apparaît même sans story — cause et correctif

**Cause (CSS, certaine)** : `.crew-ring{background:var(--gx)}` — le **dégradé est le style par défaut** ; seuls `.me/.find/.none` le remplacent par du gris. Tout élément qui n'a pas exactement une de ces classes affiche l'anneau. Pareil pour `.avatar.ring` et `.prof-av` (bordure dégradée **toujours** présente). En plus, `--line` (anneau « vu ») **n'est définie nulle part** → anneau transparent.

**Correctif CSS** (dans le patch, section 2) : défaut = **aucun anneau** ; dégradé seulement avec `.live` (crew) ou `.has-story` (avatars/profil) ; `.seen` = gris ; `--line` définie.

**Correctif JS (obligatoire, sinon aucun anneau ne s'affichera jamais)** :
1. Une seule source de vérité : `activeStoryUsers` = `Set` des `user_id` ayant ≥ 1 story **non expirée** (`expires_at IS NULL OR expires_at > now()`; « Forever » = `NULL`), chargée avec le feed et rafraîchie à l'ouverture de l'app et toutes les 60 s.
2. `seenStories` (clé `userId → dernier storyId vu`, en localStorage).
3. Partout où un avatar est rendu (crew row, posts, commentaires, profil, notes, DM) : `avatar.classList.toggle('has-story', activeStoryUsers.has(uid))` et `.seen` si tout est vu. Dans la crew row : `.live` / `.seen` sur `.crew-cell`.
4. Après publication ou suppression d'une story, mettre à jour le `Set` et re-rendre.
5. Cliquer un avatar **sans** story ouvre le profil, jamais la visionneuse.

**Critère** : compte sans story → **aucun** anneau nulle part ; après publication → anneau dégradé sur « Your story », sur mon avatar de profil et dans les posts ; après visionnage complet → anneau gris ; après expiration → plus d'anneau.

---

## CHANTIER C — Crop et zoom (post, story, photo de profil)

### C1. Constat
`#editorModal` : un `<canvas>` carré, une glissière **Zoom**, des puces de ratio `Free/1:1/4:5/9:16/16:9`. Problèmes mesurés/déduits : **aucun cadre de recadrage visible** ; pas de pinch ; le stage est `aspect-ratio:1/1; max-height:46vh` → sur petit écran il devient 341×299 avec un canvas `width/height:100%` → **aperçu étiré** ; feuille basse (`max-height:94vh`) avec outils qui poussent hors écran ; le ratio choisi ne change pas la forme du stage ; la photo de profil semble **ne pas passer par l'éditeur**.

### C2. À faire
1. **Plein écran** (déjà dans le patch §4) : `.editor` = 100 % de l'écran, safe-areas, stage `flex:1`, outils en rangées défilantes.
2. Remplacer la logique de pan/zoom/ratio/rotation de l'éditeur par `createCropper(#editorStage, {aspect})` (`js/cropper.js`). **Conserver les filtres existants** (Mono/Warm/Cool/Fade/Vivid, Light, Color) : le pipeline devient `cropper.drawTo(ctx, w, h)` → appliquer le filtre existant → `toBlob`. Note : `ctx.filter` n'existe pas sur tous les Safari → garder l'implémentation actuelle des filtres (boucle de pixels ou CSS), ne pas la remplacer par `ctx.filter`.
3. **Trois modes**, ouverts par `openEditor(file, mode)` :

| Mode | `aspect` | `round` | Export | Ratios proposés |
|---|---|---|---|---|
| `post` | 4/5 (défaut) | non | `maxSide:1440`, JPEG 0.9 | Original, 1:1, 4:5, 16:9 |
| `story` | 9/16 | non | `{width:1080,height:1920}` | 9:16 seulement |
| `avatar` | 1 | **oui** | `{width:512,height:512}` | 1:1 rond seulement |

4. Brancher la **photo de profil** (`#profAvatarBtn`, avatar du compte) sur `openEditor(file,'avatar')` ; même chose pour la photo de story (`pickStoryPhoto`) et de post (`pickPhoto`). Griser/masquer les puces de ratio non pertinentes pour le mode.
5. Glissière Zoom liée : `zoom.oninput = () => c.setZoom(+zoom.value)` et `c.onChange(s => zoom.value = s.zoom)`. Zoom max 5×.
6. Rotation = `c.rotate()`, Miroir = `c.mirror()`. Double-tap = zoom ×2 / retour.
7. Détruire l'instance (`c.destroy()`) à la fermeture ; libérer les `createObjectURL`.
8. Photos iPhone : `createImageBitmap(..., {imageOrientation:'from-image'})` est déjà géré (EXIF). Pour **HEIC** non décodable : message clair « format non supporté, choisis JPEG/PNG » (ou conversion si une lib est déjà dans le projet — ne pas en ajouter une lourde).
9. Après upload d'avatar : mettre à jour partout (header, posts, crew) sans rechargement ; invalider le cache du navigateur de l'ancienne URL (suffixe `?v=timestamp`).

**Critère** : cadre visible avec masque ; un pinch zoome sous les doigts ; impossible de voir du vide ; avatar exporté en 512×512 rond à l'affichage ; story exportée en 1080×1920 ; aperçu jamais déformé sur iPhone SE (375×667).

---

## CHANTIER D — Musique : choix de la piste + impossible de l'arrêter

### D1. Analyse

**Ce que montrent le HTML/CSS** : la modale `#musicModal` n'a qu'un bouton **Close**. Il n'existe **aucun état « piste sélectionnée »** (pas de `.sel`, pas de bouton « Utiliser cette piste »), et seule la classe `.music-play.on` existe pour la lecture. Donc : choisir une piste = taper une ligne qui **valide et ferme immédiatement**, sans pouvoir réécouter/comparer ; et l'état de lecture est porté par un bouton qui est **détruit à chaque re-rendu** (`innerHTML` de `#musicList`, `#feedList`).

**Cause la plus probable du « je ne peux plus l'arrêter » (à confirmer par l'audit)** : `new Audio(url).play()` à chaque clic → chaque clic crée un lecteur **sans référence** ; le bouton ne sait plus quel lecteur arrêter ; fermer la modale / la story / changer d'onglet ne coupe rien ; et une liste re-rendue réaffiche ▶ alors que ça joue encore → un 2ᵉ clic lance un **2ᵉ** morceau par-dessus. Sur iOS, `audio.play()` hors geste utilisateur est rejeté silencieusement, ce qui laisse l'UI dans un état faux.

### D2. Correctif

1. **Un seul lecteur** : `js/audio-controller.js` (`player`, `installAudioUI()`). **Supprimer tous les `new Audio` / `<audio>` ailleurs** (audit Phase 0). Tous les boutons deviennent :
   ```html
   <button class="music-play" data-audio-id="${track.id}" data-audio-url="${track.previewUrl}"
           data-audio-start="${p.start||0}" data-audio-end="${p.end||0}">▶</button>
   ```
   Plus aucun `onclick` : la délégation gère clic, icône ▶/❚❚, `aria-pressed`, barre de progression (`.music-prog > i`), même après un re-rendu.
2. **Arrêts automatiques** — appeler `player.stop()` dans : `closeModal` (toujours), `closeMusicPicker`, `closeStoryViewer`, changement de story (suivant/précédent), `showTab`/changement de racine, `setSView`, ouverture d'un autre modal. (`visibilitychange` et `pagehide` sont déjà gérés.)
3. **Choisir sa piste — flux explicite** (ajouter le HTML) :
   - Taper une ligne = la **sélectionner** (`.music-row.sel`, coche ✓), pas fermer.
   - ▶ sur la ligne = écouter (arrête automatiquement la précédente).
   - Pied de modale : `[ Annuler ]  [ Utiliser cette piste ]` (désactivé tant que rien n'est sélectionné). Le bouton **Close** actuel devient *Annuler*.
   - Si la source n'offre qu'un extrait de 30 s : bloc **« Extrait »** (`.music-clip`) avec curseur *début* (0 → durée−15 s) et durée 15 s ; stocker `{id,title,artist,art,previewUrl,start,end}` avec le post/story/note ; la lecture respecte `start/end` (déjà géré par le lecteur : arrêt automatique à `end`).
   - Pendant la recherche : état vide, état « aucun résultat », état erreur réseau (`#musicError`), annulation des requêtes précédentes (`AbortController`) pour qu'une vieille réponse n'écrase pas la nouvelle.
4. **Dans une story / un post** : la chip musique (`.mchip`) est un bouton ▶/❚❚ branché sur le même `data-audio-*`. Dans la visionneuse : lecture **automatique** à l'affichage de la story (si le geste d'ouverture le permet), stop à la fermeture, pause avec l'appui long.
5. Ne pas faire jouer d'audio en arrière-plan ; ne pas relancer à `visibilitychange: visible`.

**Critère** : cliquer ▶ deux fois sur la même piste = elle s'arrête ; cliquer ▶ sur une autre = l'ancienne s'arrête ; fermer n'importe quelle modale/story = silence ; re-rendre la liste pendant la lecture garde ❚❚ sur le bon bouton ; 6 clics rapides = état cohérent. (Ce sont exactement les cas de `audio_test`.)

---

## CHANTIER E — Gestes : swipe retour / fermeture

Une PWA iOS installée n'a **pas** de geste retour natif. `js/gestures.js` fournit tout :

| Où | Geste | Code |
|---|---|---|
| Visionneuse de story | swipe **bas** = fermer (suit le doigt, fond qui s'estompe) ; swipe **gauche/droite** = utilisateur suivant/précédent ; appui long = pause ; tap gauche/droite = story précédente/suivante (existant) | `installStoryGestures(#storyView, {close, nextUser, prevUser, pause, resume})` |
| Feuilles modales (`.modal`, action sheet, musique, note…) | glisser le `.grabber` vers le bas = fermer | `dragToDismiss(modalEl, {handle: modalEl.querySelector('.grabber'), close})` |
| Éditeur plein écran | swipe bas depuis l'en-tête = annuler | idem avec `.editor-top` |
| Sous-vues du social (thread, profil d'un autre, résultats) | **swipe depuis le bord gauche** = retour | `installEdgeBack(document.body)` |
| Partout | bouton retour Android / `history.back()` | pile `pushLayer/popLayer` |

Intégration de la **pile retour** : chaque ouverture de couche (modal, story, sous-vue, éditeur) appelle `pushLayer('id', closeFn)`, et chaque fermeture par l'UI (✕, clic hors zone…) appelle `popLayer('id')`. Ainsi le swipe-bord, le geste Android et `history.back()` ferment **toujours la couche du dessus** et jamais l'app. `closeModal`, `closeStoryViewer`, `closeEditor`, `closeThread`… passent par là.

Attention : `touch-action` — la visionneuse est en `none` ; les feuilles défilantes ne doivent détecter le glisser **que** sur le grabber/en-tête (sinon le scroll interne casse) ; le swipe-bord a `ignore` sur les champs et carrousels horizontaux (`.crew`, `.notes`, `.ex-chips`, `data-no-swipe`). Respecter `prefers-reduced-motion` (déjà géré).
**Critère** : en PWA iPhone, je peux sortir de toute story, feuille, sous-vue avec un geste, sans fermer l'app, sans casser le scroll vertical.

---

## CHANTIER F — Nouvelle architecture : 3 onglets racine

### F1. Cible

```
Tabbar (3)  :  [ Feed ]   [ Gym ]   [ Nutrition ]
Feed        :  barre du haut (titre + 🔍 + 💬 + profil) · filtre All/Following/Top · stories · composer · posts
Gym         :  sous-nav  Programme | Séance | Calendrier | Progression
Nutrition   :  sous-nav  Aujourd'hui | Repas | Aliments | Objectif
```

**Page d'accueil** : `Feed` **si** (connecté **et** `navigator.onLine`), sinon `Gym` (hors-ligne ou déconnecté : l'app reste 100 % utilisable). Écouter `online/offline` : hors-ligne → bandeau discret « Hors ligne — dernier contenu affiché », actions réseau désactivées, retour automatique possible vers Gym. Mémoriser le dernier onglet **manuel** (localStorage) mais le contourner au tout premier lancement de la session pour appliquer la règle ci-dessus.

### F2. Migration sans casser le JS existant (approche à risque minimal)

- **Garder** les `<section id="tab-programme|tab-seance|tab-calendrier|tab-stats|tab-feed">` et `showTab(id)` tels quels (le JS les connaît).
- Ajouter une couche de routage :
  ```js
  const ROOTS = { feed: 'feed', gym: ['programme','seance','calendrier','stats'], nutrition: ['nutri-today','nutri-meals','nutri-foods','nutri-goal'] };
  function showRoot(root, sub) {           // appelé par la tabbar (3 boutons)
    state.root = root; renderSubnav(root);
    showTab(root === 'feed' ? 'feed' : (sub || state.lastSub[root] || ROOTS[root][0]));
  }
  ```
- `renderSubnav(root)` injecte `<nav class="subnav">` (déjà stylé) en tête de chaque section concernée (ou une seule barre déplacée), `aria-current` sur l'actif, mémorise `lastSub[root]`.
- `#tabFeedBtn` (aujourd'hui masqué hors connexion) : le Feed reste le 1ᵉʳ bouton ; non connecté → état « Connecte-toi pour voir le Feed » avec le CTA existant, **pas** un bouton caché qui décale la barre.
- Remplacer la `.snav` à 4 entrées du Feed par la **barre du haut** `.feed-top` + `.top-icons` (🔍 → `setSView('search')`, 💬 → `setSView('inbox')` avec `#inboxDot`, 👤 → `setSView('profile')`). **Ne pas changer `setSView`** : seule la présentation change. Les sous-vues non-Home affichent un bouton ‹ (retour) qui fait `goBack()`.
- Le Feed hérite de `#newPostFab` : au-dessus de la tabbar via `--tabbar-h` (déjà fait).
- `Statistiques` devient **Progression** (voir §I). Le bloc « Export CSV » est déplacé en bas de Progression.

Prototype visuel de référence : `prototype/prototype.html` (ouvrir dans le navigateur ; les onglets sont cliquables).
**Critère** : lancement en ligne connecté → Feed ; en avion → Gym ; aucune fonctionnalité existante perdue ; la tabbar a 3 entrées, jamais de saut de largeur.

---

## CHANTIER G — Posts : like, upvote, repost, enregistrer, partager

### G1. Maquette (déjà stylée : `.post-actions`, `.pa*`)

Rangée : `[▲ score ▼]  ♥ n  💬 n  ⟲ n  ········  🔖  ↗` — mesurée sans débordement de 320 à 430 px.

> **À valider avec l'auteur** : *like* et *upvote* font doublon en pratique. Interprétation retenue : **♥ Like** = appréciation sociale (compteur public, notifie l'auteur) ; **▲ Upvote** = signal de classement pour l'onglet **Top** (un vote par personne, optionnellement ▼). Si l'auteur préfère un seul des deux, supprimer l'un des deux sans toucher au reste.

### G2. Comportements (TikTok-like)
- **Double-tap** sur le média/texte du post = like + animation `.like-burst` (cœur qui grossit puis disparaît), jamais un « unlike » au double-tap.
- **Repost** : feuille d'actions (action sheet existante) → *Reposter* / *Reposter avec un commentaire* / *Annuler le repost*. Le repost apparaît chez les **abonnés** du reposteur avec l'en-tête `.post-repost-by` (« Sam a reposté ») ; un utilisateur ne peut pas reposter son propre post ni deux fois le même.
- **Enregistrer** : privé. Nouvel onglet **« Saved »** dans le profil (à côté de *Posts* et *Liked*). Aucune notification.
- **Partager** : `navigator.share({title,text,url})` si dispo, sinon copier le lien ; option « Envoyer en message » vers la messagerie existante.
- **Optimistic UI** pour tous (compteur et état changent immédiatement, retour arrière + toast en cas d'échec réseau) ; anti double-tap (verrou par post/action) ; états `aria-pressed`.
- Compteurs depuis la base (vue ou RPC), pas calculés côté client.
- **Tri « Top »** : `score = upvotes − downvotes`, pondéré par l'âge (`score / (âge_h + 2)^1.5`), fenêtre 7 jours.

### G3. Base de données (Supabase) — **calquer le style des tables `likes`/`comments` existantes** (noms, RLS, index) trouvés en Phase 0

```sql
-- posts : type de contenu + pièce jointe structurée (voir §H)
alter table posts add column if not exists kind text not null default 'text'
  check (kind in ('text','photo','pr','session','program'));
alter table posts add column if not exists attachment jsonb;
alter table posts add constraint attachment_size check (attachment is null or pg_column_size(attachment) < 16384);

create table if not exists post_votes (
  post_id uuid references posts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz default now(),
  primary key (post_id, user_id));
create table if not exists post_reposts (
  post_id uuid references posts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  quote text check (char_length(quote) <= 400),
  created_at timestamptz default now(),
  primary key (post_id, user_id));
create table if not exists post_saves (
  post_id uuid references posts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz default now(),
  primary key (post_id, user_id));

alter table post_votes   enable row level security;
alter table post_reposts enable row level security;
alter table post_saves   enable row level security;

-- votes/reposts : lisibles si le post est visible (réutiliser la condition de visibilité des likes) ;
-- on n'écrit/supprime que ses propres lignes
create policy votes_read   on post_votes   for select using (true);   -- REMPLACER par la règle de visibilité des likes
create policy votes_write  on post_votes   for insert with check (user_id = auth.uid());
create policy votes_update on post_votes   for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy votes_delete on post_votes   for delete using (user_id = auth.uid());
create policy reposts_read  on post_reposts for select using (true);   -- idem
create policy reposts_write on post_reposts for insert with check (user_id = auth.uid());
create policy reposts_delete on post_reposts for delete using (user_id = auth.uid());
-- saves : STRICTEMENT privé
create policy saves_own on post_saves for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index on post_votes(post_id); create index on post_reposts(user_id, created_at desc); create index on post_saves(user_id, created_at desc);
```
Vérifier que les comptes **privés** (`Private account`) n'exposent pas leurs posts reposts/votes. Ne jamais faire confiance au client pour le `user_id` (valeur par défaut `auth.uid()`). Fournir la migration dans le dossier de migrations du projet, jamais appliquée à l'aveugle en production.

---

## CHANTIER H — Partager un exploit / une séance / un programme dans l'app

1. Points d'entrée : bouton **Partager** sur (a) un **PR** (liste des records), (b) la **fin de séance** (résumé), (c) une carte **programme**. Ouvre le composer du Feed pré-rempli (`kind` + `attachment`), l'utilisateur peut ajouter du texte/photo avant de publier.
2. Rendu dans le post : `.share-embed` (`.pr` doré, `.program` violet), voir `prototype/prototype.html`.
3. Schéma `attachment` (versionné, **validé côté client à l'envoi ET à la réception**) :

```json
{ "v":1, "type":"pr",      "exercise":"Back Squat", "kg":142.5, "reps":3, "e1rm":156, "prevE1rm":150, "date":"2026-10-08" }
{ "v":1, "type":"session", "title":"Push A", "date":"2026-10-08", "durationMin":62, "volume":9850,
  "exercises":[ { "name":"Bench", "topKg":85, "topReps":5, "sets":4 } ] }
{ "v":1, "type":"program", "name":"PPL", "days":[ { "name":"Push", "exercises":[ { "name":"Bench", "sets":4, "reps":"6-10" } ] } ] }
```
4. **Validation à la réception (obligatoire)** : whitelist des champs, `v === 1`, nombres bornés (`0 < kg ≤ 1000`, `0 < reps ≤ 100`), chaînes ≤ 80 car., tableaux ≤ 12 jours × 20 exercices, taille JSON < 16 Ko ; tout champ inconnu ignoré ; rendu **uniquement** via `textContent`. Un attachement invalide = post affiché sans carte, jamais d'exception.
5. **Importer un programme** : bouton « Importer ce programme » → convertir vers le **format d'import déjà existant** (réutiliser la fonction du `importModal`/partage actuel, ne pas en réécrire une) → écran de confirmation avec aperçu → ajout comme *nouveau* programme (jamais d'écrasement silencieux).
6. Confidentialité : un PR/séance partagé n'inclut ni notes privées, ni poids de corps, ni données de santé.

---

## CHANTIER I — Stats → « Progression » plus intelligente

### I1. Constat
La page actuelle liste des cartes (par exercice, répartition musculaire, cardio, poids) : **elle décrit le passé mais ne dit pas quoi faire**.

### I2. Nouveau layout (ordre de haut en bas)
1. **Insights** — liste de 3 à 5 cartes triées par sévérité (`buildInsights`) : record, plateau + **cible chiffrée** (« vise 100 kg × 6 »), volume faible/élevé d'un muscle, pic de charge, série de semaines, poids vs objectif. Chaque carte a une action (ex. « Ouvrir l'exercice », « Ajouter une série »).
2. **Cette semaine** — séances faites/prévues, volume total, delta vs moyenne 4 semaines, série en cours (`consistency`).
3. **Force** — sélecteur d'exercice (`.ex-chips`) → courbe **1RM estimé** (pas seulement la charge max), records, prochaine cible (`nextTarget`), détection de plateau.
4. **Volume par muscle** — séries dures / semaine avec **bande cible 10–20** (`classifySets`).
5. **Charge & récupération** — jauge `acwr` (0,8–1,3 = zone optimale), légende « indicatif ».
6. **Corps** — poids **lissé (EMA)** + pente kg/semaine (`weightTrend`), pas la courbe brute bruitée ; objectif depuis Nutrition.
7. **Export CSV** (existant) en bas.

### I3. Implémentation
- Écrire `adaptSessions(rawData) → [{date, exercises:[{name, muscle, sets:[{kg,reps}]}]}]` depuis le **vrai format Liftr** (Phase 0, question 4) : exclure cardio, séries assistées (`ass`) ou les convertir explicitement, ignorer les séries vides. **Tester l'adaptateur** avec 2-3 séances réelles.
- Les seuils de `THRESHOLDS` (insights.js) sont des **heuristiques de coaching** : les afficher comme conseils, jamais comme avis médical (l'ACWR en particulier est indicatif). Textes d'insight en français, tournés en conseil concret.
- Aucun calcul lourd sur le thread principal pendant le rendu : mémoïser par `(dernière séance, nombre de séances)`.
- Réutiliser le code de graphiques SVG existant (`.dchart`) ; pas de nouvelle dépendance.
**Critère** : avec un historique réel, l'écran affiche au moins un conseil exploitable et chaque chiffre est vérifiable à la main (cf. tests).

---

## CHANTIER J — Nutrition (calories, repas, ingrédients, barre de progression)

### J1. Le fichier Excel — **à analyser, je ne l'ai pas reçu**
Un fichier Excel généré précédemment (nutriments) est dans le dossier de travail. **Ne suppose rien sur sa structure.**
1. Trouve-le (`find . -name "*.xlsx" -not -path "*/node_modules/*"`), lis **toutes** les feuilles avec un script jetable (SheetJS `xlsx` ou `openpyxl`) : liste des feuilles, en-têtes, 10 lignes d'exemple, types, cellules fusionnées, lignes vides, unités.
2. Écris un **rapport** : colonnes → champs `food` de `nutrition.js` (`kcal, protein, carbs, fat, fiber, sugar, sodium_mg`, **pour 100 g/100 ml**), unités à convertir (kJ→kcal ÷4,184 ; mg/g ; « pour 1 portion » → ramener à 100 g avec `gramsPerUnit`), catégories, doublons, valeurs manquantes.
3. Script d'import `scripts/build-foods.mjs` → `data/foods.json` (`id` stable en slug, `name`, `category`, nutriments/100 g, `gramsPerUnit`, `density` si liquide). Exécuter `atwaterCheck` sur **chaque ligne** et sortir un rapport des anomalies (kcal ≠ 4P+4C+9F à ±15 %) : **ne corrige pas silencieusement**, liste-les pour que l'auteur tranche.
4. **Le .xlsx n'est pas embarqué dans l'app** ; `foods.json` est chargé à la demande (lazy), mis en cache par le service worker, recherche **insensible aux accents/casse** (`normalize('NFD')`), classée par préfixe puis sous-chaîne, résultats limités à ~30.

### J2. Profil et calcul (tout est dans `js/nutrition.js`, testé)
Champs : **poids actuel**, **taille**, âge, sexe, niveau d'activité, objectif (`lose|maintain|gain`), vitesse (kg/sem), % masse grasse (optionnel).
- **Poids actuel** = dernière valeur du suivi de poids **déjà existant** dans Liftr (carte poids des stats) — ne pas redemander ; si absent, le demander une fois puis l'alimenter dans ce même suivi (une seule source de vérité). La taille est la seule vraie nouvelle saisie.
- `buildPlan(profile)` → `{bmr, tdee, kcal, macros:{protein,carbs,fat}, notes}`.
- **Garde-fous intégrés** : plancher 1 500 kcal (H) / 1 200 kcal (F) et jamais sous le BMR ; vitesse de perte plafonnée à 1 % du poids/semaine, de prise à 0,5 %. Si `notes` contient `floor_applied` / `rate_capped`, l'afficher clairement. Texte légal discret : estimation indicative, pas un avis médical ; ne pas encourager des objectifs extrêmes.
- Recalcul automatique quand le poids change ; **ajustement adaptatif** (`adaptiveAdjustment`) proposé (jamais imposé) après ≥ 14 jours de données.

### J3. Écrans
- **Aujourd'hui** (`.kcal-card`, voir prototype) : gros total mangé / objectif, « X restantes », **barre de progression** `.pbar` (classes `ok` 90–105 %, `over` > 105 %, transition douce, bornée à 100 %), puis 3 macros avec leurs barres, puis les repas du jour avec leurs ingrédients (`.meal-card`), bouton « + Ajouter un repas ». Rapports `BMR / TDEE / Objectif` en pied.
- **Ajouter un repas** : nom + type (petit-déj, déjeuner, dîner, collation) ; recherche d'aliment (`.food-list`) → saisie de la quantité (g, ml, pièce, c. à soupe…) avec **totaux recalculés en direct** ; plusieurs ingrédients ; modifier/supprimer un ingrédient ; dupliquer un repas d'hier ; **enregistrer comme recette** (`recipeToFood`) réutilisable.
- **Aliments** : recherche, favoris, récents, **aliment personnalisé** (formulaire par 100 g avec validation Atwater : avertir, ne pas bloquer).
- **Objectif** : formulaire du profil + résultat du calcul expliqué (BMR → TDEE → objectif → macros) + projection de poids indicative (`projectWeight`).
- **Semaine** : `weekSummary` (moyenne, jours dans la cible ±10 %), lien avec la tendance de poids de Progression.
- Stockage : **même mécanisme que les données Gym** (Phase 0, Q4), par jour (`YYYY-MM-DD`), fonctionne **hors ligne** ; synchroniser avec Supabase seulement si les données Gym le sont déjà. Un repas = `{id, date, type, name, items:[{foodId, qty, unit}]}` (stocker `foodId` + quantité, **pas** les totaux ; recalculés à l'affichage, donc corrigibles si la base change).
- Accessibilité : barre = `role="progressbar"` avec `aria-valuenow/min/max` + texte « 1 480 sur 2 209 kcal » ; ne pas utiliser la couleur seule (le texte « restantes / dépassement de X » l'accompagne).
- **Pas de gamification punitive** (pas de rouge agressif, pas de « tu as échoué ») : le dépassement est factuel et neutre.

---

## CHANTIER K — Autres problèmes de layout trouvés pendant l'analyse

| # | Problème | Correctif |
|---|---|---|
| K1 | `--line` utilisée 3 fois, **jamais définie** (anneau « vu », `.acct`, note perso) | définie dans le patch |
| K2 | `.liftr-notif` (z 55) recouvre la story (z 50) | z-index 45 (patch) |
| K3 | Les `max-height:92vh/94vh` des feuilles utilisent `vh` (trop haut dans Safari) | passer à `dvh` avec repli (`max-height:92vh; max-height:92dvh`) pour `.modal`, `.editor`, `.food-list`… |
| K4 | `.input{font-size:.95rem}` (< 16 px) → iOS **zoome la page** au focus d'un champ, ce qui décale les éléments fixes | déjà forcé à 16 px sur écrans tactiles (patch, déjà présent dans l'app shell) |
| K5 | Après l'app shell, `window.scrollTo(0,0)` à chaque changement d'onglet ne remet plus rien à zéro | remplacer par `document.querySelector('.app').scrollTo({top:0})` |
| K6 | Positions des overlays/toasts calculées avec des nombres magiques (78/96 px) | `var(--tabbar-h)` (fait) |
| K7 | `.snav` sticky dépend de `top:calc(safe-top + 60px)` (ancien header sticky) | `top:0` dans l'app shell (fait) ; supprimer la règle morte |
| K8 | Beaucoup de règles dupliquées (`.crew-ring` ×4, `.story-view` ×5, `.tabbar` ×4, `.fab` ×5) : source de régressions | après les chantiers, **consolider** en un bloc par composant (sans changer le rendu) et ajouter un test visuel |

---

## ORDRE D'EXÉCUTION (un commit par étape, build incrémenté à chaque fois)

1. **Phase 0** (audit écrit) · 2. **A** tabbar · 3. **B** stories + anneaux · 4. **D** musique (bug bloquant) · 5. **C** crop/zoom · 6. **E** gestes + pile retour · 7. **F** 3 onglets + Feed d'accueil · 8. **G** actions de post (+ migration) · 9. **H** partage exploit/programme · 10. **I** Progression · 11. **J** Nutrition (import Excel, puis écrans) · 12. **K** nettoyage CSS.

## CRITÈRES D'ACCEPTATION GLOBAUX

- `node --test tests/modules.test.mjs` → **18/18** (+ tests de l'adaptateur de stats et de l'import Excel).
- Tests Playwright à ajouter à la suite du projet (viewport 390×844 + 375×667, `--safe-top:47px; --safe-bottom:34px` forcés) :
  - tabbar : `innerHeight − tabbar.bottom === 0` sur **les 3 onglets et leurs sous-vues**, `documentElement.scrollWidth <= clientWidth` ;
  - story : barre de progression en dessous de `safe-top`, aucune intersection légende/pied/chip, photo 3:2 entièrement visible ;
  - anneaux : 0 anneau sans story active, 1 avec ;
  - audio : les 9 scénarios de `audio_test` ;
  - crop : pinch, pan borné, exports 512×512 / 1080×1920 ;
  - gestes : swipe bas ferme une story, swipe-bord revient, ne ferme jamais l'app.
- Build synchronisé (`data-build` = `__LIFTR_BUILD__` = version de cache SW), service worker mis à jour.
- Aucune régression : séance, programme, calendrier, export CSV, import, messages, notes, profils privés.

## CE QUI N'A PAS PU ÊTRE VÉRIFIÉ (à faire par toi / l'auteur)

- **Aucun test sur vrai WebKit/iPhone** : tout est validé sous Chromium en émulation mobile avec safe-areas simulées. Vérifier sur appareil : tabbar (Safari + PWA), lecture audio (politique d'autoplay iOS), gestes de bord, clavier + champs, éditeur avec une photo iPhone portrait (EXIF) et HEIC.
- **Le JS applicatif n'a pas été lu** : les causes du bug musique et de l'anneau côté JS sont des hypothèses fortes mais à **confirmer en Phase 0**.
- **Le fichier Excel n'a pas été lu** : tout le §J1 est une procédure, pas un résultat.
- Le schéma Supabase réel est inconnu : la migration du §G3 est un **modèle** à aligner sur l'existant.
- « Choisir sa piste » a été interprété comme *sélection explicite + écoute avant validation + choix du passage de l'extrait* ; si l'auteur voulait autre chose, ajuster §D2.3.
