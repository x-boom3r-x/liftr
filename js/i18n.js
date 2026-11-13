/* Lightweight offline language layer. UI source strings stay stable so locale
   changes never rewrite a user's data or exercise names. */
const FR = new Map(Object.entries({
  'Today':'Aujourd’hui','Plan':'Programme','Workout':'Séance','Progress':'Progrès','Diary':'Journal','Foods':'Aliments','Goals':'Objectifs',
  'Gym':'Musculation','Nutrition':'Nutrition','Social':'Social','Home':'Accueil','People':'Personnes','Search':'Rechercher','Messages':'Messages','Notifications':'Notifications',
  'Today, ':'Aujourd’hui, ','Your training and nutrition, ready on this device.':'Votre entraînement et votre nutrition, disponibles sur cet appareil.',
  'Next workout':'Prochaine séance','View plan':'Voir le programme','Start session':'Démarrer la séance','Start workout':'Démarrer l’entraînement','Resume':'Reprendre','Session tab':'Séance',
  'Suggested today':'Suggestion du jour','Today’s plan':'Programme du jour','Today\'s plan':'Programme du jour','Done today':'Terminé aujourd’hui','View':'Voir','View session':'Voir la séance','View progress':'Voir les progrès',
  'Training plan':'Programme d’entraînement','Training progress':'Progression','Food diary':'Journal alimentaire','Food library':'Bibliothèque d’aliments','Nutrition goals':'Objectifs nutritionnels','Scan a barcode':'Scanner un code-barres','Scan barcode':'Scanner un code-barres','Scan':'Scanner',
  'Search foods or scan…':'Rechercher un aliment ou scanner…','Search foods…':'Rechercher des aliments…','Search foods to add':'Rechercher des aliments à ajouter','Search workouts, food, Social…':'Rechercher une séance, un aliment ou une personne…',
  'Add food':'Ajouter un aliment','Add a food':'Ajouter un aliment','Add meal':'Ajouter un repas','Build a meal':'Composer un repas','Build a recipe':'Créer une recette','Edit meal':'Modifier le repas','Recipe name':'Nom de la recette','Meal name':'Nom du repas','Food name':'Nom de l’aliment',
  'Save meal':'Enregistrer le repas','Save recipe':'Enregistrer la recette','Save as recipe':'Enregistrer comme recette','Use':'Utiliser','Delete':'Supprimer','Edit':'Modifier','Duplicate':'Dupliquer','Cancel':'Annuler','Close':'Fermer','Save':'Enregistrer','Add':'Ajouter','Send':'Envoyer','Done':'Terminé',
  'All':'Tout','Favorites':'Favoris','Recent':'Récents','Mine':'Mes aliments','Your foods':'Mes aliments','Recipes':'Recettes','Recent sessions':'Séances récentes','Weekly progress':'Bilan hebdomadaire','Nothing logged yet.':'Aucune entrée pour le moment.',
  'What you ate today':'Ce que vous avez mangé aujourd’hui','Today':'Aujourd’hui','Yesterday':'Hier','Breakfast':'Petit-déjeuner','Lunch':'Déjeuner','Dinner':'Dîner','Snack':'Collation',
  'Daily calories (kcal)':'Calories quotidiennes (kcal)','Protein (g)':'Protéines (g)','Carbs (g)':'Glucides (g)','Fat (g)':'Lipides (g)','Water':'Eau','Current logging streak':'Jours de suivi consécutifs',
  'Exercise library':'Bibliothèque d’exercices','Add an exercise…':'Ajouter un exercice…','Select to group':'Sélectionner pour grouper','Create superset':'Créer un superset','Circuit':'Circuit','Superset':'Superset','Save PDF':'Exporter en PDF','Add another day':'Ajouter une journée','Add your first day':'Ajouter la première journée','New day':'Nouvelle journée',
  'Personal records':'Records personnels','Personal record':'Record personnel','Training days':'Jours d’entraînement','The Feed is optional — your training data always stays on this device.':'Social est facultatif. Vos données d’entraînement restent sur cet appareil.',
  'Likes, comments and new followers.':'J’aime, commentaires et nouveaux abonnés.','Phone alerts':'Notifications du téléphone','Mark all read':'Tout marquer comme lu','Add a comment…':'Écrire un commentaire…','Could not load notifications.':'Impossible de charger les notifications.',
  'This device':'Cet appareil','Switch profile':'Changer de profil','Backup & restore':'Sauvegarde et restauration','Training progress':'Progression','Licences & acknowledgements':'Licences et crédits','The Feed':'Fil Social','Optional — your training data stays on this device':'Facultatif — vos données restent sur cet appareil',
  'Your photo, your @username, your bio.':'Votre photo, votre nom @ et votre bio.','Name':'Nom','Email':'E-mail','Password':'Mot de passe','Sign in':'Connexion','Create an account':'Créer un compte','Cancel reply':'Annuler la réponse','Add a comment':'Écrire un commentaire',
  'Add at least one food':'Ajoutez au moins un aliment','Food added':'Aliment enregistré','Meal saved':'Repas enregistré','Recipe deleted':'Recette supprimée','Goal saved':'Objectif enregistré','Backup downloaded':'Sauvegarde téléchargée',
  'Your training stays on this device':'Votre entraînement reste sur cet appareil','Program':'Programme','Personal records':'Records personnels','Everything stays on your device.':'Tout reste sur votre appareil.',
  'App preferences':'Préférences de l’application','Settings':'Réglages','Getting started':'Premiers pas','Open guide':'Ouvrir le guide','Shopping list':'Liste de courses','Backup':'Sauvegarder','Transfer':'Transférer','Save changes':'Enregistrer les modifications',
  'New followers':'Nouveaux abonnés','Likes':'J’aime','Comments and replies':'Commentaires et réponses','Mentions':'Mentions','Choose which Social alerts you receive':'Choisir les notifications Social',
  'Meals':'Repas','Session':'Séance','Records':'Records','No notifications yet.':'Aucune notification pour le moment.','Start session':'Démarrer la séance','View plan':'Voir le programme'
  ,'Two-person lifting tracker, 100% offline.':'Suivi d’entraînement pour deux, 100 % hors ligne.'
  ,'Program, sessions, weekly progress and personal records. Everything stays on your device.':'Programmes, séances, bilan hebdomadaire et records. Tout reste sur cet appareil.'
  ,'Train on your terms.':'Entraîne-toi à ton rythme.'
  ,'Your training and nutrition, ready on this device.':'Ton entraînement et ta nutrition, disponibles sur cet appareil.'
  ,'On device':'Sur cet appareil'
  ,'Next workout':'Prochaine séance'
  ,'Your training days and weekly plan':'Tes journées et ton programme de la semaine'
  ,'Pick a day':'Choisir une journée'
  ,'Edit profile':'Modifier le profil'
  ,'Change photo':'Changer la photo'
  ,'Your food list':'Ta liste d’aliments'
  ,'Your profile':'Ton profil'
  ,'Personal records':'Records personnels'
  ,'Create a day, then add its exercises in the next step':'Crée une journée, puis ajoute les exercices à l’étape suivante.'
  ,'Session name':'Nom de la séance'
  ,'Programme':'Programme'
  ,'Create day & add exercises':'Créer la journée et ajouter les exercices'
  ,'Cancel':'Annuler'
  ,'Add your first day':'Ajouter ta première journée'
  ,'Add another day':'Ajouter une autre journée'
  ,'Copy from yesterday:':'Copier le repas d’hier :'
  ,'Search the web…':'Recherche dans les bases…'
  ,'No food matches':'Aucun aliment ne correspond'
  ,'Per 100 g':'Pour 100 g'
  ,'Calories':'Calories'
  ,'Protein':'Protéines'
  ,'Carbs':'Glucides'
  ,'Fat':'Lipides'
  ,'Add a food':'Ajouter un aliment'
  ,'Nutrition values per 100 g':'Valeurs nutritionnelles pour 100 g'
  ,'Other nutrients · optional':'Autres nutriments · facultatifs'
  ,'More nutrients':'Plus de nutriments'
  ,'Favorite':'Favori'
  ,'Saved':'Enregistré'
  ,'Delete food':'Supprimer l’aliment'
  ,'Log food':'Ajouter au journal'
  ,'Add ingredients':'Ajouter des ingrédients'
  ,'Set the quantity, add it.':'Indique la quantité puis ajoute-le.'
  ,'Build a meal':'Composer un repas'
  ,'Choose foods and set portions':'Choisis les aliments et les portions.'
  ,'Totals:':'Total :'
  ,'Recipe loaded into a new meal':'Recette ajoutée à un nouveau repas.'
  ,'This browser does not support web push notifications.':'Ce navigateur ne prend pas en charge les notifications.'
  ,'Receive Social notifications when LIFTR is closed.':'Recevoir les notifications Social lorsque LIFTR est fermé.'
  ,'Allow notifications in your browser settings.':'Autorise les notifications dans les réglages du navigateur.'
  ,'Could not load people.':'Impossible de charger les profils.'
  ,'Search for a lifter by name or @username.':'Recherche un profil par nom ou @identifiant.'
  ,'No posts yet':'Aucune publication pour le moment.'
  ,'Share your first session from Home.':'Partage ta première séance depuis l’accueil.'
  ,'This account is private':'Ce compte est privé'
  ,'Follow to see their posts.':'Suis ce profil pour voir ses publications.'
  ,'Nothing posted yet':'Aucune publication pour le moment.'
  ,'Private groups & challenges':'Groupes et défis privés'
  ,'Open app shortcuts':'Ouvrir les raccourcis'
  ,'Search actions':'Rechercher une action'
  ,'Go to':'Aller à'
  ,'Your offline dashboard':'Ton tableau de bord hors ligne'
  ,'Log a training session':'Enregistrer une séance'
  ,'Build or edit your days':'Créer ou modifier tes journées'
  ,'Stats, records and trends':'Statistiques, records et tendances'
  ,'Add food to today':'Ajouter un aliment aujourd’hui'
  ,'Find a packaged food':'Trouver un produit emballé'
  ,'Search saved and verified foods':'Rechercher dans les aliments enregistrés'
  ,'Set daily targets':'Définir les objectifs quotidiens'
  ,'See your training crew':'Voir ton équipe d’entraînement'
  ,'Search Social profiles':'Rechercher des profils Social'
  ,'Open your Social inbox':'Ouvrir les messages Social'
  ,'Likes, comments and follows':'J’aime, commentaires et abonnements'
  ,'Write a Social post':'Créer une publication Social'
  ,'Ready when you are':'Prêt quand tu veux'
  ,'No session in your program yet':'Aucune séance dans ton programme pour le moment'
  ,'Create a day (PUSH, PULL, LEGS…) and it shows up here.':'Crée une journée (PUSH, PULL, LEGS…) pour la retrouver ici.'
  ,'+ New day':'+ Nouvelle journée'
  ,'Today’s intake':'Consommation du jour'
  ,'Open diary':'Ouvrir le journal'
  ,'kcal logged':'kcal consommées'
  ,'Set a daily target':'Définir un objectif quotidien'
  ,'TRAINING MAP':'CARTE DES MUSCLES'
  ,'Muscles trained':'Muscles sollicités'
  ,'Man':'Homme'
  ,'Woman':'Femme'
  ,'FRONT':'AVANT'
  ,'BACK':'ARRIÈRE'
  ,'Less':'Moins'
  ,'More volume · last 30 days':'Plus de volume · 30 derniers jours'
  ,'Finish a workout to light up the muscles you train.':'Termine une séance pour voir les muscles sollicités.'
  ,'HYDRATION':'HYDRATATION'
  ,'Quick actions':'Actions rapides'
  ,'Log a session':'Enregistrer une séance'
  ,'Open your diary':'Ouvrir ton journal'
  ,'Scan food':'Scanner un aliment'
  ,'Read a barcode':'Lire un code-barres'
  ,'Add to your story':'Ajouter à ta story'
  ,'No matching action. Try “workout”, “food” or “messages”.':'Aucune action trouvée. Essaie « séance », « aliment » ou « messages ».'
  ,'Share your first session from Home.':'Partage ta première séance depuis l’accueil.'
  ,'Program settings':'Réglages du programme'
  ,'No foods found':'Aucun aliment trouvé'
  ,'Add this food':'Ajouter cet aliment'
  ,'Choose a day':'Choisir une journée'
  ,'Today’s meals':'Repas du jour'
  ,'Add water':'Ajouter de l’eau'
  ,'Your weekly summary':'Ton bilan hebdomadaire'
  ,'Shopping list':'Liste de courses'
  ,'No recent foods yet':'Aucun aliment récent'
  ,'No favorite foods yet':'Aucun aliment favori'
  ,'No recipes yet':'Aucune recette enregistrée'
  ,'Create your first recipe':'Crée ta première recette'
  ,'Search by food name':'Rechercher un aliment'
  ,'Notifications are off':'Les notifications sont désactivées'
  ,'Turn on notifications':'Activer les notifications'
  ,'No messages yet':'Aucun message pour le moment'
  ,'Start a conversation':'Commencer une conversation'
  ,'Search people':'Rechercher des personnes'
  ,'Find people':'Découvrir des personnes'
  ,'Private profile':'Profil privé'
  ,'Follow request sent':'Demande d’abonnement envoyée'
  ,'No posts yet':'Aucune publication pour le moment'
  ,'Post':'Publier'
  ,'Photo':'Photo'
  ,'Music':'Musique'
  ,'New post':'Nouvelle publication'
  ,'What did you lift today?':'Qu’as-tu soulevé aujourd’hui ?'
  ,'No workouts yet':'Aucune séance pour le moment'
  ,'Progression suggestions':'Suggestions de progression'
  ,'Weekly summary':'Bilan de la semaine'
  ,'Rest timer':'Minuteur de repos'
  ,'Copy day':'Dupliquer la journée'
  ,'Copy session':'Dupliquer la séance'
  ,'Add exercise':'Ajouter un exercice'
  ,'Add exercise…':'Ajouter un exercice…'
  ,'Create your plan':'Créer ton programme'
  ,'Start building your plan':'Commence à créer ton programme'
  ,'Choose exercises':'Choisir des exercices'
  ,'Personal records':'Records personnels'
  ,'Nothing to show yet':'Rien à afficher pour le moment'
  ,'Workout complete':'Séance terminée'
  ,'Session complete':'Séance terminée'
  ,'New personal record':'Nouveau record personnel'
  ,'Set complete':'Série terminée'
  ,'Dismiss':'Fermer'
  ,'Continue':'Continuer'
  ,'Next':'Suivant'
  ,'Previous':'Précédent'
  ,'Back':'Retour'
  ,'Done':'Terminé'
  ,'Skip':'Passer'
  ,'Loading…':'Chargement…'
  ,'No results':'Aucun résultat'
  ,'No exercises found':'Aucun exercice trouvé'
  ,'Try another search':'Essaie une autre recherche'
  ,'Recommended':'Recommandé'
  ,'Optional':'Facultatif'
  ,'Private group':'Groupe privé'
  ,'Private challenge':'Défi privé'
  ,'Create group':'Créer un groupe'
  ,'Join group':'Rejoindre un groupe'
  ,'Invite code':'Code d’invitation'
  ,'No groups yet':'Aucun groupe pour le moment'
  ,'Record a contribution':'Enregistrer une contribution'
  ,'Leaderboard':'Classement'
  ,'Progress':'Progrès'
  ,'Privacy and blocked profiles':'Confidentialité et profils bloqués'
  ,'Manage':'Gérer'
  ,'Blocked profiles':'Profils bloqués'
  ,'Unblock':'Débloquer'
  ,'Share details':'Détails à partager'
  ,'Share workout':'Partager la séance'
  ,'Choose what to share':'Choisir les informations à partager'
  ,'Replies':'Réponses'
  ,'No notifications yet.':'Aucune notification pour le moment.'
  ,'My program':'Mon programme'
  ,'No day created yet.':'Aucune journée créée pour le moment.'
  ,'Start by adding a session (PUSH, PULL, LEGS…)':'Commence par ajouter une séance (PUSH, PULL, LEGS…).'
  ,'Programmes':'Programmes'
  ,'Programme par défaut':'Programme par défaut'
  ,'Share my program':'Partager mon programme'
  ,'Send your sessions to the other profile in one message.':'Envoie tes séances à l’autre profil dans un seul message.'
  ,'Import':'Importer'
  ,'Share my program':'Partager mon programme'
  ,'Reset training data':'Réinitialiser les données Gym'
  ,'Choose a planned day or start freely':'Choisis une journée planifiée ou démarre librement.'
  ,'Edit plan':'Modifier le programme'
  ,'No programmed days yet. You can still start a free session.':'Aucune journée au programme. Tu peux quand même démarrer une séance libre.'
  ,'Start a free session':'Démarrer une séance libre'
  ,'Calendar':'Calendrier'
  ,'Weekly plan':'Programme de la semaine'
  ,'Nothing planned':'Rien de planifié'
  ,'Weekly note':'Note de la semaine'
  ,'Sessions of the day':'Séances du jour'
  ,'No session finished on this day.':'Aucune séance terminée à cette date.'
  ,'Progressions for the selected day':'Progressions de la journée sélectionnée'
  ,'Nothing logged for this day.':'Aucune donnée pour cette journée.'
  ,'Add your progression right below.':'Ajoute ta progression ci-dessous.'
  ,'Add a progression':'Ajouter une progression'
  ,'Exercise':'Exercice'
  ,'Weight (kg)':'Poids (kg)'
  ,'Reps':'Répétitions'
  ,'Assisted reps':'Répétitions assistées'
  ,'Save progression':'Enregistrer la progression'
  ,'No sessions recorded':'Aucune séance enregistrée'
  ,'Not enough data yet':'Pas encore assez de données'
  ,'Keep logging your workouts to see your progress.':'Continue à enregistrer tes séances pour suivre ta progression.'
  ,'Body weight':'Poids corporel'
  ,'no weigh-in':'Aucune pesée'
  ,'Add at least 2 weigh-ins to see the curve.':'Ajoute au moins deux pesées pour afficher la courbe.'
  ,'First weigh-in of the day':'Première pesée du jour'
  ,"Today's weight":"Poids d’aujourd’hui"
  ,'Export CSV':'Exporter au format CSV'
  ,'Calories & macros for today':'Calories et macros du jour'
  ,'No goal set yet — open the Goal tab to set daily targets.':'Aucun objectif défini. Ouvre l’onglet Objectifs pour régler tes cibles quotidiennes.'
  ,'Nothing logged yet — tap + Add meal to record what you ate.':'Rien pour le moment. Appuie sur + Repas pour noter ce que tu as mangé.'
  ,'View progress':'Voir les progrès'
  ,'Weekly progression':'Progression hebdomadaire'
  ,'Workouts':'Séances'
  ,'Workout in progress':'Séance en cours'
  ,'Calories logged today':'Calories consommées aujourd’hui'
  ,'Water logged today':'Eau bue aujourd’hui'
  ,'Today,':'Aujourd’hui,'
  ,'Online':'En ligne'
  ,'Offline':'Hors ligne'
  ,'Share progress':'Partager un progrès'
  ,'Exercises':'Exercices'
  ,'Settings & personalization':'Réglages et personnalisation'
  ,'Language, text size, notifications, motion and shortcuts.':'Langue, taille du texte, notifications, animations et raccourcis.'
  ,'Settings are saved on this device. Gym and Nutrition remain available offline.':'Les réglages sont enregistrés sur cet appareil. Gym et Nutrition restent disponibles hors ligne.'
  ,'Language & comfort':'Langue et confort'
  ,'Language':'Langue'
  ,'Text size':'Taille du texte'
  ,'Normal':'Normale'
  ,'Large':'Grande'
  ,'Extra large':'Très grande'
  ,'Reduce motion':'Réduire les animations'
  ,'Limits movement and transitions.':'Limite les mouvements et transitions.'
  ,'Motivational quotes':'Citations motivantes'
  ,'Show motivational messages after a workout.':'Afficher des messages motivants après une séance.'
  ,'Alert me when rest ends':'Me prévenir à la fin du repos'
  ,'Send a phone notification when a rest period ends while LIFTR is in the background.':'Recevoir une notification quand le repos se termine avec LIFTR en arrière-plan.'
  ,'Enable phone notifications':'Autoriser les notifications'
  ,'Notification permission is enabled for this device.':'Les notifications sont autorisées sur cet appareil.'
  ,'Tap “Enable phone notifications” to allow alerts.':'Appuie sur « Autoriser les notifications » pour les activer.'
  ,'Notifications are blocked in this browser. Allow them in device settings.':'Les notifications sont bloquées dans ce navigateur. Autorise-les dans les réglages de l’appareil.'
  ,'This browser does not support notifications.':'Ce navigateur ne prend pas en charge les notifications.'
  ,'On iPhone, add LIFTR to the Home Screen before enabling notifications.':'Sur iPhone, ajoute LIFTR à l’écran d’accueil avant d’activer les notifications.'
  ,'Add to Home Screen first':'Ajouter à l’écran d’accueil'
  ,'Notifications allowed':'Notifications autorisées'
  ,'Open device settings':'Ouvrir les réglages de l’appareil'
  ,'Phone notifications were not enabled.':'Les notifications du téléphone n’ont pas été activées.'
  ,'The timer keeps its end time on this device. Mobile browsers may pause background work, so an alert can arrive late. A live lock screen timer needs a native iOS or Android app.':'Le minuteur conserve son heure de fin sur cet appareil. Les navigateurs mobiles peuvent suspendre le travail en arrière-plan et retarder l’alerte. Un minuteur actualisé sur l’écran verrouillé nécessite une app iOS ou Android native.'
  ,'Manage Social notifications':'Gérer les notifications Social'
  ,'Shortcuts':'Raccourcis'
  ,'Choose which actions appear in the ⌘K / Ctrl K search.':'Choisis les actions visibles dans la recherche ⌘K / Ctrl K.'
  ,'Select all':'Tout sélectionner'
  ,'Save settings':'Enregistrer les réglages'
  ,'Profile':'Profil'
  ,'Days':'Journées'
  ,'Social feed':'Fil Social'
  ,'Find lifters':'Découvrir des personnes'
  ,'Assisted reps with help':'Répétitions assistées'
  ,'Log clean reps above and reps completed with help separately. Add drops below to continue with less weight before resting.':'Saisis séparément les répétitions strictes et celles réalisées avec aide. Ajoute les dégressives ci-dessous; le repos commencera après la dernière.'
  ,'Log clean reps and reps completed with help separately. Add drops below to continue with less weight before resting.':'Saisis séparément les répétitions strictes et celles réalisées avec aide. Ajoute les dégressives ci-dessous; le repos commencera après la dernière.'
  ,'Count clean reps above, then reps completed with a partner or machine here. Example: 8+2A.':'Compte les répétitions strictes au-dessus, puis celles réalisées avec un partenaire ou une machine ici. Exemple : 8+2A.'
  ,'Drop sets':'Séries dégressives'
  ,'Continue right away with less weight. Rest starts after the last drop.':'Continue immédiatement en réduisant le poids. Le repos commence après la dernière dégressive.'
  ,'+ Add drop':'+ Ajouter une dégressive'
  ,'Drop':'Dégressive'
  ,'+ Drop set':'+ Ajouter une série dégressive'
  ,'Decrease drop weight':'Diminuer le poids de la dégressive'
  ,'Increase drop weight':'Augmenter le poids de la dégressive'
  ,'Decrease drop reps':'Diminuer les répétitions de la dégressive'
  ,'Increase drop reps':'Augmenter les répétitions de la dégressive'
  ,'Drop sets can only be added to a working set.':'Les séries dégressives s’ajoutent uniquement à une série de travail.'
}));

const originals = new WeakMap();
const EN = new Map();
for (const [english, french] of FR){
  if (!EN.has(french)) EN.set(french, english);
}
EN.set('Préférences', 'Preferences');
EN.set('Réglages', 'Settings');
EN.set('Profil', 'Profile');
let language = 'fr';
function translateValue(value){
  const key = String(value || '').trim();
  const date = language === 'fr' && key.match(/^(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY), (JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER) (\d{1,2})$/);
  if (date){
    const months = {JANUARY:0,FEBRUARY:1,MARCH:2,APRIL:3,MAY:4,JUNE:5,JULY:6,AUGUST:7,SEPTEMBER:8,OCTOBER:9,NOVEMBER:10,DECEMBER:11};
    return new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long'}).format(new Date(new Date().getFullYear(),months[date[2]],+date[3]));
  }
  const mapped = (language === 'fr' ? FR : EN).get(key);
  if (!mapped) return value;
  const lead = String(value).match(/^\s*/)?.[0] || '';
  const tail = String(value).match(/\s*$/)?.[0] || '';
  return lead + mapped + tail;
}
function visit(root){
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    if (!originals.has(node)) originals.set(node, node.nodeValue);
    const source = originals.get(node);
    const next = translateValue(source);
    if (node.nodeValue !== next) node.nodeValue = next;
  });
  const attrs = ['placeholder','aria-label','title'];
  (root.nodeType === 1 ? [root, ...root.querySelectorAll('*')] : []).forEach(el => attrs.forEach(attr => {
    if (!el.hasAttribute || !el.hasAttribute(attr)) return;
    const original = el.dataset['i18n' + attr.replace(/[^a-z]/gi,'')];
    if (original != null) el.setAttribute(attr, translateValue(original));
    else {
      const value = el.getAttribute(attr);
      el.dataset['i18n' + attr.replace(/[^a-z]/gi,'')] = value;
      el.setAttribute(attr, translateValue(value));
    }
  }));
}
export function setLanguage(next){
  language = next === 'en' ? 'en' : 'fr';
  document.documentElement.lang = language;
  visit(document.body);
  if (typeof window.renderToday === 'function') window.renderToday();
  if (window.DB && window.currentUser && typeof window.renderCalendar === 'function') window.renderCalendar();
  visit(document.body);
  return language;
}
export function currentLanguage(){ return language; }
window.setLiftrLanguage = setLanguage;
function bootI18n(){
  try { language = localStorage.getItem('liftr_language') === 'en' ? 'en' : 'fr'; } catch(e){}
  document.documentElement.lang = language;
  visit(document.body);
  const observer = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType === 1 || node.nodeType === 3) visit(node);
  })));
  observer.observe(document.body, { childList:true, subtree:true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootI18n, { once:true });
else bootI18n();
