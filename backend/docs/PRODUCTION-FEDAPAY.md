# Mise en production du paiement FedaPay

Guide de passage de la sandbox à la production pour le provider `fedapay` (Checkout.js, devise XOF). Le contrat technique est dans [`API-FRONTEND.md`](API-FRONTEND.md), la procédure de test dans [`../../TESTING.md`](../../TESTING.md).

Rien de ce qui suit n'a été exécuté en production : le provider n'a été validé qu'avec la sandbox FedaPay et des tests automatiques. Faites le parcours de test complet en `live` avec un petit montant avant d'ouvrir la vente.

## 1. Architecture attendue

```
navigateur ──► https://festival.example.com        (site : fichiers statiques du front)
                        │
                        └─ /api/*  ──► reverse proxy ──► billetterie-api (backend)
FedaPay ──► https://festival.example.com/api/payments/webhook/fedapay
```

Le site et l'API doivent partager **la même origine publique**, avec `/api` routé vers le backend (Nginx, Caddy, plateforme d'hébergement…). C'est nécessaire parce que `CHANTIER3A_BASE_URL` sert à la fois :

- d'origine CORS (une seule est autorisée) ;
- d'URL de retour transmise à FedaPay ;
- de base du lien « Télécharger mon billet » (`{BASE_URL}/api/orders/<id>/guest/ticket.pdf`) dans l'e-mail.

Si le front et l'API sont sur deux domaines différents, le lien de l'e-mail et le CORS ne peuvent pas être corrects en même temps avec la configuration actuelle.

HTTPS est obligatoire (FedaPay n'appelle pas un webhook en clair, et le widget est chargé depuis une page sécurisée).

## 2. Côté FedaPay

1. Compte FedaPay activé pour recevoir des paiements réels (vérifications demandées par FedaPay : à faire dans leur tableau de bord).
2. Passer le tableau de bord en mode **Live**, récupérer `pk_live_…` et `sk_live_…` (*Développeurs → Clés API*).
3. Créer un **webhook Live** (il est distinct du webhook sandbox, et son secret aussi) :
   - URL : `https://<votre-domaine>/api/payments/webhook/fedapay`
   - événement : `transaction.approved`
   - vérification SSL **active**, aucun en-tête personnalisé
   - « désactiver en cas d'erreurs » : à cocher seulement une fois le secret configuré et testé (sinon les réponses 400 initiales désactivent le webhook)
4. Copier le secret du webhook (`wh_live_…`).
5. Vérifier dans les paramètres FedaPay qui supporte les frais de transaction. En sandbox, le widget a ajouté 208 F sur un pass à 5 000 F (total payé 5 208 F) ; ce supplément est calculé par FedaPay et n'apparaît pas dans le total de la commande côté billetterie. Confirmez le comportement en production avant de communiquer les prix.

## 3. Configuration

Backend (`backend/.env` ou variables d'environnement de l'hébergeur) :

```env
CHANTIER3A_DATABASE_URL=postgresql://…?sslmode=require
CHANTIER3A_KEY_PASSPHRASE=<passphrase longue>
CHANTIER3A_BASE_URL=https://festival.example.com
CHANTIER3A_DATA_DIR=/srv/data
CHANTIER3A_PAYMENT_PROVIDERS=manual,fedapay
CHANTIER3A_FEDAPAY_SECRET_KEY=sk_live_…
CHANTIER3A_FEDAPAY_WEBHOOK_SECRET=wh_live_…
CHANTIER3A_FEDAPAY_ENV=live
CHANTIER3A_SMTP_HOST=…
CHANTIER3A_SMTP_PORT=587
CHANTIER3A_SMTP_USER=…
CHANTIER3A_SMTP_PASSWORD=…
CHANTIER3A_SMTP_FROM=billets@festival.example.com
```

Front (variables lues **à la construction** : refaire `npm run build` après changement) :

```env
VITE_FEDAPAY_PUBLIC_KEY=pk_live_…
VITE_FEDAPAY_ENV=live
```

Ne pas définir `VITE_API_URL` si l'API est servie sur la même origine (`/api`). La clé secrète ne doit jamais apparaître dans un fichier du front, ni dans un dépôt, une image Docker ou un log. Les fichiers `.env` sont ignorés par git : gardez-les ainsi.

Ne laissez pas les clés sandbox et live mélangées : `pk_live` avec `sk_sandbox` (ou l'inverse) fait échouer le paiement.

## 4. À sauvegarder et à protéger

| Élément | Pourquoi |
|---------|----------|
| `CHANTIER3A_KEY_PASSPHRASE` | Déverrouille le coffre qui protège les clés privées de signature des billets. Perdue ou fausse, le coffre reste verrouillé : **aucun nouveau billet ne peut être émis**, donc un paiement peut être encaissé sans billet. Les clés publiques ne sont pas chiffrées, la vérification des billets déjà émis n'en dépend pas. |
| Base PostgreSQL | Commandes, billets, coffre de clés. Sauvegardes automatiques et test de restauration. |
| `CHANTIER3A_DATA_DIR` (secret de session, médias) | Le secret de session est généré au premier démarrage ; le perdre déconnecte les sessions. |
| Clé secrète FedaPay et secret du webhook | À stocker dans un gestionnaire de secrets ; à renouveler si elles ont pu fuiter. |

## 5. Avant l'ouverture de la vente

- [ ] `billetterie-api migrate` exécuté sur la base de production.
- [ ] Événement créé en **XOF**, types de billets créés, événement **publié**.
- [ ] Un vrai paiement de petit montant en `live` : commande → widget → paiement → e-mail avec PDF → scan du QR par l'application de contrôle à l'entrée.
- [ ] Le webhook est livré (tableau de bord FedaPay : réponse 200) et une commande dont l'onglet a été fermé après paiement passe quand même en payé.
- [ ] Le lien « Télécharger mon billet » de l'e-mail télécharge bien le PDF.
- [ ] Le SMTP envoie depuis une adresse autorisée pour votre domaine (SPF/DKIM) : sans cela, les billets finissent en spam.
- [ ] Un paiement refusé et un widget fermé ne créent aucun billet.
- [ ] Remboursement ou paiement litigieux : la procédure se fait dans le tableau de bord FedaPay ; la billetterie n'a pas d'annulation de billet automatique liée à un remboursement.

## 6. Limites connues

- **Commandes en attente sans expiration.** Un acheteur qui ferme le widget ou dont le paiement est refusé laisse une commande `pending` qui garde son stock réservé. Prévoyez une purge ou une expiration avant une vente à stock limité.
- **Déduplication des webhooks en mémoire.** Un redémarrage la vide. L'émission du billet reste idempotente, donc un rejeu ne crée pas de doublon, mais l'e-mail peut être renvoyé (le verrou d'envoi est lui aussi en mémoire).
- **Un seul processus.** Ces mémoires ne sont pas partagées entre plusieurs instances du backend ; en multi-instances, l'idempotence repose uniquement sur la base.
- **XOF uniquement.** Une autre devise est refusée à la création de la commande.
- **Pas de limitation de débit** sur `POST /api/payments/verify` : à mettre au niveau du reverse proxy.
- **Script Checkout.js** chargé depuis `cdn.fedapay.com` (version figée `1.1.7` dans `frontend-web/src/lib/fedapay-checkout.ts`). Si votre politique de sécurité (CSP) est stricte, autorisez `cdn.fedapay.com` et les domaines `*.fedapay.com` (scripts, cadres, connexions).

## 7. Retour arrière

- Désactiver le paiement en ligne : retirer `CHANTIER3A_FEDAPAY_SECRET_KEY` (ou `fedapay` de `CHANTIER3A_PAYMENT_PROVIDERS`) et redémarrer. Le provider n'est plus enregistré ; les pass payants ne peuvent plus être commandés en ligne, les pass gratuits continuent.
- Les billets déjà émis restent valides.
- Une commande payée chez FedaPay mais non réglée ici (backend arrêté pendant le paiement) se règle en rappelant `POST /api/payments/verify` avec son identifiant, ou par la livraison du webhook lorsque le service redémarre (FedaPay réessaie selon sa propre politique).

## 8. Dépannage

| Symptôme | Cause probable |
|----------|----------------|
| Le widget s'ouvre mais aucun clic ne passe | Une modale reste ouverte pendant l'ouverture du widget (`pointer-events: none` sur `body`). |
| « Le paiement en ligne n'est pas configuré » | `VITE_FEDAPAY_PUBLIC_KEY` absente au moment du build du front. |
| `POST /api/orders` échoue (400 « payment provider unavailable ») | Clé secrète invalide ou API FedaPay injoignable ; la commande est annulée et le stock rendu. |
| `payment_not_confirmed` (402) après un paiement | Paiement encore en attente chez l'opérateur, ou montant/devise différents (le backend refuse). Réessayer, puis vérifier la transaction dans FedaPay. |
| Webhook en 400 | Secret du webhook absent ou faux, ou horloge du serveur décalée de plus de 5 minutes (tolérance de la signature). |
| Le lien de l'e-mail renvoie 404 | `CHANTIER3A_BASE_URL` ne pointe pas vers une origine où `/api/...` atteint le backend. |
| Erreur CORS dans le navigateur | Le site n'est pas servi depuis exactement l'origine de `CHANTIER3A_BASE_URL`. |

## 9. Checklist ouverture billetterie payante

- [ ] `VITE_FEDAPAY_PUBLIC_KEY=pk_live_…` et `VITE_FEDAPAY_ENV=live` au **build** du front (pas de clé `pk_sandbox_…` dans le bundle prod).
- [ ] `CHANTIER3A_FEDAPAY_SECRET_KEY=sk_live_…` et secret webhook live côté API.
- [ ] Parcours test live avec un petit montant + `POST /api/payments/verify` avec **e-mail acheteur** (obligatoire).
- [ ] Nettoyage commandes pentest : voir [`PENTEST-CLEANUP.md`](PENTEST-CLEANUP.md).
