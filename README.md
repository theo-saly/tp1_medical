# tp1_medical

Conversion de fiches PDF en démarches accessibles.

| Dossier | Rôle | Stack | Port |
|---|---|---|---|
| [`front/`](front/) | Interface : envoi des PDF, bibliothèque, lecture accessible | Next.js, TypeScript, Tailwind | 3000 |
| [`back/`](back/) | API : conversion PDF -> JSON, stockage, recherche | Node, Express, MongoDB | 4000 |

Contrat de l'API (endpoints, types, erreurs) : [back/README.md](back/README.md).

## Lancer le projet

Prérequis : Node 22.9 ou plus récent, Docker Desktop démarré.

```bash
# Terminal 1 : back
cd back
npm install
docker compose up -d
npm run dev

# Terminal 2 : front
cd front
npm install
npm run dev
```

Puis ouvrir http://localhost:3000.
