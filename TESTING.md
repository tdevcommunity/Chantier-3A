# Procédure de test

> **Pass Nexus Night : paiement Mobile Money manuel.** Les agrégateurs ne sont plus utilisés par le front. Parcours à tester : pass payant → formulaire → étape paiement (choisir un opérateur, noter le montant avec frais, saisir numéro émetteur + référence) → message « en attente de validation », **aucun e-mail** → dashboard admin, Commandes, filtre « À vérifier » → **Valider** (billets + e-mail envoyés) ou **Rejeter** avec motif (stock libéré, e-mail au client). Tests automatiques : `backend/tests/test_manual_momo.py`. Les sections FedaPay ci-dessous ne concernent que le backend dormant.

Ce document décrit comment vérifier la billetterie : tests automatiques, puis parcours manuel de bout en bout avec la sandbox FedaPay. Les commandes sont à lancer depuis la racine du dépôt.

## 1. Tests automatiques (backend)

```bash
cd backend
pip install -e ".[dev]"
python -m pytest tests -q
```

- Chaque test tourne sur une base SQLite jetable : ni PostgreSQL ni clé FedaPay ne sont nécessaires, et les variables `CHANTIER3A_*` de `backend/.env` sont ignorées.
- Pour tester sur PostgreSQL : définir `TEST_DATABASE_URL` vers une base dont le nom finit par `_test`. La suite vide toutes les tables, toute autre base est refusée.
- Le décodage du QR (`tests/test_ticket_image.py`) utilise `zxing-cpp`, installé avec `.[dev]`. Sans lui, ces tests sont ignorés.
- Résultat attendu : tout passe, sauf `test_ticket_tdev_and_capability_window` qui échoue déjà avant l'intégration FedaPay (attente sur `nbf`).

Vérification du front :

```bash
cd frontend-web
npx tsc --noEmit
```

## 2. Préparer le parcours manuel

### 2.1 Clés FedaPay (sandbox)

Dans le tableau de bord FedaPay, mode **Test** → *Développeurs → Clés API*.

| Fichier (ignoré par git) | Variables |
|--------------------------|-----------|
| `backend/.env` | `CHANTIER3A_PAYMENT_PROVIDERS=manual,fedapay`, `CHANTIER3A_FEDAPAY_SECRET_KEY=sk_sandbox_…`, `CHANTIER3A_FEDAPAY_ENV=sandbox` |
| `frontend-web/.env` | `VITE_FEDAPAY_PUBLIC_KEY=pk_sandbox_…`, `VITE_FEDAPAY_ENV=sandbox` |

La clé secrète ne va **jamais** dans `frontend-web/`. Ne committez aucun `.env`.

### 2.2 Données de l'événement

Le front affiche l'événement publié. Pour un paiement FedaPay, la devise doit être **XOF** (les autres devises sont refusées). Il faut :

1. `CHANTIER3A_PUBLIC_SIGNUP=1` dans `backend/.env` pour pouvoir créer un compte, puis créer un compte et se connecter (`/api/auth/signup`, `/api/auth/login`).
2. Créer une organisation, puis un événement en XOF, ajouter les types de billet (pass étudiant gratuit, standard, VIP) et **publier** l'événement. Corps des requêtes : [backend/docs/API-FRONTEND.md](backend/docs/API-FRONTEND.md).

### 2.3 Lancer

Terminal 1 :

```bash
cd backend
billetterie-api migrate
billetterie-api serve
```

Terminal 2 :

```bash
cd frontend-web
npm install
npm run dev
```

Ouvrir `http://localhost:5173`. Dans `frontend-web/.env`, laissez `VITE_API_URL` **commenté** et gardez `VITE_DEV_API_PROXY` (adresse du backend) : sinon le navigateur appelle l'API en cross-origin et le CORS peut bloquer.

## 3. Scénarios manuels

Numéros de test de la sandbox : `64000001` ou `66000001` = paiement accepté, `64000000` = paiement refusé. Opérateur : « Momo Test ».

| # | Scénario | Actions | Résultat attendu |
|---|----------|---------|------------------|
| 1 | Pass gratuit | Wizard 8 etapes (Pass Festival), « Valider l'inscription » | Message « Inscription réussie ». Commande `paid`, un billet émis. Aucun widget FedaPay. E-mail seulement si SMTP configure. |
| 2 | Pass payant, succès | « Choisir ce pass », formulaire, « Continuer vers le paiement ». Le formulaire se ferme, le widget s'ouvre. Numéro `64000001`, « PAYER ». | Le montant du widget est celui du serveur (prix + frais FedaPay). Message « Paiement confirmé ». Commande `paid`, billet émis. |
| 3 | Paiement refusé | Même parcours avec `64000000` | Le widget affiche « Transaction échouée. Veuillez reessayer » et reste ouvert. Après fermeture : message « Commande enregistrée… ». **Aucun billet.** |
| 4 | Fermeture du widget | Ouvrir le widget, cliquer « Annuler le paiement » ou la croix | Widget fermé, message « Commande enregistrée… », aucun billet. `POST /api/payments/verify` répond 402. |
| 5 | Panne fournisseur | Mettre une fausse clé secrète, redémarrer le backend, tenter un paiement | Erreur affichée, commande annulée, **stock rendu** (`quantity_sold` inchangé). |
| 6 | Le montant ne vient pas du navigateur | Dans les outils de développement, modifier le corps de `POST /api/orders` | Le serveur recalcule le total ; le widget affiche toujours le prix du catalogue. |

Après les scénarios 2 à 4, contrôler côté FedaPay (tableau de bord → *Transactions*) : approuvée pour le 2, refusée pour le 3, en attente pour le 4.

### E-mail et billet

À faire si le SMTP est configuré (`CHANTIER3A_SMTP_HOST`, `CHANTIER3A_SMTP_FROM`, etc.). Sans SMTP, le backend écrit « SMTP not configured; skipping » et n'envoie rien (inscription et billet en base restent OK). Controle prod : `curl -sS https://<api>/api/public/site-config` → `"email_configured": true`. Pour tester sans vrai serveur, lancer un serveur SMTP local de débogage et le pointer avec ces variables.

1. Après le scénario 1 ou 2, l'e-mail contient le PDF `billet-<serie>.pdf` et le bouton « Télécharger mon billet ».
2. Le lien du bouton (`{CHANTIER3A_BASE_URL}/api/orders/<id>/guest/ticket.pdf?email=…`) doit télécharger le PDF. `CHANTIER3A_BASE_URL` doit donc être une URL où `/api/...` répond.
3. Scanner le QR du PDF avec un téléphone : le contenu doit être la capability du billet (jeton signé). Faire aussi un essai sur papier imprimé.
4. Aperçu sans envoi : `cd backend && python -m notify.preview_ticket_email` écrit l'e-mail et un billet d'exemple dans `backend/notify/previews/`.

## 4. Webhook FedaPay

Le paiement fonctionne **sans** webhook : après le widget, le front appelle `POST /api/payments/verify` et le backend confirme auprès de FedaPay. Le webhook sert de filet quand l'acheteur ferme l'onglet après avoir payé. À configurer pour la production ; pour tester :

1. Ouvrir un tunnel HTTPS vers le backend : `ngrok http 8000` ou `cloudflared tunnel --url http://localhost:8000`.
2. Dans FedaPay → *Webhooks* → créer : URL `https://<tunnel>/api/payments/webhook/fedapay`, événement `transaction.approved`, vérification SSL **active**, option « désactiver en cas d'erreurs » **décochée**, aucun en-tête.
3. Copier le secret `wh_sandbox_…` dans `backend/.env` (`CHANTIER3A_FEDAPAY_WEBHOOK_SECRET`) et redémarrer le backend.
4. Faire un paiement puis **fermer l'onglet avant la fin du polling** : la commande doit passer `paid` quand même. Le tableau de bord FedaPay montre la livraison avec une réponse 200.

Comportements attendus : sans secret configuré ou avec une signature invalide, la réponse est 400 ; un rejeu du même événement répond 200 sans doubler le billet.

## 5. Ce qui n'est pas couvert

- Livraison SMTP réelle et lecture du QR par le scanner de l'entrée : à valider avant l'événement.
- Mode production (`CHANTIER3A_FEDAPAY_ENV=live`, clés `pk_live_`/`sk_live_`) : non testé.
- Une commande abandonnée (widget fermé, refus) garde son stock réservé : il n'existe pas d'expiration des commandes en attente.
- Le webhook n'a été validé qu'avec des tests automatiques (signature, rejeu, événements ignorés), pas avec une vraie livraison FedaPay.
