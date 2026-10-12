/* ==================================================================
   SOCIAL - deep-links de partage dans les messages
   Un partage de post (L4) s'envoie en message avec « #p=<id> » :
   - la messagerie (inbox.js) reconnaît le lien au rendu de la bulle ;
   - le tap remplit le composer ; l'envoi révèle le post côté
     destinataire via openSharedPost (feed.js).
   Une seule source de vérité pour le motif et le texte STOCKÉ ; le
   rendu de la bulle reste en inbox.js (au plus près du DOM).
   ================================================================== */

const POST_RE = /#p=([A-Za-z0-9-]{1,64})/;

/* Le lien tel qu'il est STOCKÉ : texte brut, jamais du HTML.
   C'est ce format que la bulle reconnaît au rendu. */
export function postLinkText(id){
  const key = String(id || '').trim();
  if (!key) return '';
  return '#p=' + encodeURIComponent(key);
}

/* Un message contient-il un lien de post ? Renvoie l'id brut ou null. */
export function postLinkIn(text){
  const m = String(text || '').match(POST_RE);
  return m ? m[1] : null;
}
