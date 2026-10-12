# Liens d’inscription pour landing externe

L’équipe landing **n’a pas besoin** de recoder la billetterie : elle pointe vers des **URL fixes** qui ouvrent le **même formulaire** (8 étapes) et le **même flux e-mail / paiement** que la vitrine TDEV.

Base production : **`https://festival.ourtdev.com`**

## Pass gratuit (Pass Festival)

- **URL recommandée** : `/inscription/pass-festival`
- Exemple : `https://festival.ourtdev.com/inscription/pass-festival`
- Flux : formulaire → validation → **billet par e-mail** (si SMTP configuré côté API).

## Pass payant Nexus Night (5 000 FCFA)

- **URL recommandée** : `/inscription/nexus-night`
- Exemple : `https://festival.ourtdev.com/inscription/nexus-night`
- Flux : formulaire → **paiement Velto (Mobile Money)** → billets par e-mail (Festival + Nexus).

## Alias acceptés

| Segment ou `?pass=` | Offre |
|---------------------|--------|
| `pass-festival`, `festival`, `gratuit`, `student` | Pass Festival |
| `nexus-night`, `nexus`, `vip`, `payant` | Nexus Night |

Exemple : `/inscription?pass=vip`

## Intégration dans leur page

### 1. Lien simple (recommandé)

```html
<a href="https://festival.ourtdev.com/inscription/pass-festival" target="_blank" rel="noopener">
  S’inscrire gratuitement
</a>
```

### 2. Popup (fenêtre)

```javascript
function ouvrirInscriptionGratuite() {
  window.open(
    'https://festival.ourtdev.com/inscription/pass-festival?embed=1',
    'inscription-tdev',
    'width=520,height=720,scrollbars=yes,resizable=yes'
  );
}
```

### 3. Iframe (formulaire « unifié » visuellement)

```html
<iframe
  title="Inscription TDEV Festival"
  src="https://festival.ourtdev.com/inscription/pass-festival?embed=1"
  width="100%"
  height="780"
  style="border:0;border-radius:12px;max-width:560px;"
  allow="payment *"
></iframe>
```

Paramètre **`embed=1`** : masque en-tête / pied de page TDEV, formulaire seul (adapté iframe ou popup).

**Thème** : fond rose très clair et blanc, mode clair uniquement (pas de bascule sombre sur ces URLs).

### 4. Couleur d’accent (optionnel)

Par défaut le rose TDEV s’applique. Pour rapprocher une couleur partenaire, ajouter `accent=RRGGBB` (sans `#`) :

`.../inscription/nexus-night?embed=1&accent=1a6b45`

### 5. Événements JavaScript (iframe)

Si la landing écoute le parent :

```javascript
window.addEventListener('message', (event) => {
  if (event.data?.source !== 'tdev-billetterie') return;
  if (event.data.type === 'tdev-inscription-success') {
    console.log('Inscription OK', event.data);
  }
});
```

Pour restreindre l’origine en production, ajouter `&parentOrigin=https://leur-domaine.com` à l’URL iframe.

## Tests locaux

```bash
cd frontend-web && npm run dev
```

- Pass gratuit : http://127.0.0.1:5173/inscription/pass-festival
- Nexus payant : http://127.0.0.1:5173/inscription/nexus-night
- Embed : ajouter `?embed=1`

Backend local : `VITE_DEV_API_PROXY=http://127.0.0.1:8088` dans `.env`.

## Notes

- Welcome Pack / merch : lien boutique `https://shop.ourtdev.com` (hors formulaire).
- Les URL appellent toujours l’**API billetterie** (Render + Neon) ; seul le **parcours d’entrée** change côté front.
