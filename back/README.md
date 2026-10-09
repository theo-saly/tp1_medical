# Back : API Fiches PDF

Le back reçoit des PDF, les convertit en contenu structuré (titres, paragraphes, listes) et les stocke dans MongoDB. Le front n'a jamais à manipuler de PDF : il envoie le fichier, puis lit du JSON.

**URL de base (dev) :** `http://localhost:4000/api`
Côté Next : `NEXT_PUBLIC_API_URL=http://localhost:4000/api` dans `.env.local`.

## Lancer le back en local

Prérequis : Node 22.9 ou plus récent, et Docker (pour MongoDB).

```bash
cd back
cp .env.example .env      # facultatif : les valeurs par défaut conviennent en local
docker compose up -d      # MongoDB
npm install
npm run dev               # API sur http://localhost:4000
```

Pour convertir un PDF en JSON sans passer par l'API : `npm run convert -- fichier.pdf`.

L'API n'accepte que les appels venant de `http://localhost:3000` (Next en dev). Pour une autre origine, il faut modifier `CORS_ORIGIN` dans `.env`.

## Endpoints

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/fiches` | Envoyer un PDF |
| `GET` | `/fiches?q=&page=&limit=` | Lister et rechercher (sans le contenu) |
| `GET` | `/fiches/:id` | Lire une fiche complète |

### `POST /fiches` : envoyer un PDF

Corps en `multipart/form-data`, avec le fichier dans le champ **`pdf`**. Taille maximale : 20 Mo.

```ts
const form = new FormData();
form.append('pdf', file); // file : File venant d'un <input type="file">
const res = await fetch(`${API}/fiches`, { method: 'POST', body: form });
```

Ne pas définir `Content-Type` à la main : le navigateur ajoute lui-même le bon en-tête multipart.

| Statut | Réponse |
|---|---|
| `201` | `{ id, title, pageCount, warning? }` : fiche créée |
| `200` | `{ id, duplicate: true }` : ce PDF existe déjà, on renvoie la fiche existante |
| `400` | Pas de champ `pdf`, ou le fichier n'est pas un PDF |
| `413` | PDF trop lourd |
| `422` | PDF illisible ou corrompu |

`warning` est présent quand aucun texte n'a pu être extrait (PDF scanné). La fiche est quand même créée, mais elle est vide : à signaler à l'utilisateur.

### `GET /fiches` : lister et rechercher

| Paramètre | Défaut | Rôle |
|---|---|---|
| `q` | — | Recherche plein texte en français, sans tenir compte des accents. Résultats triés par pertinence. |
| `page` | `1` | Numéro de page |
| `limit` | `20` | Fiches par page, 50 au maximum |

Sans `q`, les fiches sont triées de la plus récente à la plus ancienne. La réponse ne contient **pas** le contenu des fiches, pour rester légère.

```json
{
  "items": [
    { "id": "6ac8ea55d27b1bc8f3de2397", "title": "Se connecter à son compte CAF", "filename": "tuto-peda-caf.pdf", "pageCount": 1, "createdAt": "2026-10-09T13:21:25.640Z" }
  ],
  "total": 1,
  "page": 1,
  "pages": 1
}
```

### `GET /fiches/:id` : lire une fiche complète

Renvoie `200` avec la fiche, `400` si l'id est mal formé, `404` si la fiche n'existe pas.

```json
{
  "id": "6ac8ea55d27b1bc8f3de2397",
  "title": "Se connecter à son compte CAF",
  "filename": "tuto-peda-caf.pdf",
  "size": 6068,
  "pageCount": 1,
  "createdAt": "2026-10-09T13:21:25.640Z",
  "content": [],
  "sections": [
    {
      "level": 1,
      "title": "Se connecter à son compte CAF",
      "page": 1,
      "content": [{ "type": "paragraph", "style": "lead", "text": "Fiche mémo — La Formation pour tous" }],
      "sections": [
        {
          "level": 2,
          "title": "L'essentiel",
          "page": 1,
          "content": [{ "type": "list", "items": ["Aller sur le site de la CAF…", "Saisir les 13 chiffres…"] }],
          "sections": []
        }
      ]
    }
  ]
}
```

## Erreurs

Toutes les erreurs ont la même forme : `{ "error": "message lisible" }`. Le message peut être affiché tel quel à l'utilisateur.

## Types TypeScript

```ts
export type Block =
  | { type: 'paragraph'; text: string; style?: 'lead' | 'small' } // lead = chapeau, small = mention/légende
  | { type: 'list'; items: string[] };

export interface Section {
  level: number;        // 1 à 6 -> <h1> à <h6>
  title: string;
  page: number;         // page du PDF où commence la section
  content: Block[];     // texte placé directement sous le titre
  sections: Section[];  // sous-sections (récursif)
}

export interface FicheSummary {
  id: string;
  title: string;
  filename: string;
  pageCount: number;
  createdAt: string;    // date ISO
}

export interface Fiche extends FicheSummary {
  size: number;         // octets
  warning?: string;
  content: Block[];     // texte avant le premier titre (souvent vide)
  sections: Section[];
}

export interface FicheList {
  items: FicheSummary[];
  total: number;
  page: number;
  pages: number;
}
```

## Afficher une fiche

L'arbre est récursif : un composant `Section` qui s'appelle lui-même pour ses sous-sections suffit.

```tsx
function Section({ s }: { s: Section }) {
  const H = `h${Math.min(s.level, 6)}` as keyof JSX.IntrinsicElements;
  return (
    <section>
      <H>{s.title}</H>
      <Blocks blocks={s.content} />
      {s.sections.map((child, i) => <Section key={i} s={child} />)}
    </section>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return blocks.map((b, i) =>
    b.type === 'list'
      ? <ul key={i}>{b.items.map((it, j) => <li key={j}>{it}</li>)}</ul>
      : <p key={i} className={b.style}>{b.text}</p>
  );
}
```

Le texte vient de PDF envoyés par des utilisateurs : il doit être affiché comme du texte (ce que fait JSX par défaut), **jamais** avec `dangerouslySetInnerHTML`.

## Limites connues

- Les titres sont détectés d'après la taille et la graisse de la police. Un PDF mis en forme de façon irrégulière peut produire des niveaux de titre incorrects.
- Les tableaux et les listes numérotées ne sont pas reconnus : ils sortent en paragraphes.
- Un PDF scanné (une image sans texte) produit une fiche vide, avec `warning`.
- Pas de suppression ni de modification de fiche par l'API.

## Structure

| Fichier | Rôle |
|---|---|
| `server.js` | API Express + MongoDB |
| `convert.js` | Conversion PDF -> JSON hiérarchique (utilisable aussi en ligne de commande) |
| `docker-compose.yml` | MongoDB 7 en local |
| `.env.example` | Variables de configuration |
