// API fiches : upload PDF -> conversion -> MongoDB, puis lecture par le front.
// Lancement : docker compose up -d && npm start
import { createHash } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
import { pdfToJson } from './convert.js';

const PORT = process.env.PORT || 4000; // 3000 est pris par Next.js en dev
const CORS_ORIGIN = (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',');
const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'pdf_fiches';
const MAX_SIZE_MB = 20;

const client = new MongoClient(MONGO_URL);
await client.connect();
const fiches = client.db(DB_NAME).collection('fiches');

await Promise.all([
  fiches.createIndex({ title: 'text', text: 'text' }, { weights: { title: 10, text: 1 }, default_language: 'french', name: 'search' }),
  fiches.createIndex({ createdAt: -1 }),
  fiches.createIndex({ hash: 1 }, { unique: true }),
]);

// Texte brut de l'arbre, pour la recherche plein texte.
const flattenText = (node) =>
  [
    node.title,
    ...node.content.flatMap((b) => (b.type === 'list' ? b.items : [b.text])),
    ...node.sections.map(flattenText),
  ]
    .filter(Boolean)
    .join('\n');

// Le front reçoit toujours "id" (string), jamais "_id" ni les champs internes.
const toApi = ({ _id, score, ...rest }) => ({ id: _id.toString(), ...rest });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024, files: 1 },
});

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));

// POST /api/fiches  (multipart/form-data, champ "pdf")
app.post('/api/fiches', upload.single('pdf'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Champ "pdf" manquant' });
  if (file.buffer.subarray(0, 5).toString() !== '%PDF-') return res.status(400).json({ error: "Le fichier n'est pas un PDF" });

  const hash = createHash('sha256').update(file.buffer).digest('hex');
  const existing = await fiches.findOne({ hash }, { projection: { _id: 1 } });
  if (existing) return res.status(200).json({ id: existing._id.toString(), duplicate: true });

  let result;
  try {
    result = await pdfToJson(file.buffer);
  } catch (err) {
    return res.status(422).json({ error: `PDF illisible : ${err.message}` });
  }

  const doc = {
    title: result.sections[0]?.title || file.originalname.replace(/\.pdf$/i, ''),
    filename: file.originalname,
    size: file.size,
    pageCount: result.pageCount,
    content: result.content,
    sections: result.sections,
    text: flattenText({ content: result.content, sections: result.sections }),
    hash,
    createdAt: new Date(),
  };
  if (!doc.text.trim()) doc.warning = 'Aucun texte extrait (PDF scanné ?)';

  const { insertedId } = await fiches.insertOne(doc);
  res.status(201).json({ id: insertedId.toString(), title: doc.title, pageCount: doc.pageCount, ...(doc.warning && { warning: doc.warning }) });
});

// GET /api/fiches?q=caf&page=1&limit=20  -> liste légère, sans le contenu
app.get('/api/fiches', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
  const page = Math.max(parseInt(req.query.page) || 1, 1);

  const filter = q ? { $text: { $search: q } } : {};
  const projection = { title: 1, filename: 1, pageCount: 1, createdAt: 1, ...(q && { score: { $meta: 'textScore' } }) };
  const sort = q ? { score: { $meta: 'textScore' } } : { createdAt: -1 };

  const [items, total] = await Promise.all([
    fiches.find(filter, { projection }).sort(sort).skip((page - 1) * limit).limit(limit).toArray(),
    fiches.countDocuments(filter),
  ]);
  res.json({ items: items.map(toApi), total, page, pages: Math.ceil(total / limit) });
});

// GET /api/fiches/:id  -> fiche complète (arbre de sections)
app.get('/api/fiches/:id', async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'id invalide' });
  const fiche = await fiches.findOne({ _id: new ObjectId(req.params.id) }, { projection: { text: 0, hash: 0 } });
  if (!fiche) return res.status(404).json({ error: 'Fiche introuvable' });
  res.set('Cache-Control', 'private, max-age=3600').json(toApi(fiche));
});

// Erreurs (taille max dépassée, etc.)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `PDF trop lourd (max ${MAX_SIZE_MB} Mo)` : err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

app.listen(PORT, () => console.log(`API prête : http://localhost:${PORT}`));
