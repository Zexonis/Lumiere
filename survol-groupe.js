/* ======================================================================
   Le Survol à plusieurs (DESIGN-convergence.md §3.11, recette §3.5) : un
   groupe suit un diaporama, chacun sur son appareil. Des notes communes,
   ligne par ligne ; un repère commun (Recentrer, Placer ici, Prêt·e) ; le
   même sablier. Personne n'est déplacé sans cliquer.
   Le fichier est copié à la racine du site et chargé par le bloc des notes
   (notes-survol.html), seulement quand on crée ou rejoint un groupe, ou
   qu'on arrive avec ?cv=<salle> : seul·e, aucun appel au relais. Les
   diaporamas et leur moteur ne changent pas ; on saute de diapo par
   #btn-plan + button.aller[data-i].
   Une salle = cv/<salle> (6 signes [a-z0-9]), à part de celle de l'atelier
   (uid par onglet, sa présence ne doit pas voir les diapos) :
   - membres/<uid> : {deck, nom, raie, depuis, diapo, pret, repere, sablier,
     ligne, t} ; effacée à la déconnexion, remise au retour de la connexion ;
   - tableau/<clé de diapo>/<id> = {de, k:'x', d} : une ligne de notes, avec
     d = JSON {l, t, o, v, r}. Les règles du relais n'ont pas changé : on
     ne modifie que ses propres fiches, on peut effacer toutes les autres.
     L'identité d'une ligne est donc l, pas la clé de la fiche : éditer la
     ligne d'un autre, c'est effacer sa fiche et créer la mienne, avec le
     même l et un v plus récent, en une seule écriture (update).
   Les fonctions pures sont dans PUR : outils/test_survol_groupe.js.
   ====================================================================== */
const SurvolGroupe = (() => {
'use strict';
const LUMIERE = 'https://zexonis.github.io/Lumiere/';
const SDK_FIREBASE = 'vendor/firebase-12.19.0.js?b=2';     // le même paquet que convergence.js (le test le vérifie)
const SDK_QR = 'vendor/qrcode-generator-1.4.4.js';
const FIREBASE = {apiKey:'AIzaSyBle6I_mp2DGBGubm5pcc4MOogoyECEu64', authDomain:'lumiere-convergence.firebaseapp.com',
  databaseURL:'https://lumiere-convergence-default-rtdb.firebaseio.com', projectId:'lumiere-convergence',
  storageBucket:'lumiere-convergence.firebasestorage.app', messagingSenderId:'560102754287', appId:'1:560102754287:web:04b8d69b174ccfdf0c581a'};
const RAIES = {C:['656,3', '#FF5A4A'], d:['587,6', '#FFD23F'], e:['546,1', '#9BF25C'], F:['486,1', '#34C6FF'], g:['435,8', '#A385FF']};
const NOMS = ['Photon', 'Prisme', 'Lumen', 'Iris', 'Halo', 'Zénith', 'Aurore', 'Spectre', 'Éclat', 'Quanta'];
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
const CLE_PASSE = 'lumiere-cv-passe', CLE_RAIE = 'lumiere-cv-raie', CLE_NOM = 'lumiere-cv-nom', CLE_RYTHME = 'lumiere-cv-rythme';
const VIE_PASSE = 600000;                  // le passage de l'atelier au Survol : 10 minutes
const ECRITURE = 250, VERROU = 4500, MAX_LIGNES = 200, MAX_TEXTE = 2000, MAX_GROUPE = 32;
const AVANT = 30000;                       // l'avis qui précède une pause
const REGLAGES = [[5, 5], [15, 3], [25, 5], [45, 10]];

/* ---------- règles pures ---------- */
const raieOk = r => Object.prototype.hasOwnProperty.call(RAIES, r) ? r : 'F';
/* la salle du Survol d'une séance : le même code et le même diaporama donnent la même salle, sans porte (copiée dans convergence.js) */
function salleSurvol(code, fichier){
  const A = 'abcdefghjkmnpqrstuvwxyz23456789', s = String(code).toLowerCase() + '|' + String(fichier).toLowerCase();
  let a = 0x811c9dc5, b = 0x9e3779b9, r = '';
  for(let i = 0; i < s.length; i++){ const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b + c, 0x5bd1e995) ^ (b >>> 15); }
  a >>>= 0; b >>>= 0;
  for(let i = 0; i < 3; i++){ r += A[a % 31] + A[b % 31]; a = Math.floor(a / 31); b = Math.floor(b / 31); }
  return r;
}
/* la clé d'une diapo au relais, tirée de la clé de sa note (son titre) : elle suit la diapo si l'ordre change */
function cleDiapo(cle){
  const s = String(cle);
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for(let i = 0; i < s.length; i++){ const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b + c, 0x5bd1e995) ^ (b >>> 15); }
  return 's' + (a >>> 0).toString(36) + '-' + (b >>> 0).toString(36);
}
/* l'ordre des lignes : une clé en base 62, classée par code de caractère, jamais finie par 0 (il reste toujours une place avant).
   cleEntre(a, b) rend une clé strictement entre a et b ('' : pas de borne). Deux clés égales (deux insertions au même endroit) :
   la nouvelle passe après les deux. */
const O62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function cleEntre(a, b){
  a = a || ''; b = b || '';
  if(b && a >= b) return a + 'V';
  let p = '';
  for(let i = 0; ; i++){
    const x = i < a.length ? O62.indexOf(a[i]) : 0, y = b && i < b.length ? O62.indexOf(b[i]) : 62;
    if(x === y){ p += O62[x]; continue; }
    if(y - x > 1) return p + O62[Math.floor((x + y) / 2)];
    /* voisins : on garde le chiffre de a et on cherche plus haut que la suite de a */
    p += O62[x];
    for(let j = i + 1; ; j++){
      const z = j < a.length ? O62.indexOf(a[j]) : 0;
      if(62 - z > 1) return p + O62[Math.floor((z + 62) / 2)];
      p += O62[z];
    }
  }
}
/* une fiche du relais → une ligne, ou null : ce qui vient du relais n'est jamais cru tel quel */
function lireLigne(rec){
  if(!rec || typeof rec.d !== 'string') return null;
  let x = null; try{ x = JSON.parse(rec.d); }catch(e){ return null; }
  if(!x || typeof x.l !== 'string' || !/^[A-Za-z0-9_-]{1,24}$/.test(x.l) || typeof x.t !== 'string' || typeof x.o !== 'string' ||
    !/^[0-9A-Za-z]{1,200}$/.test(x.o) || !Number.isFinite(x.v)) return null;
  return {l:x.l, t:x.t.slice(0, MAX_TEXTE), o:x.o, v:x.v, r:raieOk(x.r), de:typeof rec.de === 'string' ? rec.de : ''};
}
/* les fiches d'une diapo → ses lignes dans l'ordre. Deux fiches pour un même l : la plus haute (v, clé) gagne ; perdants = les
   clés à effacer. Tout le monde plie pareil, quel que soit l'ordre d'arrivée. */
function plierLignes(recs){
  const vues = new Map(), perdants = [];
  Object.keys(recs || {}).forEach(cle => {
    const x = lireLigne(recs[cle]); if(!x) return;
    x.cle = cle;
    const a = vues.get(x.l);
    if(!a){ vues.set(x.l, x); return; }
    const neuve = x.v !== a.v ? x.v > a.v : x.cle > a.cle;
    perdants.push(neuve ? a.cle : x.cle);
    if(neuve) vues.set(x.l, x);
  });
  const lignes = Array.from(vues.values()).sort((a, b) => a.o < b.o ? -1 : a.o > b.o ? 1 : a.l < b.l ? -1 : a.l > b.l ? 1 : 0);
  return {lignes, perdants};
}
/* qui écrit sur cette ligne (son uid, ou '') : p.ligne = {e, l, t, d}, t sa dernière frappe, d le début de sa saisie. Si deux
   commencent ensemble, la saisie la plus ancienne garde la ligne ; à égalité, le plus petit uid. */
function verrouDe(e, l, autres, mien, t0){
  const vif = x => x && x.e === e && x.l === l && t0 - x.t < VERROU;
  const avant = (a, ua, b, ub) => a.d !== b.d ? a.d < b.d : ua < ub;
  let u = '', x = null;
  autres.forEach(m => { if(vif(m.ligne) && (!x || avant(m.ligne, m.uid, x, u))){ x = m.ligne; u = m.uid; } });
  return x && vif(mien.ligne) && avant(mien.ligne, mien.uid, x, u) ? '' : u;
}
function lirePoste(x){
  if(!x || typeof x !== 'object' || typeof x.e !== 'string' || typeof x.l !== 'string' || !Number.isFinite(x.t) || !Number.isFinite(x.d)) return null;
  return {e:x.e, l:x.l, t:x.t, d:x.d};
}
/* l'ordre du groupe : le plus ancien d'abord ; le premier départage et avance le repère */
function ordreGroupe(l){
  return l.slice().sort((a, b) => (a.depuis || 9e15) - (b.depuis || 9e15) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)).map(x => x.uid);
}
/* le repère (comme dans l'atelier) : {i, n, par}. Le n le plus haut gagne ; à égalité sur une autre diapo, le premier du groupe */
function repereGagne(r, mien, cle){
  if(r.n !== mien.n) return r.n > mien.n;
  if(r.i === mien.i) return false;
  const a = cle(r.par), b = cle(mien.par);
  return a < b || (a === b && r.par < mien.par);
}
function lireRepere(x, N){
  if(!x || typeof x !== 'object') return null;
  const i = +x.i, n = +x.n;
  if(!(Number.isInteger(i) && i >= 0 && i < N && Number.isInteger(n) && n > 0)) return null;
  return {i, n, par:typeof x.par === 'string' ? x.par.slice(0, 128) : '', auto:x.auto === true};
}
/* tout le monde est prêt : le repère suivant, {fin:true} au bout du diaporama, ou null. prets : [{uid, pret}], tous les présents dans
   l'ordre du groupe, moi compris. Seule la page du premier l'écrit ; seul·e, on n'avance pas (comme dans l'atelier). */
function avancePret(rep, moi, prets, N){
  if(!rep.n || prets.length < 2 || prets[0].uid !== moi || !prets.every(p => p.pret === rep.n)) return null;
  return rep.i + 1 >= N ? {fin:true} : {i:rep.i + 1, n:rep.n + 1, par:moi, auto:true};
}

/* ---------- le rythme : copié tel quel de sablier.js (le test vérifie que les trois textes sont identiques) ---------- */
  function phaseRythme(r, maintenant){
    const T = r.t * 60000, C = T + r.p * 60000, e = maintenant - r.d, x = ((e % C) + C) % C;
    return {pause:x >= T, reste:x < T ? T - x : C - x, cycle:Math.floor(e / C)};
  }
  function rythmeGagne(r, mien, cle){
    if(r.n !== mien.n) return r.n > mien.n;
    if(r.on === mien.on && r.t === mien.t && r.p === mien.p && r.d === mien.d) return false;
    const a = cle(r.par), b = cle(mien.par);
    return a < b || (a === b && r.par < mien.par);
  }
  function lireRythme(x){
    if(!x || typeof x !== 'object') return null;
    const n = +x.n, t = +x.t, p = +x.p, d = +x.d;
    if(!(Number.isInteger(n) && n > 0 && t > 0 && t <= 180 && p > 0 && p <= 60 && d > 0 && Number.isFinite(d))) return null;
    return {n, on:x.on === true, t, p, d, par:typeof x.par === 'string' ? x.par.slice(0, 128) : ''};
  }
const cleCycle = (r, ph) => r.d + ':' + ph.cycle;
/* changer le rythme pendant une pause ne l'écourte pas : le nouveau commence à la fin de la pause en cours (changerSablier, convergence.js) */
function rythmeChange(a, c, t0, moi){
  const ph = a.on && c.on ? phaseRythme(a, t0) : null, apres = ph && ph.pause ? ph.reste : 0;
  return {r:{n:a.n + 1, on:c.on, t:c.on ? c.t : a.t, p:c.on ? c.p : a.p, d:c.on ? t0 + apres : a.d, par:moi}, apres};
}
const PUR = {salleSurvol, cleDiapo, cleEntre, lireLigne, plierLignes, verrouDe, lirePoste, ordreGroupe, repereGagne, lireRepere, avancePret,
  phaseRythme, rythmeGagne, lireRythme, cleCycle, rythmeChange, VERROU, FIREBASE, SDK_FIREBASE, RAIES};

/* ---------- la page ---------- */
let api = null;                            // ce que prête le bloc des notes (notes-survol.html)
let ecrans = [], connus = new Set();       // la clé de chaque diapo au relais
const VIDE_R = () => ({i:0, n:0, par:'', auto:false}), VIDE_S = () => ({n:0, on:false, t:5, p:5, d:0, par:''});
const S = {F:null, app:null, auth:null, db:null, uid:'', refMoi:null, actif:false, salle:'', base:'', nom:'', raie:'F', depuis:0, membres:{},
  repere:VIDE_R(), pret:0, sablier:VIDE_S(), decalage:0, desab:[], premier:false, enLigne:false, coupe:false, reparation:false, tReparer:0,
  notes:false, maLigne:null, atelier:false};
const maintenant = () => Date.now() + S.decalage;   // l'heure du relais
const $ = (s, r) => (r || document).querySelector(s);
const H = h => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
const propre = (x, max) => typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g, ' ').trim().slice(0, max) : '';
const couleur = r => RAIES[raieOk(r)][1];
const reduit = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const lireObjet = k => { try{ const v = JSON.parse(api.lire(k)); return v && typeof v === 'object' ? v : null; }catch(e){ return null; } };
const codeVu = s => s.slice(0, 3).toUpperCase() + '-' + s.slice(3).toUpperCase();
function aleatoire(n, abc){
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return Array.from(a, x => abc[x % abc.length]).join('');
}
const nouvelId = () => aleatoire(12, O62);
const nomU = u => u === S.uid ? S.nom : S.membres[u] ? S.membres[u].nom : 'Quelqu’un';
const raieU = u => u === S.uid ? S.raie : S.membres[u] ? S.membres[u].raie : 'F';
const diapoU = u => u === S.uid ? api.cur() : S.membres[u] ? S.membres[u].diapo : 0;
const pretU = u => u === S.uid ? S.pret : S.membres[u] ? S.membres[u].pret : 0;
const rang = () => ordreGroupe(Object.keys(S.membres).map(u => ({uid:u, depuis:S.membres[u].depuis})).concat({uid:S.uid, depuis:S.depuis}));
const estPremier = () => rang()[0] === S.uid;
const cleRang = () => { const o = rang(); return u => { const i = o.indexOf(u); return i < 0 ? 1e6 : i; }; };
function listeNoms(l){
  l = l.map(n => '« ' + n + ' »');
  if(l.length > 3) return l.slice(0, 2).join(', ') + ' et ' + (l.length - 2) + ' autres';
  return l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' et ' + l[l.length - 1];
}

/* ---------- le relais ---------- */
let chargement = null, connexion = null;
function chargerFirebase(){
  if(!chargement){
    const sources = (/^https?:$/.test(location.protocol) ? [new URL(SDK_FIREBASE, document.baseURI).href] : []).concat(LUMIERE + SDK_FIREBASE);
    chargement = sources.reduce((p, url) => p.catch(() => import(url)), Promise.reject())
      .catch(() => { chargement = null; throw {code:'sdk'}; });
  }
  return chargement;
}
/* une connexion anonyme par onglet : un rechargement garde la même */
function connecter(){
  if(!connexion) connexion = (async () => {
    if(!S.F){
      const F = await chargerFirebase();
      S.app = F.initializeApp(FIREBASE, 'survol');
      S.auth = F.initializeAuth(S.app, {persistence:F.browserSessionPersistence});
      S.db = F.getDatabase(S.app);
      S.F = F;
    }
    await S.auth.authStateReady();
    if(!S.auth.currentUser) await S.F.signInAnonymously(S.auth);
    S.uid = S.auth.currentUser.uid;
  })().finally(() => { connexion = null; });
  return connexion;
}
function moi(){
  return {v:1, deck:api.fichier, nom:S.nom, raie:S.raie, depuis:S.depuis, diapo:api.cur(), pret:S.pret,
    repere:S.repere.n ? S.repere : null, sablier:S.sablier.n ? S.sablier : null, t:Date.now()};
}
let tPres = null;
function publier(){
  if(!S.refMoi) return;
  clearTimeout(tPres);
  tPres = setTimeout(() => { if(S.refMoi) S.F.update(S.refMoi, moi()).catch(() => toast('Le relais ne répond plus : vérifie ta connexion.')); }, 60);
}
/* la présence a disparu du relais (une coupure, ou l'onDisconnect d'un onglet rechargé qui arrive après coup) : on la remet et on
   réarme l'onDisconnect, que la coupure a consommé. Au plus une fois toutes les 3 s. */
async function reparer(){
  if(!S.refMoi || S.reparation || Date.now() - S.tReparer < 3000) return;
  S.reparation = true; S.tReparer = Date.now();
  const r = S.refMoi;
  try{
    await S.F.onDisconnect(r).remove();
    if(S.refMoi === r) await S.F.update(r, moi());
  }catch(e){}
  finally{ S.reparation = false; }
}
const CLE_SEANCE = () => 'survol-cv:' + api.fichier;
function sauver(){
  try{
    if(S.actif) sessionStorage.setItem(CLE_SEANCE(), JSON.stringify({salle:S.salle, nom:S.nom, raie:S.raie, depuis:S.depuis, repere:S.repere, pret:S.pret,
      sablier:S.sablier, decalage:S.decalage, notes:S.notes, atelier:S.atelier}));
    else sessionStorage.removeItem(CLE_SEANCE());
  }catch(e){}
}
const adresse = salle => { try{ history.replaceState(null, '', location.pathname + (salle ? '?cv=' + salle : '') + location.hash); }catch(e){} };

/* o = {nom, raie, rythme} ; ou une reprise après rechargement : o.reprise = ce que sauver() a gardé */
async function entrer(salle, o){
  if(S.actif) return true;
  const g = o.reprise || null;
  Object.assign(S, {salle, base:'cv/' + salle, nom:propre(o.nom, 24) || 'Photon', raie:raieOk(o.raie), membres:{}, premier:true,
    depuis:g ? +g.depuis || Date.now() : Date.now(), repere:g ? lireRepere(g.repere, api.diapos.length) || VIDE_R() : VIDE_R(), pret:g ? g.pret | 0 : 0,
    sablier:lireRythme(g ? g.sablier : o.rythme) || VIDE_S(), decalage:g ? +g.decalage || 0 : 0, notes:!!(g && g.notes), atelier:!!(g ? g.atelier : o.atelier)});
  try{ await connecter(); }catch(e){ return false; }
  const F = S.F, db = S.db;
  S.refMoi = F.ref(db, S.base + '/membres/' + S.uid);
  try{ await F.onDisconnect(S.refMoi).remove(); await F.set(S.refMoi, moi()); }
  catch(e){ S.refMoi = null; return false; }
  S.actif = true; S.enLigne = true; S.coupe = false;
  document.documentElement.style.setProperty('--sg-a', couleur(S.raie));
  const perdu = () => toast('Le groupe a été coupé par le relais. Quitte, puis recommence.');
  S.desab.push(F.onValue(F.ref(db, '.info/serverTimeOffset'), s => { S.decalage = +s.val() || 0; }));
  S.desab.push(F.onValue(F.ref(db, '.info/connected'), s => {
    if(s.val() !== true){ if(S.enLigne) S.coupe = true; S.enLigne = false; return; }
    S.enLigne = true;
    if(S.coupe){ S.coupe = false; S.tReparer = 0; reparer(); }
  }));
  S.desab.push(F.onValue(F.ref(db, S.base + '/membres'), s => surMembres(s.val() || {}), perdu));
  const r = F.ref(db, S.base + '/tableau');
  S.desab.push(F.onChildAdded(r, surEcran, refus), F.onChildChanged(r, surEcran), F.onChildRemoved(r, s => surEcran({key:s.key, val:() => null})));
  montrerBarre();
  api.bouton.hidden = true;
  api.groupe(V);
  if(S.notes) api.montrer(V);
  adresse(salle); sauver();
  tempo();
  return true;
}
async function quitter(){
  if(!S.actif) return;
  V.avant(); garderCopie(true);
  const salle = S.salle, nom = S.nom, raie = S.raie, r = S.refMoi;
  S.desab.forEach(f => { try{ f(); }catch(e){} }); S.desab = [];
  S.refMoi = null; S.actif = false;
  clearTimeout(tPres); clearTimeout(tR); clearTimeout(tVerrou);
  couper(); fermerPop();
  api.groupe(null);
  cacherBarre();
  api.bouton.hidden = false;
  adresse(''); sauver();
  Object.assign(N, {E:{}, plis:{}, ecran:'', brouillon:null, aFocus:null});
  N.rows.clear();
  if(N.liste) N.liste.textContent = '';
  Object.assign(S, {membres:{}, repere:VIDE_R(), pret:0, sablier:VIDE_S(), maLigne:null, notes:false, atelier:false});
  if(r){ try{ await S.F.onDisconnect(r).cancel(); await S.F.remove(r); }catch(e){} }
  toast('Tu as quitté le groupe. Ses notes restent en copie sur cet appareil.', 'Revenir', () => entrer(salle, {nom, raie}));
}

/* ---------- le groupe : la présence ---------- */
const sortis = {};                         // uid → la minuterie de son départ annoncé
function lireMembre(p){
  return {nom:propre(p.nom, 24) || 'Quelqu’un', raie:raieOk(p.raie), depuis:+p.depuis || 0, diapo:Number.isInteger(p.diapo) ? p.diapo : 0,
    pret:typeof p.pret === 'number' ? p.pret : 0, ligne:lirePoste(p.ligne)};
}
function surMembres(m){
  /* ma présence a disparu alors que la connexion est là : on la remet */
  if(S.refMoi && S.enLigne && !m[S.uid]) reparer();
  const avant = S.membres, neuf = {}, ps = [];
  let ailleurs = false;
  Object.keys(m).forEach(u => {
    const p = m[u];
    if(u === S.uid || !p || typeof p !== 'object') return;
    if(p.deck !== api.fichier){ ailleurs = true; return; }
    neuf[u] = lireMembre(p); ps.push([u, p]);
  });
  const premier = S.premier; S.premier = false;
  S.membres = neuf;
  const n = Object.keys(neuf).length;
  if(premier && n >= MAX_GROUPE){ quitter(); toast('Groupe complet : ' + MAX_GROUPE + ' personnes y sont déjà.'); return; }
  if(premier && !n && ailleurs) toast('Ce code est ouvert sur un autre Survol : ouvre le même pour retrouver le groupe.');
  if(!premier){
    /* un rechargement ou un téléphone qui s'endort un instant n'est ni un départ ni une arrivée : on attend avant de le dire */
    const arrives = Object.keys(neuf).filter(u => !avant[u] && !(u in sortis)).map(u => neuf[u].nom);
    Object.keys(sortis).forEach(u => { if(neuf[u]){ clearTimeout(sortis[u]); delete sortis[u]; } });
    if(arrives.length) toast(listeNoms(arrives) + (arrives.length > 1 ? ' rejoignent' : ' rejoint') + ' le groupe. Vous êtes ' + (n + 1) + '.');
    Object.keys(avant).forEach(u => {
      if(neuf[u]) return;
      const nom = avant[u].nom;
      sortis[u] = setTimeout(() => { delete sortis[u]; if(S.actif && !S.membres[u]) toast('« ' + nom + ' » a quitté le groupe.'); }, 6000);
    });
  }
  ps.forEach(([u, p]) => accorderRepere(u, p.repere, premier));
  /* personne n'avait de repère : il commence ici (s'il y en a deux en même temps, le premier du groupe départage) */
  if(!S.repere.n){ S.repere = {i:api.cur(), n:1, par:S.uid, auto:false}; publier(); sauver(); }
  ps.forEach(([u, p]) => accorderSablier(u, p.sablier, premier));
  if(premier && n && api.cur() !== S.repere.i) toast('Le repère du groupe est sur la diapo ' + (S.repere.i + 1) + '.', 'Recentrer', recentrer);
  verifierPrets();
  majBarre(); majPop();
  peindreLignes();
}
function accorderRepere(u, x, silence){
  const r = lireRepere(x, api.diapos.length); if(!r) return;
  if(!r.par) r.par = u;
  if(!repereGagne(r, Object.assign({}, S.repere, {par:S.repere.par || S.uid}), cleRang())) return;
  const debut = !S.repere.n;
  S.repere = r;
  publier(); sauver();
  if(silence || debut) return;
  const d = 'diapo ' + (r.i + 1);
  toast(r.auto ? 'Repère avancé : ' + d + '.' : '« ' + nomU(r.par) + ' » a placé le repère sur la ' + d + '.', api.cur() === r.i ? '' : 'Recentrer', recentrer);
}
/* sauter à une diapo sans toucher au moteur : le plan du diaporama (comme l'audit) */
function allerA(i){
  const plan = $('#btn-plan'); if(!plan) return;
  plan.click();
  const b = $('button.aller[data-i="' + i + '"]');
  if(b) b.click();
}
function recentrer(){
  if(!S.repere.n || api.cur() === S.repere.i) return;
  const f = document.activeElement;
  allerA(S.repere.i);
  if(f && f.isConnected && f !== document.body) f.focus({preventScroll:true});
}
function placerRepere(){
  S.repere = {i:api.cur(), n:S.repere.n + 1, par:S.uid, auto:false}; S.pret = 0;
  publier(); sauver(); majBarre(); majPop();
  toast('Repère placé sur la diapo ' + (S.repere.i + 1) + '.');
}
function basculerPret(){
  S.pret = S.pret === S.repere.n ? 0 : S.repere.n;
  publier(); sauver(); majBarre(); majPop(); verifierPrets();
}
/* tout le monde est prêt : seule la page du premier du groupe avance le repère, pour que toutes s'accordent */
function verifierPrets(){
  const a = avancePret(S.repere, S.uid, rang().map(u => ({uid:u, pret:pretU(u)})), api.diapos.length);
  if(!a) return;
  S.pret = 0;
  if(a.fin){ publier(); majBarre(); toast('Fin du Survol atteinte ensemble. Bravo !'); return; }
  S.repere = a;
  publier(); sauver(); majBarre();
  toast('Repère avancé : diapo ' + (a.i + 1) + '.', api.cur() === a.i ? '' : 'Recentrer', recentrer);
}

/* ---------- le petit avis, en haut ---------- */
let avis = null, tAvis = 0;
function toast(t, action, fn){
  if(!avis){ avis = H('<div class="sg-avis" role="status" aria-live="polite"></div>'); document.body.appendChild(avis); }
  avis.textContent = '';
  const p = document.createElement('span'); p.textContent = t; avis.appendChild(p);
  if(action){ const b = H('<button type="button"></button>'); b.textContent = action; b.addEventListener('click', () => { avis.hidden = true; fn(); }); avis.appendChild(b); }
  avis.hidden = false; clearTimeout(tAvis); tAvis = setTimeout(() => { avis.hidden = true; }, action ? 9000 : 5000);
}

/* ---------- la barre : une rangée sous la barre du haut ; quand la place manque (mesurée sur elle : @container), Placer ici,
   Inviter et Quitter passent dans la liste du groupe ---------- */
let barre = null, ptsAvant = '';
function montrerBarre(){
  if(!barre){
    barre = H('<section class="sg-barre" aria-label="Le groupe"><div class="sg-rang">' +
      '<button type="button" class="sg-qui" data-a="groupe" aria-haspopup="dialog"><span class="sg-pts"></span><b class="sg-nb"></b></button>' +
      '<span class="sg-rep" title="Le repère du groupe">Repère : diapo <b class="sg-rep-n"></b></span>' +
      '<button type="button" data-a="recentrer" title="Aller à la diapo du repère">Recentrer<span class="sg-court"></span></button>' +
      '<button type="button" class="sg-large" data-a="placer" title="Placer le repère du groupe sur cette diapo">Placer ici</button>' +
      '<button type="button" data-a="pret" aria-pressed="false" title="Quand tout le monde est prêt, le repère avance">Prêt·e <span class="sg-k"></span></button>' +
      '<span class="sg-espace"></span>' +
      '<button type="button" class="sg-sab" data-a="sablier" aria-haspopup="dialog"></button>' +
      '<button type="button" class="sg-large" data-a="inviter" aria-haspopup="dialog">Inviter</button>' +
      '<button type="button" class="sg-large" data-a="quitter">Quitter</button></div></section>');
    barre.addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if(!b) return;
      ({groupe:() => ouvrirGroupe(b), recentrer, placer:placerRepere, pret:basculerPret, sablier:() => ouvrirSablier(b), inviter:() => ouvrirInvite(b), quitter})[b.dataset.a]();
    });
    ($('.progres') || $('.haut')).after(barre);
    $('.sg-sab', barre).innerHTML = verre(true) + '<span class="sg-sab-t"></span>';
  }
  barre.hidden = false;
  document.body.classList.add('sg-groupe');
  majBarre(); majSablier();
}
function cacherBarre(){ if(barre) barre.hidden = true; document.body.classList.remove('sg-groupe'); }
function majBarre(){
  if(!barre || !S.actif) return;
  const r = rang(), ici = api.cur();
  const pts = r.map(u => '<i class="sg-pt' + (u === S.uid ? ' moi' : '') + '" style="--c:' + couleur(raieU(u)) + '" title="« ' + esc(nomU(u)) + ' » · diapo ' + (diapoU(u) + 1) + '">' + (diapoU(u) + 1) + '</i>').join('');
  if(pts !== ptsAvant){ ptsAvant = pts; $('.sg-pts', barre).innerHTML = pts; }
  $('.sg-nb', barre).textContent = r.length;
  $('.sg-qui', barre).setAttribute('aria-label', r.length + (r.length > 1 ? ' personnes' : ' personne') + ' dans le groupe : voir la liste');
  $('.sg-rep-n', barre).textContent = S.repere.i + 1;
  $('.sg-court', barre).textContent = ' ' + (S.repere.i + 1);
  $('[data-a="recentrer"]', barre).disabled = ici === S.repere.i;
  const p = $('[data-a="pret"]', barre), mienPret = S.pret === S.repere.n && S.repere.n > 0;
  p.setAttribute('aria-pressed', String(mienPret));
  $('.sg-k', barre).textContent = r.filter(u => pretU(u) === S.repere.n).length + '/' + r.length;
}

/* ---------- une petite fenêtre à la fois sous la barre : la liste du groupe, l'invitation, le sablier ---------- */
let pop = null, popSorte = '', popAncre = null;
function fermerPop(){
  if(!pop) return;
  pop.remove(); pop = null; popSorte = '';
  const a = popAncre; popAncre = null;
  if(a && a.isConnected && a.offsetParent) a.focus({preventScroll:true});
}
function ouvrirPop(sorte, ancre, label){
  const meme = popSorte === sorte;
  fermerPop();
  if(meme) return null;
  popSorte = sorte; popAncre = ancre || null;
  pop = H('<div class="sg-pop" role="dialog"></div>');
  pop.setAttribute('aria-label', label);
  document.body.appendChild(pop);
  pop.addEventListener('keydown', e => { if(e.key === 'Escape'){ e.preventDefault(); fermerPop(); } e.stopPropagation(); });
  return pop;
}
function placerPop(){
  if(!pop) return;
  const r = (popAncre && popAncre.isConnected ? popAncre : barre).getBoundingClientRect(), pw = Math.min(320, window.innerWidth - 24);
  pop.style.width = pw + 'px';
  pop.style.left = Math.round(Math.max(12, Math.min(r.left, window.innerWidth - pw - 12))) + 'px';
  pop.style.top = Math.round(Math.max(12, Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 12))) + 'px';
}
function majPop(){ if(popSorte === 'groupe') remplirGroupe(); }
function ouvrirGroupe(a){
  if(!ouvrirPop('groupe', a, 'Le groupe')) return;
  remplirGroupe(); placerPop();
  pop.addEventListener('click', e => {
    const b = e.target.closest('[data-g]'); if(!b) return;
    const g = b.dataset.g;
    if(g === 'placer'){ placerRepere(); fermerPop(); }
    else if(g === 'inviter') ouvrirInvite(a);
    else if(g === 'quitter'){ fermerPop(); quitter(); }
  });
  const f = $('button', pop); if(f) f.focus({preventScroll:true});
}
function remplirGroupe(){
  const r = rang();
  const h = '<p class="sg-pop-t">Le groupe · ' + codeVu(S.salle) + '</p><ul class="sg-gens">' + r.map(u => '<li><i class="sg-pt" style="--c:' + couleur(raieU(u)) + '">' + (diapoU(u) + 1) + '</i><span>« ' + esc(nomU(u)) + ' »' + (u === S.uid ? ' (toi)' : '') + '</span>' +
    '<small>diapo ' + (diapoU(u) + 1) + (pretU(u) === S.repere.n ? ' · prêt·e ✓' : '') + '</small></li>').join('') + '</ul>' +
    '<div class="sg-pop-b"><button type="button" data-g="placer">Placer ici</button><button type="button" data-g="inviter">Inviter</button><button type="button" data-g="quitter">Quitter</button></div>';
  /* la présence arrive souvent : on ne touche la liste que si elle change, sinon le clavier y perdrait sa place */
  if(pop.dataset.h !== h){ const k = document.activeElement && document.activeElement.dataset.g; pop.innerHTML = h; pop.dataset.h = h; if(k) $('[data-g="' + k + '"]', pop).focus({preventScroll:true}); }
}
function lienInvitation(){
  const page = /^https?:$/.test(location.protocol) ? location.origin + location.pathname : LUMIERE + api.fichier + '.html';
  return page + '?cv=' + S.salle;
}
function copierTexte(texte, ok, sinon){
  (navigator.clipboard ? navigator.clipboard.writeText(texte) : Promise.reject()).then(() => toast(ok), () => toast(sinon));
}
let chargementQR = null;
function chargerQR(){
  if(!chargementQR){
    const sources = (/^https?:$/.test(location.protocol) ? [new URL(SDK_QR, document.baseURI).href] : []).concat(LUMIERE + SDK_QR);
    chargementQR = sources.reduce((p, url) => p.catch(() => import(url)), Promise.reject())
      .then(m => { if(typeof m.default !== 'function') throw new Error('qr'); return m.default; })
      .catch(() => { chargementQR = null; throw {code:'qr'}; });
  }
  return chargementQR;
}
/* noir sur blanc, avec sa marge de quatre modules, quel que soit le thème : c'est ce que lisent les appareils photo */
function svgQR(qrcode, texte, nom){
  const q = qrcode(0, 'M'); q.addData(texte); q.make();
  const n = q.getModuleCount(), m = 4;
  let d = '';
  for(let r = 0; r < n; r++) for(let c = 0; c < n;){
    if(!q.isDark(r, c)){ c++; continue; }
    let f = c; while(f < n && q.isDark(r, f)) f++;
    d += 'M' + (c + m) + ' ' + (r + m) + 'h' + (f - c) + 'v1h-' + (f - c) + 'z';
    c = f;
  }
  const t = n + 2 * m;
  return '<svg viewBox="0 0 ' + t + ' ' + t + '" shape-rendering="crispEdges" role="img" aria-label="' + esc(nom) + '"><rect width="' + t + '" height="' + t + '" fill="#fff"/><path fill="#000" d="' + d + '"/></svg>';
}
function ouvrirInvite(a){
  if(!ouvrirPop('inviter', a, 'Inviter')) return;
  const lien = lienInvitation(), code = codeVu(S.salle), p = pop;
  p.innerHTML = '<p class="sg-pop-t">Inviter quelqu’un</p><p class="sg-code"></p><div class="sg-qr"><span>Code QR…</span></div>' +
    '<p class="sg-aide">Avec l’appareil photo du téléphone, ou par le lien : la page s’ouvre sur ce groupe. Sinon, le code suffit : « Convergence », puis « Rejoindre ».</p>' +
    '<div class="sg-pop-b"><button type="button" data-i="lien">Copier le lien</button><button type="button" data-i="code">Copier le code</button><button type="button" data-i="fermer">Fermer</button></div>';
  $('.sg-code', p).textContent = code;
  $('.sg-code', p).setAttribute('aria-label', 'Code du groupe : ' + code.split('').join(' '));
  placerPop();
  const z = $('.sg-qr', p);
  chargerQR().then(q => { if(pop === p){ z.innerHTML = svgQR(q, lien, 'Code QR du lien pour rejoindre le groupe ' + code); placerPop(); } },
    () => { if(pop === p) z.textContent = 'Le code QR n’a pas pu se charger : envoie le lien, ou donne le code.'; });
  p.addEventListener('click', e => {
    const b = e.target.closest('[data-i]'); if(!b) return;
    const i = b.dataset.i;
    if(i === 'fermer') fermerPop();
    else if(i === 'lien') copierTexte(lien, 'Lien copié : il ouvre ce Survol, dans ce groupe.', 'Le lien : ' + lien);
    else copierTexte(code, 'Code copié : ' + code + '.', 'Le code du groupe : ' + code + '.');
  });
  $('[data-i="lien"]', p).focus({preventScroll:true});
}

/* ---------- entrer : arriver par un lien, ou « Convergence » dans le diaporama ---------- */
let porte = null;
function fermerPorte(){ if(porte){ porte.remove(); porte = null; } }
/* salleLien : arrivé par un lien ou un code connu ; sinon « Créer » ou « Rejoindre » */
function ouvrirPorte(salleLien){
  if(porte) return;
  let raie = api.lire(CLE_RAIE); if(!Object.prototype.hasOwnProperty.call(RAIES, raie)) raie = Object.keys(RAIES)[Math.floor(Math.random() * 5)];
  let creer = !salleLien;
  const nom0 = propre(api.lire(CLE_NOM), 24), place = NOMS[Math.floor(Math.random() * NOMS.length)];
  porte = H('<div class="sg-porte" role="dialog" aria-modal="true" aria-labelledby="sg-porte-t"><form class="sg-carte">' +
    '<h2 id="sg-porte-t">' + (salleLien ? 'Rejoindre le groupe' : 'Convergence') + '</h2>' +
    '<p class="sg-aide">Suivez ce Survol à plusieurs, chacun sur son appareil : des notes communes, un repère à recentrer, le même sablier.</p>' +
    (salleLien ? '' : '<div class="sg-onglets" role="group" aria-label="Créer ou rejoindre"><button type="button" data-o="creer" aria-pressed="true">Créer un groupe</button><button type="button" data-o="rejoindre" aria-pressed="false">Rejoindre</button></div>') +
    '<label class="sg-champ sg-pour-code" hidden><span>Code du groupe</span><input class="sg-code-in" maxlength="7" autocomplete="off" spellcheck="false" placeholder="K7M-QX4"></label>' +
    '<label class="sg-champ"><span>Ton surnom</span><input class="sg-nom" maxlength="24" autocomplete="off" spellcheck="false"></label>' +
    '<div class="sg-champ"><span id="sg-l-raie">Ta raie (ta couleur)</span><div class="sg-raies" role="group" aria-labelledby="sg-l-raie">' +
      Object.keys(RAIES).map(r => '<button type="button" data-r="' + r + '" style="--c:' + RAIES[r][1] + '" aria-pressed="' + (r === raie) + '"><i></i>' + r + ' · ' + RAIES[r][0] + ' nm</button>').join('') + '</div></div>' +
    '<p class="sg-etat" aria-live="polite"></p>' +
    '<div class="sg-pop-b"><button type="submit" class="plein">' + (salleLien ? 'Rejoindre' : 'Créer le groupe') + '</button><button type="button" data-o="seul">Rester seul·e</button></div>' +
    '</form></div>');
  document.body.appendChild(porte);
  const n = $('.sg-nom', porte), c = $('.sg-code-in', porte), dit = t => { $('.sg-etat', porte).textContent = t; };
  n.value = nom0; n.placeholder = place;
  porte.addEventListener('keydown', e => e.stopPropagation());
  porte.addEventListener('click', e => {
    const r = e.target.closest('[data-r]');
    if(r){ raie = r.dataset.r; porte.querySelectorAll('[data-r]').forEach(b => b.setAttribute('aria-pressed', String(b === r))); return; }
    const o = e.target.closest('[data-o]'); if(!o) return;
    if(o.dataset.o === 'seul'){ if(salleLien) adresse(''); fermerPorte(); return; }
    creer = o.dataset.o === 'creer';
    porte.querySelectorAll('.sg-onglets button').forEach(b => b.setAttribute('aria-pressed', String(b === o)));
    $('.sg-pour-code', porte).hidden = creer;
    $('[type="submit"]', porte).textContent = creer ? 'Créer le groupe' : 'Rejoindre';
    (creer ? n : c).focus({preventScroll:true});
  });
  $('form', porte).addEventListener('submit', async e => {
    e.preventDefault();
    const code = c.value.toLowerCase().replace(/[^a-z0-9]/g, ''), salle = salleLien || (creer ? aleatoire(6, ALPHA) : code);
    if(!/^[a-z0-9]{6}$/.test(salle)){ dit('Le code a six signes, par exemple K7M-QX4.'); c.focus({preventScroll:true}); return; }
    const nom = propre(n.value, 24) || place, go = $('[type="submit"]', porte);
    api.ecrire(CLE_RAIE, raie); api.ecrire(CLE_NOM, nom);
    go.disabled = true; dit('Connexion au relais…');
    const ok = await entrer(salle, {nom, raie});
    if(!porte) return;
    if(!ok){ go.disabled = false; dit('Impossible de joindre le relais : vérifie ta connexion internet.'); return; }
    fermerPorte();
    if(!salleLien && creer) ouvrirInvite(barre && $('[data-a="groupe"]', barre));
  });
  n.focus({preventScroll:true});
}
/* la page s'ouvre avec ?cv=<salle>, ou se recharge en plein groupe */
async function arriver(salle){
  let g = null;
  try{ g = JSON.parse(sessionStorage.getItem(CLE_SEANCE()) || 'null'); }catch(e){}
  if(g && typeof g.salle === 'string' && /^[a-z0-9]{6}$/.test(g.salle) && (!salle || g.salle === salle)){
    if(await entrer(g.salle, {nom:g.nom, raie:g.raie, reprise:g})) return;
    toast('Le relais ne répond pas : le groupe n’a pas repris. Tes notes à toi marchent toujours.');
    return;
  }
  if(!salle) return;
  /* depuis l'atelier, sur cet appareil : le surnom, la couleur et le rythme passent par le navigateur, jamais par l'adresse */
  const h = lireObjet(CLE_PASSE);
  if(h && h.room === salle && Date.now() - (+h.t || 0) <= VIE_PASSE && propre(h.nom, 24)){
    if(await entrer(salle, {nom:h.nom, raie:h.raie, rythme:h.rythme, atelier:true})) return;
  }
  ouvrirPorte(salle);
}

/* ---------- les notes du groupe : une liste de lignes par diapo ---------- */
const N = {E:{}, plis:{}, rows:new Map(), ecran:'', attente:new Map(), brouillon:null, aFocus:null, liste:null, plus:null, monte:false};
let tVerrou = 0, tCopie = 0;
const pli = e => N.plis[e] || (N.plis[e] = plierLignes(N.E[e]));
const refE = (e, id) => S.F.ref(S.db, S.base + '/tableau/' + e + (id ? '/' + id : ''));
let refusDit = false;
function refus(err){
  if(refusDit) return; refusDit = true;
  api.dire(err && /permission/i.test(String(err.code || err.message || err)) ? 'Le relais refuse les notes du groupe. Tes notes à toi marchent toujours.' : 'Les notes du groupe ne répondent plus : vérifie ta connexion.');
}
/* une diapo a changé au relais */
function surEcran(s){
  const e = s.key, v = s.val();
  if(!connus.has(e)) return;                // une clé de diapo qui n'est pas de ce diaporama : rien à en faire
  if(v) N.E[e] = v; else delete N.E[e];
  N.plis[e] = plierLignes(N.E[e]);
  /* deux fiches pour une ligne : le premier du groupe efface le perdant, une seule écriture pour tout le groupe */
  const perdus = N.plis[e].perdants;
  if(perdus.length && estPremier()){ const u = {}; perdus.forEach(k => { u[k] = null; }); S.F.update(refE(e), u).catch(() => {}); }
  if(e === N.ecran) peindreLignes();
  api.majPoint();
  garderCopie();
}
/* chaque appareil garde sa dernière copie du groupe ; un groupe vidé n'efface pas la copie */
function garderCopie(tout_de_suite){
  clearTimeout(tCopie);
  const faire = () => {
    const n = {}; let y = false;
    ecrans.forEach((e, i) => { const l = pli(e).lignes.map(x => x.t).filter(x => x.trim()); if(l.length){ n[api.cles[i]] = {i:i + 1, l}; y = true; } });
    if(y) api.ecrire(api.CLE_G, JSON.stringify({t:new Date().toISOString(), salle:S.salle, n}));
  };
  if(tout_de_suite) faire(); else tCopie = setTimeout(faire, 800);
}
/* écrire une ligne : ma fiche (l_<début de mon uid>), en effaçant dans la même écriture toute autre fiche de cette ligne */
function enregistrer(e, x){
  const a = N.E[e] || {}, autres = [];
  let vMax = 0;
  Object.keys(a).forEach(k => { const y = lireLigne(a[k]); if(y && y.l === x.l){ autres.push(k); vMax = Math.max(vMax, y.v); } });
  const ma = x.l + '_' + S.uid.slice(0, 8), rec = {de:S.uid, k:'x', d:JSON.stringify({l:x.l, t:x.t, o:x.o, v:Math.max(maintenant(), vMax + 1), r:S.raie})};
  const a_oter = autres.filter(k => k !== ma);
  if(!a_oter.length){ S.F.set(refE(e, ma), rec).catch(refus); return; }
  const u = {[ma]:rec};
  a_oter.forEach(k => { u[k] = null; });
  S.F.update(refE(e), u).catch(refus);
}
function ecrireLigne(l){
  clearTimeout(N.attente.get(l)); N.attente.delete(l);
  const r = N.rows.get(l); if(!r || !S.actif) return;
  const t = r.ta.value.slice(0, MAX_TEXTE), x = r.x;
  if(!x.brouillon && t === x.t) return;
  if(x.brouillon && !t) return;
  enregistrer(N.ecran, {l, t, o:x.o});
}
function toutEcrire(){ Array.from(N.attente.keys()).forEach(ecrireLigne); }
/* je tape : les autres le voient (au plus une fois par seconde) ; la ligne est à moi tant que je tape */
function frappe(l){
  const e = N.ecran, t = maintenant(), a = S.maLigne, meme = a && a.e === e && a.l === l && t - a.t < VERROU;
  if(meme && t - a.t < 1000) return;
  S.maLigne = {e, l, t, d:meme ? a.d : t};
  if(S.refMoi) S.F.set(S.F.ref(S.db, S.base + '/membres/' + S.uid + '/ligne'), S.maLigne).catch(() => {});
}
function creerRang(l){
  const li = H('<li class="sg-l"><i class="sg-c"></i><textarea class="sg-t" rows="1" spellcheck="true" maxlength="' + MAX_TEXTE + '"></textarea>' +
    '<span class="sg-bts"><button type="button" data-m="-1" aria-label="Monter cette ligne" title="Monter (Alt+↑)">↑</button><button type="button" data-m="1" aria-label="Descendre cette ligne" title="Descendre (Alt+↓)">↓</button></span>' +
    '<small class="sg-dit" hidden></small></li>');
  li.dataset.l = l;
  return {li, ta:$('.sg-t', li), c:$('.sg-c', li), dit:$('.sg-dit', li), bts:Array.from(li.querySelectorAll('.sg-bts button')), x:null};
}
function ajuster(ta){ ta.style.height = 'auto'; if(ta.scrollHeight) ta.style.height = ta.scrollHeight + 'px'; }
function majRang(r, x, k){
  r.x = x;
  const q = x.brouillon ? '' : verrouDe(N.ecran, x.l, Object.keys(S.membres).map(u => ({uid:u, ligne:S.membres[u].ligne})), {uid:S.uid, ligne:S.maLigne}, maintenant());
  if(!N.attente.has(x.l) && !(x.brouillon && r.ta.value) && r.ta.value !== x.t){
    const f = document.activeElement === r.ta, a = r.ta.selectionStart;
    r.ta.value = x.t; ajuster(r.ta);
    if(f) r.ta.setSelectionRange(Math.min(a, x.t.length), Math.min(a, x.t.length));
  }
  r.ta.readOnly = !!q;
  r.ta.setAttribute('aria-label', 'Ligne ' + (k + 1) + (q ? ', « ' + nomU(q) + ' » écrit' : ''));
  r.ta.placeholder = x.brouillon ? 'Écris la première ligne : tout le groupe la voit.' : '';
  r.li.classList.toggle('verrou', !!q);
  r.dit.hidden = !q;
  if(q) r.dit.textContent = '« ' + nomU(q) + ' » écrit…';
  r.bts.forEach(b => { b.disabled = !!q; });
  r.c.style.setProperty('--c', x.brouillon ? 'transparent' : couleur(x.r));
  r.li.title = x.brouillon || !x.de ? '' : 'Dernière modification : « ' + nomU(x.de) + ' »';
}
function monter(){
  if(!N.liste){
    N.liste = H('<ol class="sg-liste" aria-label="Les notes du groupe sur cette diapo"></ol>');
    N.plus = H('<button type="button" class="sg-plus">＋ Une ligne</button>');
    N.liste.addEventListener('input', surSaisie);
    N.liste.addEventListener('keydown', surTouche);
    N.liste.addEventListener('focusout', e => { const li = e.target.closest('.sg-l'); if(li && N.attente.has(li.dataset.l)) ecrireLigne(li.dataset.l); });
    N.liste.addEventListener('click', e => {
      const b = e.target.closest('[data-m]'); if(!b) return;
      deplacer(b.closest('.sg-l').dataset.l, +b.dataset.m);
    });
    /* un doigt sur ↑ ↓ garde le clavier ouvert */
    N.liste.addEventListener('pointerdown', e => { if(e.target.closest('[data-m]')) e.preventDefault(); });
    N.plus.addEventListener('click', () => {
      const L = lignesIci(), d = L[L.length - 1];
      if(!d){ V.focus(); return; }
      ajouterApres(d, '');
    });
    /* le panneau s'ouvre, la largeur change : les lignes reprennent leur hauteur */
    let large = 0;
    if(typeof ResizeObserver !== 'undefined') new ResizeObserver(e => { const w = e[0].contentRect.width; if(w !== large){ large = w; N.rows.forEach(r => ajuster(r.ta)); } }).observe(N.liste);
  }
  if(N.liste.parentNode !== api.lignes){ api.lignes.textContent = ''; api.lignes.append(N.liste, N.plus); }
}
const lignesIci = () => N.ecran ? pli(N.ecran).lignes : [];
function peindreLignes(){
  clearTimeout(tVerrou);
  if(!S.actif || api.source() !== V) return;
  monter();
  const e = ecrans[api.cur()];
  if(N.ecran !== e){
    toutEcrire();
    N.rows.forEach(r => r.li.remove()); N.rows.clear();
    N.ecran = e; N.brouillon = null;
  }
  const L = pli(e).lignes;
  /* une ligne que j'écris encore et que le relais n'a pas (effacée par quelqu'un) reste, et revient à la prochaine écriture */
  const voulu = L.slice(), ids = new Set(L.map(x => x.l));
  N.attente.forEach((t, l) => { const r = N.rows.get(l); if(r && r.x && !ids.has(l)){ voulu.push(r.x); ids.add(l); } });
  /* une diapo sans ligne montre une ligne vide : elle n'existe au relais qu'à la première frappe */
  if(!voulu.length){ if(!N.brouillon) N.brouillon = {l:nouvelId(), t:'', o:cleEntre('', ''), r:S.raie, de:'', brouillon:true}; voulu.push(N.brouillon); ids.add(N.brouillon.l); }
  else if(N.brouillon && !ids.has(N.brouillon.l)) N.brouillon = null;
  const actif = document.activeElement, surUne = actif && actif.classList && actif.classList.contains('sg-t') && N.liste.contains(actif), sel = surUne ? [actif.selectionStart, actif.selectionEnd] : null;
  let place = N.liste.firstChild;
  voulu.forEach((x, k) => {
    let r = N.rows.get(x.l);
    if(!r){ r = creerRang(x.l); N.rows.set(x.l, r); }
    if(r.li === place) place = place.nextSibling; else N.liste.insertBefore(r.li, place);
    majRang(r, x, k);
  });
  let perdu = false;
  N.rows.forEach((r, l) => { if(!ids.has(l)){ if(r.ta === actif) perdu = true; r.li.remove(); N.rows.delete(l); } });
  N.rows.forEach(r => { if(r.ta.style.height === '' || r.ta.style.height === 'auto') ajuster(r.ta); });
  N.plus.hidden = !L.length;
  if(N.aFocus){
    const f = N.aFocus; N.aFocus = null;
    const r = f.l ? N.rows.get(f.l) : N.rows.get(voulu[0].l);
    if(r){ r.ta.focus({preventScroll:true}); const p = f.pos === 'fin' ? r.ta.value.length : f.pos || 0; r.ta.setSelectionRange(p, p); r.li.scrollIntoView({block:'nearest'}); }
  } else if(surUne && document.activeElement !== actif && actif.isConnected){ actif.focus({preventScroll:true}); actif.setSelectionRange(sel[0], sel[1]); }
  else if(perdu) N.rows.get(voulu[0].l).ta.focus({preventScroll:true});
  /* le verrou le plus proche de sa fin : la ligne se rouvre sans attendre une autre nouvelle du relais */
  const t0 = maintenant();
  let reste = 0;
  Object.keys(S.membres).forEach(u => { const x = S.membres[u].ligne; if(x && x.e === e && t0 - x.t < VERROU){ const d = VERROU - (t0 - x.t); reste = reste ? Math.min(reste, d) : d; } });
  if(reste) tVerrou = setTimeout(peindreLignes, reste + 30);
}
function surSaisie(e){
  const ta = e.target.closest('.sg-t'); if(!ta) return;
  const l = ta.closest('.sg-l').dataset.l;
  /* avant tout le reste : la présence (frappe) redessine aussitôt, et une ligne en attente garde ce qu'on y tape */
  clearTimeout(N.attente.get(l)); N.attente.set(l, 0);
  /* un collage de plusieurs lignes : une rangée par ligne */
  if(ta.value.includes('\n')){
    const parts = ta.value.split(/\r?\n/), r = N.rows.get(l);
    ta.value = parts.shift();
    ajuster(ta); frappe(l);
    ecrireLigne(l);
    const k0 = pli(N.ecran).lignes;
    let a = k0.find(x => x.l === l) || r.x;
    const suite = k0[k0.findIndex(x => x.l === l) + 1];
    parts.filter(x => x.trim()).slice(0, MAX_LIGNES).forEach(t => {
      const o = cleEntre(a.o, suite ? suite.o : ''), id = nouvelId();
      enregistrer(N.ecran, {l:id, t:t.slice(0, MAX_TEXTE), o});
      a = {o, l:id};
    });
    N.aFocus = {l:a.l, pos:'fin'};
    peindreLignes();
    return;
  }
  ajuster(ta);
  frappe(l);
  N.attente.set(l, setTimeout(() => ecrireLigne(l), ECRITURE));
}
function ajouterApres(x, texte){
  const L = lignesIci();
  if(L.length >= MAX_LIGNES){ api.dire('Cette diapo a déjà ' + MAX_LIGNES + ' lignes.'); return; }
  const k = L.findIndex(y => y.l === x.l), s = L[k + 1], id = nouvelId();
  enregistrer(N.ecran, {l:id, t:texte, o:cleEntre(x.o, s ? s.o : '')});
  N.aFocus = {l:id, pos:0};
  peindreLignes();
}
/* Entrée coupe la ligne au curseur ; sur une ligne qu'un autre écrit, elle ajoute simplement une ligne dessous */
function aLaLigne(l, ta){
  const r = N.rows.get(l); if(!r) return;
  let reste = '';
  if(!ta.readOnly){
    const a = ta.selectionStart, b = ta.selectionEnd;
    reste = ta.value.slice(b); ta.value = ta.value.slice(0, a); ajuster(ta);
    /* Entrée sur la ligne vide d'une diapo vide : elle naît pour de bon */
    if(r.x.brouillon){ clearTimeout(N.attente.get(l)); N.attente.delete(l); enregistrer(N.ecran, {l, t:ta.value, o:r.x.o}); }
    else ecrireLigne(l);
  }
  ajouterApres(r.x, reste);
}
function oter(l){
  clearTimeout(N.attente.get(l)); N.attente.delete(l);
  const L = lignesIci(), k = L.findIndex(x => x.l === l), a = N.E[N.ecran] || {}, u = {};
  Object.keys(a).forEach(c => { const y = lireLigne(a[c]); if(y && y.l === l) u[c] = null; });
  if(Object.keys(u).length) S.F.update(refE(N.ecran), u).catch(refus);
  const v = L[k - 1] || L[k + 1];
  N.aFocus = v ? {l:v.l, pos:L[k - 1] ? 'fin' : 0} : {pos:0};
  peindreLignes();
}
function deplacer(l, dir){
  const L = lignesIci(), k = L.findIndex(x => x.l === l), j = k + dir, r = N.rows.get(l);
  if(k < 0 || j < 0 || j >= L.length || (r && r.ta.readOnly)) return;
  const sans = L.filter(x => x.l !== l), av = sans[j - 1], ap = sans[j];
  clearTimeout(N.attente.get(l)); N.attente.delete(l);
  enregistrer(N.ecran, {l, t:r ? r.ta.value.slice(0, MAX_TEXTE) : L[k].t, o:cleEntre(av ? av.o : '', ap ? ap.o : '')});
  N.aFocus = {l, pos:r ? r.ta.selectionStart : 0};
  peindreLignes();
}
/* une ligne qui passe à la ligne à l'écran : ↑ ↓ y restent tant qu'il y a où aller */
function peutSortir(ta, dir){
  if(ta.selectionStart !== ta.selectionEnd) return false;
  const h = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  return ta.scrollHeight < h * 1.7 + 6 || (dir < 0 ? ta.selectionStart === 0 : ta.selectionStart === ta.value.length);
}
function surTouche(e){
  const ta = e.target.closest('.sg-t'); if(!ta) return;
  const l = ta.closest('.sg-l').dataset.l;
  if(e.key === 'Enter'){ e.preventDefault(); aLaLigne(l, ta); return; }
  if(e.key === 'Backspace' && !ta.value && !ta.readOnly && !N.rows.get(l).x.brouillon){ e.preventDefault(); oter(l); return; }
  if(e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const dir = e.key === 'ArrowUp' ? -1 : 1;
  if(e.altKey){ e.preventDefault(); deplacer(l, dir); return; }
  if(!peutSortir(ta, dir)) return;
  const L = lignesIci(), v = L[L.findIndex(x => x.l === l) + dir], r = v && N.rows.get(v.l);
  if(r){ e.preventDefault(); r.ta.focus({preventScroll:true}); const p = dir < 0 ? r.ta.value.length : 0; r.ta.setSelectionRange(p, p); r.li.scrollIntoView({block:'nearest'}); }
}
/* la source que le bloc des notes montre quand l'interrupteur est sur « Notes du groupe » */
const V = {
  vivant:true,
  lignes:i => pli(ecrans[i]).lignes.map(x => x.t),
  peindre(){ peindreLignes(); },
  avant(){ toutEcrire(); },
  focus(){ const L = lignesIci(), d = L[L.length - 1], r = N.rows.get(d ? d.l : N.brouillon && N.brouillon.l); if(r){ r.ta.focus({preventScroll:true}); r.ta.setSelectionRange(r.ta.value.length, r.ta.value.length); } },
  memo(on){ S.notes = on; sauver(); }
};

/* ---------- le sablier du groupe : les règles de sablier.js ; le même voile, aux couleurs de qui regarde ---------- */
const w = u => 4 + 40 * Math.pow(Math.sin(Math.min(1, u * 1.1) * Math.PI / 2), 0.7);
const NS_AIRE = 240, AIRE = [0];
for(let k = 1; k <= NS_AIRE; k++){ const u0 = (k - 1) / NS_AIRE, u1 = k / NS_AIRE; AIRE[k] = AIRE[k - 1] + (w(u0) + w(u1)) * 84 / NS_AIRE; }
const aire = u => { const x = Math.max(0, Math.min(1, u)) * NS_AIRE, k = Math.floor(x); return k >= NS_AIRE ? AIRE[NS_AIRE] : AIRE[k] + (AIRE[k + 1] - AIRE[k]) * (x - k); };
const inverse = a => { let lo = 0, hi = 1; for(let i = 0; i < 30; i++){ const m = (lo + hi) / 2; if(aire(m) < a) lo = m; else hi = m; } return (lo + hi) / 2; };
const PLEIN = 0.82, SABLE = aire(PLEIN);
function contour(){
  const pts = [], K = 28;
  for(let i = K; i >= 0; i--){ const u = i / K; pts.push([-w(u), 100 - 84 * u]); }
  for(let i = 1; i <= K; i++){ const u = i / K; pts.push([-w(u), 100 + 84 * u]); }
  for(let i = K; i >= 1; i--){ const u = i / K; pts.push([w(u), 100 + 84 * u]); }
  for(let i = 0; i <= K; i++){ const u = i / K; pts.push([w(u), 100 - 84 * u]); }
  return 'M' + pts.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' L') + ' Z';
}
const CONTOUR = contour();
function dessinerSable(svg, f, coule){
  const yHaut = 100 - 84 * inverse(Math.max(0, f) * SABLE), yBas = 100 + 84 * inverse(Math.max(0, aire(1) - (1 - f) * SABLE));
  const creux = Math.min(7, Math.max(0, 100 - yHaut) * 0.5), tas = f < 1 ? Math.min(9, (184 - yBas) * 0.6 + 2) : 0;
  $('.s-haut', svg).setAttribute('d', f <= 0.001 ? '' : 'M-50 ' + yHaut.toFixed(2) + ' L-7 ' + yHaut.toFixed(2) + ' L0 ' + (yHaut + creux).toFixed(2) + ' L7 ' + yHaut.toFixed(2) + ' L50 ' + yHaut.toFixed(2) + ' L50 101 L-50 101 Z');
  $('.s-bas', svg).setAttribute('d', f >= 0.999 ? '' : 'M-50 185 L-50 ' + yBas.toFixed(2) + ' L-16 ' + yBas.toFixed(2) + ' L0 ' + (yBas - tas).toFixed(2) + ' L16 ' + yBas.toFixed(2) + ' L50 ' + yBas.toFixed(2) + ' L50 185 Z');
  const filet = $('.s-filet', svg);
  if(filet){ filet.setAttribute('y2', (yBas - tas).toFixed(2)); filet.style.display = coule && f > 0.001 ? '' : 'none'; }
}
function verre(petit){
  const id = 'sg' + Math.random().toString(36).slice(2, 7);
  return '<svg viewBox="-60 0 120 200" aria-hidden="true" class="' + (petit ? 'sablier-mini' : 'sablier-svg') + '">' +
    '<defs><clipPath id="' + id + '"><path d="' + CONTOUR + '"/></clipPath>' +
    '<linearGradient id="' + id + 'g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--sg-a)" stop-opacity=".95"/><stop offset="1" stop-color="var(--sg-a)" stop-opacity=".7"/></linearGradient></defs>' +
    (petit ? '' : '<rect class="s-cadre" x="-54" y="2" width="108" height="11" rx="4"/><rect class="s-cadre" x="-54" y="187" width="108" height="11" rx="4"/>' +
      '<rect class="s-montant" x="-53" y="12" width="5" height="176" rx="2"/><rect class="s-montant" x="48" y="12" width="5" height="176" rx="2"/>') +
    '<g clip-path="url(#' + id + ')"><path class="s-haut" fill="url(#' + id + 'g)"/><path class="s-bas" fill="url(#' + id + 'g)"/>' +
    (petit ? '' : '<line class="s-filet" x1="0" y1="99" x2="0" y2="180"/>') + '</g>' +
    '<path class="s-verre" d="' + CONTOUR + '"/></svg>';
}
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const texteR = r => r.t + ' min · pause ' + r.p;
const rythme = () => S.sablier.n && S.sablier.on ? S.sablier : null;
const CONSEILS = [
  'Regarde un objet à six mètres ou plus pendant vingt secondes : au loin, A = 1/d tend vers 0 et ton cristallin se relâche (Optique M6).',
  'Ferme les yeux vingt secondes, puis cligne lentement quelques fois : le clignement répartit le film lacrymal (Anatomie M6).',
  'Lève-toi, étire-toi, bois un verre d’eau. Le sable s’occupe du reste.'
];
let tR = 0, averti = '', seulC = '', voile = null, raf = 0, derniereS = -1, focusAvant = null;
const pa = {fin:0, duree:0};
function majSablier(){
  if(!barre) return;
  const r = rythme(), b = $('.sg-sab', barre), ph = r ? phaseRythme(r, maintenant()) : null, seul = !!ph && ph.pause && seulC === cleCycle(r, ph);
  const f = !ph ? 1 : ph.pause ? 1 - ph.reste / (r.p * 60000) : ph.reste / (r.t * 60000);
  const dit = !ph ? 'Sablier du groupe : un rythme pour tout le monde' : seul ? 'Tu continues seul·e : le groupe reprend dans ' + mmss(ph.reste)
    : ph.pause ? 'Pause : encore ' + mmss(ph.reste) : 'Sablier du groupe (' + texteR(r) + ') : pause dans ' + mmss(ph.reste);
  $('.sg-sab-t', b).textContent = !ph ? 'Sablier' : mmss(ph.reste);
  b.title = dit; b.setAttribute('aria-label', dit);
  b.classList.toggle('proche', !!ph && !ph.pause && ph.reste <= AVANT);
  b.classList.toggle('eteint', !ph);
  dessinerSable($('svg', b), f, false);
}
/* tempo se cale sur la seconde de la phase : les pages basculent ensemble */
function tempo(){
  clearTimeout(tR); tR = 0;
  if(!S.actif) return;
  const r = rythme();
  if(!r){ if(voile) finir(false); majSablier(); return; }
  const ph = phaseRythme(r, maintenant()), cle = cleCycle(r, ph);
  if(ph.pause && seulC !== cle){
    pa.fin = Date.now() + ph.reste; pa.duree = r.p * 60000;
    if(voile) peindreVoile(); else montrerVoile(r);
  } else if(voile) finir(false);
  if(!voile && !ph.pause && ph.reste <= AVANT && ph.reste > 2000 && r.t * 60000 > AVANT && averti !== cle){
    averti = cle; toast('Pause du groupe dans ' + Math.ceil(ph.reste / 1000) + ' secondes.');
  }
  majSablier();
  tR = setTimeout(tempo, (ph.reste % 1000 || 1000) + 15);
}
function montrerVoile(r){
  if(voile) return;
  fermerPop();
  const l = CONSEILS.concat(r.p + ' minutes pour bouger, rire, boire de l’eau. Le groupe reprend à la même seconde.');
  voile = H('<div class="sablier-voile" role="dialog" aria-modal="true" aria-labelledby="sablier-titre"><div class="sablier-carte"><p class="lib">Pause du groupe · ' + r.p + ' min</p>' +
    '<div class="sablier-tourne">' + verre(false) + '</div><p class="sablier-compte" aria-hidden="true"></p><p class="sg-sr" aria-live="polite" id="sablier-annonce"></p>' +
    '<h2 id="sablier-titre">Le sable coule : laisse reposer.</h2><p class="sablier-conseil">' + esc(l[Math.floor(Math.random() * l.length)]) + '</p>' +
    '<div class="sg-pop-b"><button type="button" data-s="seul" title="Pour toi seul·e, et pour cette pause : le groupe reste en pause et le prochain tour repart ensemble">Continuer seul·e</button>' +
    '<button type="button" data-s="reglages" title="Changer ou arrêter le rythme pour tout le monde : le groupe verra ton nom">Changer le rythme</button></div></div></div>');
  document.body.appendChild(voile);
  voile.classList.toggle('coule', !reduit());
  voile.addEventListener('click', e => {
    const b = e.target.closest('[data-s]'); if(!b) return;
    if(b.dataset.s === 'seul') continuerSeul(); else ouvrirSablier(b);
  });
  setTimeout(() => { if(voile){ focusAvant = document.activeElement; $('button', voile).focus({preventScroll:true}); } }, 30);
  derniereS = -1;
  animer();
}
function peindreVoile(){
  const reste = pa.fin - Date.now(), f = Math.max(0, Math.min(1, reste / (pa.duree || 1)));
  dessinerSable($('svg', voile), f, !reduit());
  const s = Math.ceil(Math.max(0, reste) / 1000);
  if(s !== derniereS){
    derniereS = s;
    $('.sablier-compte', voile).textContent = mmss(reste);
    if(s % 60 === 0 && s > 0) $('#sablier-annonce', voile).textContent = 'Encore ' + (s / 60) + ' minute' + (s > 60 ? 's' : '') + ' de pause.';
  }
}
function animer(){
  raf = 0;
  if(!voile) return;
  peindreVoile();
  raf = reduit() ? setTimeout(animer, 250) : requestAnimationFrame(animer);
}
function rendreFocus(v){
  const f = focusAvant, a = document.activeElement; focusAvant = null;
  if(f && f.isConnected && f !== document.body && (!a || a === document.body || v.contains(a))) f.focus({preventScroll:true});
}
function finir(passee){
  if(!voile) return;
  cancelAnimationFrame(raf); clearTimeout(raf); raf = 0;
  const v = voile; voile = null;
  $('#sablier-annonce', v).textContent = passee ? 'Pause écourtée.' : 'Pause finie : on reprend.';
  rendreFocus(v);
  if(reduit()){ v.remove(); return; }
  v.classList.add('fini');
  setTimeout(() => v.classList.add('part'), 650);
  setTimeout(() => v.remove(), 1150);
}
/* en sortant du groupe : sans cérémonie */
function couper(){
  if(!voile) return;
  cancelAnimationFrame(raf); clearTimeout(raf); raf = 0;
  const v = voile; voile = null;
  v.remove();
}
/* la pause ne se finit pour personne d'autre : cet appareil seulement, ce tour seulement */
function continuerSeul(){
  const r = rythme(); if(!r) return;
  const ph = phaseRythme(r, maintenant());
  seulC = cleCycle(r, ph);
  finir(true); tempo();
  toast('Tu continues seul·e. Le groupe reprend dans ' + mmss(ph.reste) + ', et toi avec lui.');
}
function adopterSablier(r){
  S.sablier = r;
  publier(); sauver(); tempo();
  if(popSorte === 'sablier') remplirSablier();
}
function accorderSablier(u, x, silence){
  const r = lireRythme(x); if(!r) return;
  if(!r.par) r.par = u;
  if(!rythmeGagne(r, Object.assign({}, S.sablier, {par:S.sablier.par || S.uid}), cleRang())) return;
  const avant = S.sablier;
  adopterSablier(r);
  versAtelier();
  if(silence) return;
  const qui = '« ' + nomU(r.par) + ' »';
  toast(!r.on ? qui + ' a arrêté le sablier pour tout le monde.' : qui + (avant.on ? ' a changé le sablier : ' : ' a lancé le sablier : ') + texteR(r) + '.');
}
function changerSablier(c){
  if(!S.actif) return;
  const a = S.sablier, x = rythmeChange(a, c, maintenant(), S.uid);
  adopterSablier(x.r);
  versAtelier();
  toast(!c.on ? 'Sablier arrêté pour tout le monde.' : (a.on ? 'Sablier changé pour tout le monde : ' : 'Sablier lancé pour tout le monde : ') + texteR(x.r) + (x.apres ? ', après cette pause.' : '.'));
}
function ouvrirSablier(a){
  if(!ouvrirPop('sablier', a, 'Sablier du groupe')) return;
  remplirSablier(); placerPop();
  pop.addEventListener('click', e => {
    const r = e.target.closest('[data-r]');
    if(r){ const [t, p] = r.dataset.r.split('-').map(Number); if(!(S.sablier.on && S.sablier.t === t && S.sablier.p === p)) changerSablier({on:true, t, p}); fermerPop(); return; }
    const b = e.target.closest('[data-c]'); if(!b) return;
    if(b.dataset.c === 'arret') changerSablier({on:false});
    fermerPop();
  });
  const f = $('[aria-pressed="true"]', pop) || $('[data-r]', pop); if(f) f.focus({preventScroll:true});
}
function remplirSablier(){
  const g = rythme();
  pop.innerHTML = '<p class="sg-pop-t">Sablier du groupe</p><p class="sg-aide">Un rythme pour tout le groupe : la pause tombe à la même seconde pour tout le monde. Personne ne peut finir la pause des autres.</p>' +
    (g ? '<p class="sg-aide"><b>' + esc(texteR(g)) + '</b>, lancé par « ' + esc(nomU(g.par)) + ' ».</p>' : '') +
    '<div class="sg-puces" role="group" aria-label="Le rythme du groupe : travail, puis pause">' + REGLAGES.map(([t, p]) => '<button type="button" data-r="' + t + '-' + p + '" aria-pressed="' + !!(g && g.t === t && g.p === p) + '">' + t + ' min · pause ' + p + '</button>').join('') + '</div>' +
    '<div class="sg-pop-b">' + (g ? '<button type="button" data-c="arret">Arrêter pour tout le monde</button>' : '') + '<button type="button" data-c="ok">OK</button></div>';
}
/* en groupe, un lien du diaporama ne remplace jamais la page, sinon il ferait quitter le groupe. « ← Atelier » ferme l'onglet quand
   l'atelier attend derrière, toujours en séance ; un onglet que le navigateur refuse de fermer, ou arrivé par un code, ouvre un nouvel onglet. */
function surLien(ev){
  if(!S.actif || ev.defaultPrevented || ev.button || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
  const a = ev.target.closest && ev.target.closest('a[href]');
  if(!a || a.closest('#ns-panneau, .sg-barre') || a.target === '_blank' || a.getAttribute('href').charAt(0) === '#') return;
  ev.preventDefault();
  const u = a.href, ailleurs = () => window.open(u, '_blank', 'noopener');
  if(S.atelier && a.classList.contains('vers-banc')){ try{ window.close(); }catch(e){} setTimeout(ailleurs, 200); }
  else ailleurs();
}
/* l'onglet de l'atelier et celui du Survol, sur un même appareil, gardent le même rythme : une clé du navigateur, sens par sens */
function versAtelier(){
  if(S.sablier.n) api.ecrire(CLE_RYTHME, JSON.stringify({de:'survol', f:api.fichier, s:S.salle, r:S.sablier, t:Date.now()}));
}
function surStockage(e){
  if(e.key !== CLE_RYTHME || !e.newValue || !S.actif) return;
  let x = null; try{ x = JSON.parse(e.newValue); }catch(err){ return; }
  if(!x || x.de !== 'atelier' || salleSurvol(x.code, api.fichier) !== S.salle) return;
  const r = lireRythme(x.r), a = S.sablier;
  if(!r || (r.on === a.on && r.t === a.t && r.p === a.p && r.d === a.d)) return;
  adopterSablier(Object.assign(r, {n:Math.max(a.n + 1, r.n), par:S.uid}));
  toast(r.on ? 'Le sablier de la séance change ici aussi : ' + texteR(r) + '.' : 'Le sablier de la séance s’arrête ici aussi.');
}

/* ---------- le style : les jetons de chaque diaporama ; aucune couleur de son code (recette §3.5, règle 5) : l'encre, et la raie de chacun ---------- */
const CSS = `
.sg-barre{container-type:inline-size;flex:none;margin:0 0 6px}
/* la barre prend un peu de hauteur : une diapo pile à la limite défile, et sa barre de défilement redessinerait les schémas plus étroits
   (audit, 3 nov. : deux étiquettes se touchaient). Sans elle, les schémas gardent la largeur qu'ils ont seul·e ; la diapo défile toujours. */
body.sg-groupe .diapo{scrollbar-width:none}
body.sg-groupe .diapo::-webkit-scrollbar{display:none}
.sg-rang{display:flex;align-items:center;gap:6px;min-height:38px;overflow:hidden;padding:4px 6px;border:1px solid var(--trait);border-radius:10px;background:var(--fond-2);color:var(--encre);font:400 var(--t-xs)/1.2 var(--f-texte)}
.sg-rang button{flex:none;min-height:29px;padding:0 9px;border-radius:7px;border:1px solid var(--trait);background:var(--fond);color:var(--encre);font:inherit;font-weight:700;white-space:nowrap;cursor:pointer}
.sg-rang button:disabled{opacity:.45;cursor:default}
.sg-rang button[aria-pressed="true"]{background:var(--encre);color:var(--fond);border-color:var(--encre)}
.sg-rang button:focus-visible,.sg-pop button:focus-visible,.sg-carte button:focus-visible,.sg-carte input:focus-visible,.sg-avis button:focus-visible,.sablier-voile button:focus-visible{outline:3px solid var(--encre);outline-offset:2px}
.sg-rang .sg-qui{display:inline-flex;align-items:center;gap:6px;padding:0 7px;flex:none}
.sg-pts{display:inline-flex}
.sg-pt{display:inline-block;flex:none;min-width:20px;height:20px;padding:0 3px;box-sizing:border-box;border-radius:10px;background:var(--c);color:#05070D;font:700 11px/20px var(--f-chiffre);font-style:normal;text-align:center;box-shadow:0 0 0 2px var(--fond)}
.sg-pts .sg-pt + .sg-pt{margin-left:-3px}
.sg-pts .sg-pt:nth-child(n+6){display:none}
.sg-rep{white-space:nowrap;color:var(--doux)}
.sg-rep b{color:var(--encre)}
.sg-espace{flex:1;min-width:0}
.sg-rang .sg-sab{display:inline-flex;align-items:center;gap:5px;padding:0 8px;flex:none}
.sg-sab-t{font-variant-numeric:tabular-nums}
.sg-sab.proche{border-color:var(--encre);box-shadow:0 0 0 2px var(--trait)}
.sablier-mini{width:11px;height:18px;flex:none}
.sablier-mini .s-verre{fill:none;stroke:currentColor;stroke-width:9;opacity:.75}
.sg-court{display:none}
@container (max-width:720px){
  .sg-rang{gap:4px;padding:3px 4px}
  .sg-rang button{padding:0 7px}
  .sg-large,.sg-rep{display:none}
  .sg-court{display:inline}
  .sg-pts .sg-pt:nth-child(n+4){display:none}
}
@container (max-width:400px){
  .sg-pts .sg-pt:nth-child(n+3){display:none}
  .sg-rang .sg-sab{padding:0 7px}
  .sg-sab.eteint .sg-sab-t,.sg-sab:not(.eteint) svg{display:none}
}
@container (max-width:300px){ .sg-rang .sg-nb{display:none} .sg-rang button{padding:0 5px} }
@media (min-width:900px) and (max-width:1199px){ body.ns-ouvert .sg-barre{margin-right:326px} }
.sg-avis{position:fixed;z-index:350;left:50%;top:calc(12px + env(safe-area-inset-top,0px));transform:translateX(-50%);display:flex;align-items:center;gap:10px;width:max-content;max-width:min(560px,calc(100vw - 24px));box-sizing:border-box;
  background:var(--fond-2);color:var(--encre);border:1px solid var(--trait);border-left:3px solid var(--encre);border-radius:12px;padding:9px 12px;box-shadow:0 14px 36px rgba(0,0,0,.3);font:400 var(--t-s)/1.35 var(--f-texte)}
.sg-avis button{flex:none;min-height:30px;padding:0 11px;border-radius:8px;border:1px solid var(--trait);background:var(--fond);color:var(--encre);font:inherit;font-weight:700;cursor:pointer}
.sg-pop{position:fixed;z-index:348;box-sizing:border-box;max-height:calc(100vh - 24px);overflow:auto;display:flex;flex-direction:column;gap:8px;padding:12px 14px;background:var(--fond-2);color:var(--encre);border:1px solid var(--trait);border-top:3px solid var(--encre);border-radius:12px;box-shadow:0 14px 36px rgba(0,0,0,.3);font:400 var(--t-s)/1.4 var(--f-texte)}
.sg-pop-t{margin:0;font-size:var(--t-xs);font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--doux)}
.sg-aide{margin:0;font-size:var(--t-xs);color:var(--doux);line-height:1.45}
.sg-aide b{color:var(--encre)}
.sg-gens{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;max-height:40vh;overflow:auto}
.sg-gens li{display:flex;align-items:center;gap:8px;min-width:0}
.sg-gens span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sg-gens small{flex:none;font-size:var(--t-xs);color:var(--doux)}
.sg-pop-b{display:flex;flex-wrap:wrap;gap:6px}
.sg-pop-b button,.sg-puces button,.sg-onglets button{min-height:36px;padding:0 12px;border-radius:9px;border:1px solid var(--trait);background:var(--fond);color:var(--encre);font:inherit;font-size:var(--t-s);font-weight:700;cursor:pointer}
.sg-pop-b .plein{background:var(--encre);color:var(--fond);border-color:var(--encre)}
.sg-pop-b button:disabled{opacity:.5;cursor:default}
.sg-puces{display:flex;flex-direction:column;gap:6px}
.sg-puces button{text-align:left}
.sg-puces button[aria-pressed="true"],.sg-onglets button[aria-pressed="true"]{box-shadow:inset 0 0 0 2px var(--encre)}
.sg-code{margin:0;text-align:center;font:700 clamp(26px,8vw,34px)/1.1 var(--f-chiffre);letter-spacing:.12em}
.sg-qr{align-self:center;width:min(170px,48vw);font-size:var(--t-xs);color:var(--doux);text-align:center}
.sg-qr svg{display:block;width:100%;height:auto;border-radius:6px}
.sg-porte{position:fixed;inset:0;z-index:320;display:grid;place-items:center;padding:16px;overflow:auto;background:var(--voile,rgba(5,10,20,.74))}
.sg-carte{width:min(440px,100%);box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:18px;border-radius:16px;border:1px solid var(--trait);background:var(--fond-2);color:var(--encre);font:400 var(--t-s)/1.4 var(--f-texte)}
.sg-carte h2{margin:0;font:700 var(--t-l)/1.2 var(--f-titre)}
.sg-onglets{display:flex;gap:6px}
.sg-champ{display:flex;flex-direction:column;gap:4px;font-size:var(--t-xs);color:var(--doux)}
.sg-champ input{min-height:40px;box-sizing:border-box;padding:0 10px;border-radius:9px;border:1px solid var(--trait);background:var(--fond);color:var(--encre);font:inherit;font-size:16px}
.sg-raies{display:flex;flex-wrap:wrap;gap:6px}
.sg-raies button{display:inline-flex;align-items:center;gap:7px;min-height:32px;padding:0 10px 0 8px;border-radius:999px;border:1px solid var(--trait);background:var(--fond);color:var(--doux);font:inherit;cursor:pointer}
.sg-raies button i{width:4px;height:16px;border-radius:2px;background:var(--c)}
.sg-raies button[aria-pressed="true"]{border-color:var(--c);color:var(--encre);box-shadow:inset 0 0 0 1px var(--c)}
.sg-etat{margin:0;min-height:1.3em;font-size:var(--t-xs);color:var(--doux)}
.sg-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.sg-liste{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.sg-l{display:grid;grid-template-columns:4px minmax(0,1fr) auto;gap:2px 7px;align-items:start;padding:5px 6px;border:1px solid var(--trait);border-radius:9px;background:var(--fond)}
.sg-l:focus-within{border-color:var(--encre)}
.sg-l.verrou{background:var(--fond-2)}
.sg-c{width:4px;align-self:stretch;border-radius:2px;background:var(--c)}
.sg-t{display:block;width:100%;box-sizing:border-box;margin:0;padding:1px 0;resize:none;overflow:hidden;border:0;background:none;color:var(--encre);font:inherit;font-size:var(--t-s);line-height:1.4;outline:0}
.sg-dit{grid-column:2 / -1;font-size:var(--t-xs);color:var(--doux)}
.sg-bts{display:none;gap:2px}
.sg-l:hover .sg-bts,.sg-l:focus-within .sg-bts{display:inline-flex}
.ns-panneau .sg-bts button{min-height:24px;min-width:24px;padding:0;border-radius:6px;font-size:var(--t-xs)}
.ns-panneau .sg-plus{align-self:flex-start;flex:none;min-height:30px;padding:0 10px;font-size:var(--t-xs)}
@media (pointer:coarse){ .ns-panneau .sg-bts button{min-height:30px;min-width:30px} }
.sablier-voile{position:fixed;inset:0;z-index:300;display:grid;place-items:center;padding:20px;overflow:auto;color:var(--encre);font:400 var(--t-s)/1.45 var(--f-texte);
  background:color-mix(in srgb,var(--fond) 50%,transparent);-webkit-backdrop-filter:blur(12px) saturate(.85);backdrop-filter:blur(12px) saturate(.85);animation:sablier-entre .5s ease both}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){ .sablier-voile{background:color-mix(in srgb,var(--fond) 93%,transparent)} }
@keyframes sablier-entre{from{opacity:0}to{opacity:1}}
.sablier-voile.part{opacity:0;transition:opacity .5s ease}
.sablier-carte{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;max-width:440px}
.sablier-carte .lib{margin:0;font-size:var(--t-xs);font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--doux)}
.sablier-carte .sg-pop-b{justify-content:center}
.sablier-tourne{transition:transform .6s cubic-bezier(.6,.05,.3,1)}
.sablier-voile.fini .sablier-tourne{transform:rotate(180deg)}
.sablier-svg{display:block;width:min(150px,34vw);height:auto;margin:6px 0;filter:drop-shadow(0 0 24px color-mix(in srgb,var(--sg-a) 45%,transparent))}
.sablier-svg .s-verre{fill:color-mix(in srgb,var(--encre) 4%,transparent);stroke:color-mix(in srgb,var(--encre) 55%,transparent);stroke-width:2}
.sablier-svg .s-cadre{fill:color-mix(in srgb,var(--sg-a) 60%,var(--encre))}
.sablier-svg .s-montant{fill:color-mix(in srgb,var(--sg-a) 35%,var(--encre))}
.sablier-svg .s-filet{stroke:var(--sg-a);stroke-width:2.4;stroke-dasharray:3 4;stroke-linecap:round}
.sablier-voile.coule .s-filet{animation:sablier-filet .35s linear infinite}
@keyframes sablier-filet{to{stroke-dashoffset:-7}}
.sablier-compte{margin:4px 0 0;font:600 clamp(40px,9vw,64px)/1 var(--f-chiffre);font-variant-numeric:tabular-nums;letter-spacing:.02em}
.sablier-carte h2{font:600 24px/1.25 var(--f-titre);margin:10px 0 0}
.sablier-conseil{color:var(--doux);max-width:42ch;margin:4px 0 8px;line-height:1.5}
@media (prefers-reduced-motion:reduce){ .sablier-voile{animation:none} .sablier-tourne{transition:none} }
@media print{ .sg-barre,.sg-avis,.sg-pop{display:none !important} }
`;

/* ---------- le bloc des notes branche le groupe ---------- */
function brancher(a){
  if(api) return PUBLIC;
  api = a;
  ecrans = api.cles.map(cleDiapo);
  connus = new Set(ecrans);
  const st = document.createElement('style'); st.id = 'survol-groupe-css'; st.textContent = CSS;
  document.head.appendChild(st);
  api.surDiapo(() => { if(S.actif){ publier(); majBarre(); majPop(); } });
  /* pendant la pause, le clavier ne fait pas tourner les diapos derrière le voile ; le réglage du sablier et les avis restent par-dessus */
  document.addEventListener('keydown', e => {
    if(!voile) return;
    const t = e.target && e.target.closest ? e.target : null;
    if(t && t.closest('.sg-pop, .sg-avis')) return;
    if(e.key === 'Tab' || ((e.key === 'Enter' || e.key === ' ') && t && t.closest('.sablier-voile'))) return;
    e.stopPropagation(); if(e.key !== 'Escape') e.preventDefault();
  }, true);
  document.addEventListener('pointerdown', e => { if(pop && !pop.contains(e.target) && !e.target.closest('.sg-rang [aria-haspopup], [data-s="reglages"]')) fermerPop(); });
  document.addEventListener('keydown', e => { if(e.key === 'Escape') fermerPop(); });
  window.addEventListener('resize', placerPop);
  window.addEventListener('storage', surStockage);
  document.addEventListener('click', surLien);
  document.addEventListener('visibilitychange', () => { if(!document.hidden && S.actif) tempo(); });
  window.addEventListener('pagehide', () => { if(S.actif){ toutEcrire(); garderCopie(true); sauver(); } });
  return PUBLIC;
}
function ouvrir(){
  if(S.actif) ouvrirGroupe(barre && $('[data-a="groupe"]', barre)); else ouvrirPorte('');
}
const PUBLIC = {brancher, ouvrir, arriver};
if(typeof window !== 'undefined') window.SurvolGroupe = PUBLIC;
return Object.assign({PUR}, PUBLIC);
})();
if(typeof module === 'object' && module.exports) module.exports = SurvolGroupe.PUR;
