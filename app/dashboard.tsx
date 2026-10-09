"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Contrast,
  Eye,
  FileText,
  LoaderCircle,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Type,
  Upload,
  WifiOff,
} from "lucide-react";
import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ElementType,
} from "react";

type Block =
  | { type: "paragraph"; text: string; style?: "lead" | "small" }
  | { type: "list"; items: string[] };

interface Section {
  level: number;
  title: string;
  page: number;
  content: Block[];
  sections: Section[];
}

interface FicheSummary {
  id: string;
  title: string;
  filename: string;
  pageCount: number;
  createdAt: string;
}

interface Fiche extends FicheSummary {
  size: number;
  warning?: string;
  content: Block[];
  sections: Section[];
}

interface FicheList {
  items: FicheSummary[];
  total: number;
  page: number;
  pages: number;
}

interface UploadResponse {
  id: string;
  title?: string;
  duplicate?: boolean;
  warning?: string;
}

const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api"
).replace(/\/+$/, "");
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const PAGE_SIZE = 20;

async function readError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error || "Une erreur est survenue.";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date inconnue";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function ContentBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) =>
        block.type === "list" ? (
          <ul
            className="list-disc space-y-2 pl-6 marker:text-accent"
            key={`list-${index}`}
          >
            {block.items.map((item, itemIndex) => (
              <li className="pl-1 leading-7" key={`${itemIndex}-${item}`}>
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p
            className={`leading-7 ${
              block.style === "lead"
                ? "text-lg font-medium text-ink"
                : block.style === "small"
                  ? "text-sm text-muted"
                  : "text-base text-ink"
            }`}
            key={`paragraph-${index}`}
          >
            {block.text}
          </p>
        ),
      )}
    </div>
  );
}

function SectionView({ section }: { section: Section }) {
  const Heading = `h${Math.min(Math.max(section.level, 2), 6)}` as ElementType;
  return (
    <section className="space-y-4">
      <Heading className="text-xl font-semibold leading-snug text-accent sm:text-2xl">
        {section.title}
      </Heading>
      <ContentBlocks blocks={section.content} />
      {section.sections.length > 0 && (
        <div className="space-y-7 border-l-2 border-line pl-5 sm:pl-7">
          {section.sections.map((child, index) => (
            <SectionView key={`${child.title}-${index}`} section={child} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function Dashboard() {
  const [list, setList] = useState<FicheList | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [apiError, setApiError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [notice, setNotice] = useState("");
  const [largeText, setLargeText] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [colorBlindMode, setColorBlindMode] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const parameters = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
    });
    if (deferredQuery) parameters.set("q", deferredQuery);
    setIsLoading(true);
    setApiError("");

    void fetch(`${API_BASE}/fiches?${parameters}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return (await response.json()) as FicheList;
      })
      .then((data) => setList(data))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setList(null);
        setApiError(
          error instanceof TypeError
            ? "Le service est injoignable pour le moment."
            : error instanceof Error
              ? error.message
              : "Impossible de charger les démarches.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [deferredQuery, page, refreshKey]);

  useEffect(() => {
    if (!selectedId) {
      setFiche(null);
      return;
    }
    const controller = new AbortController();
    setFiche(null);
    setDetailError("");
    setIsDetailLoading(true);

    void fetch(`${API_BASE}/fiches/${encodeURIComponent(selectedId)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return (await response.json()) as Fiche;
      })
      .then((data) => setFiche(data))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setDetailError(
          error instanceof TypeError
            ? "Le service est injoignable pour le moment."
            : error instanceof Error
              ? error.message
              : "Impossible de charger cette fiche.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsDetailLoading(false);
      });

    return () => controller.abort();
  }, [selectedId]);

  async function uploadPdf(file?: File) {
    if (!file) return;
    setNotice("");
    setUploadError("");
    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      setUploadError("Seuls les fichiers PDF sont acceptés.");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setUploadError("Le fichier dépasse la taille maximale de 20 Mo.");
      return;
    }

    const formData = new FormData();
    formData.append("pdf", file);
    setIsUploading(true);
    try {
      const response = await fetch(`${API_BASE}/fiches`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(await readError(response));
      const result = (await response.json()) as UploadResponse;
      setNotice(
        result.duplicate
          ? "Ce PDF est déjà présent dans la bibliothèque."
          : result.warning
            ? `Fiche ajoutée. ${result.warning}`
            : "La fiche a été ajoutée à la bibliothèque.",
      );
      setQuery("");
      setPage(1);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setUploadError(
        error instanceof TypeError
          ? "Envoi impossible : le service est injoignable."
          : error instanceof Error
            ? error.message
            : "Impossible d’envoyer ce fichier.",
      );
    } finally {
      setIsUploading(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    void uploadPdf(event.dataTransfer.files[0]);
  }

  const shellTheme = [
    darkMode && "theme-dark",
    highContrast && "theme-contrast",
    colorBlindMode && "theme-colorblind",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`app-shell min-h-screen ${shellTheme}`}>
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-accent text-white shadow-sm">
              <Plus aria-hidden="true" size={22} strokeWidth={2.7} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[19px] font-bold leading-tight text-ink">
                Couscoussière
              </p>
              <p className="mt-0.5 text-xs text-muted sm:text-sm">
                Gestion des démarches
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span className="hidden rounded-full bg-soft px-3 py-1.5 text-xs font-semibold text-accent sm:inline-flex">
              Administration
            </span>
            <span className="grid size-9 place-items-center rounded-full border border-line bg-canvas text-xs font-bold text-muted">
              EA
            </span>
            <span className="hidden text-sm text-muted md:inline">
              Équipe accueil
            </span>
          </div>
        </div>
      </header>

      <main className="page-texture mx-auto min-h-[calc(100vh-65px)] w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-11">
        {selectedId ? (
          <>
            <div className="mb-7 flex flex-col gap-4 border-b border-line pb-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-sm font-semibold text-accent transition hover:border-accent hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onClick={() => setSelectedId(null)}
                type="button"
              >
                <ArrowLeft aria-hidden="true" size={17} />
                Retour à la bibliothèque
              </button>
              <div
                aria-label="Options d’accessibilité"
                className="flex flex-wrap items-center gap-1.5"
                role="group"
              >
                <span className="mr-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  Affichage
                </span>
                <button
                  aria-label="Agrandir le texte"
                  aria-pressed={largeText}
                  className={`accessibility-button ${largeText ? "accessibility-button-active" : ""}`}
                  onClick={() => setLargeText((value) => !value)}
                  title="Agrandir le texte"
                  type="button"
                >
                  <Type aria-hidden="true" size={16} /> A+
                </button>
                <button
                  aria-label="Contraste renforcé"
                  aria-pressed={highContrast}
                  className={`accessibility-button ${highContrast ? "accessibility-button-active" : ""}`}
                  onClick={() => setHighContrast((value) => !value)}
                  title="Contraste renforcé"
                  type="button"
                >
                  <Contrast aria-hidden="true" size={16} />
                  <span className="hidden sm:inline">Contraste</span>
                </button>
                <button
                  aria-label="Fond sombre"
                  aria-pressed={darkMode}
                  className={`accessibility-button ${darkMode ? "accessibility-button-active" : ""}`}
                  onClick={() => setDarkMode((value) => !value)}
                  title="Fond sombre"
                  type="button"
                >
                  <Moon aria-hidden="true" size={16} />
                  <span className="hidden sm:inline">Sombre</span>
                </button>
                <button
                  aria-label="Palette adaptée au daltonisme"
                  aria-pressed={colorBlindMode}
                  className={`accessibility-button ${colorBlindMode ? "accessibility-button-active" : ""}`}
                  onClick={() => setColorBlindMode((value) => !value)}
                  title="Palette adaptée au daltonisme"
                  type="button"
                >
                  <Palette aria-hidden="true" size={16} />
                  <span className="hidden sm:inline">Daltonisme</span>
                </button>
              </div>
            </div>

            {isDetailLoading ? (
              <div aria-label="Chargement de la fiche" className="space-y-4">
                <div className="skeleton h-5 w-32" />
                <div className="skeleton h-12 w-3/4" />
                <div className="skeleton h-28 w-full" />
              </div>
            ) : detailError ? (
              <div className="status-panel" role="alert">
                <WifiOff aria-hidden="true" className="shrink-0" size={20} />
                <div>
                  <p className="font-semibold">Fiche indisponible</p>
                  <p className="mt-1 text-sm">{detailError}</p>
                </div>
              </div>
            ) : fiche ? (
              <article className="mx-auto max-w-4xl animate-enter">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full bg-soft px-3 py-1.5 text-xs font-semibold text-accent">
                    <span className="size-1.5 rounded-full bg-accent" />
                    Fiche publiée
                  </span>
                  <span className="flex min-w-0 items-center gap-2 text-xs text-muted sm:text-sm">
                    <FileText aria-hidden="true" className="shrink-0" size={16} />
                    <span className="max-w-[60vw] truncate sm:max-w-none">
                      {fiche.filename}
                    </span>
                  </span>
                </div>
                <div className="reader-surface rounded-lg border border-line px-5 py-7 sm:px-10 sm:py-10">
                  <div className="reading-text" data-large-text={largeText}>
                    <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-accent">
                      Démarche
                    </p>
                    <h1 className="max-w-3xl text-3xl font-bold leading-tight text-ink sm:text-4xl">
                      {fiche.title}
                    </h1>
                    <p className="mt-4 text-sm text-muted">
                      Ajoutée le {formatDate(fiche.createdAt)}
                      <span aria-hidden="true" className="mx-2">
                        ·
                      </span>
                      {fiche.pageCount} page{fiche.pageCount > 1 ? "s" : ""}
                    </p>
                    {fiche.warning && (
                      <p className="mt-6 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                        <CircleAlert
                          aria-hidden="true"
                          className="mt-0.5 shrink-0"
                          size={17}
                        />
                        {fiche.warning}
                      </p>
                    )}
                    <div className="mt-9 space-y-8">
                      <ContentBlocks blocks={fiche.content} />
                      {fiche.sections.map((section, index) =>
                        section.title.trim().toLocaleLowerCase("fr") ===
                        fiche.title.trim().toLocaleLowerCase("fr") ? (
                          <div className="space-y-7" key={`${section.title}-${index}`}>
                            <ContentBlocks blocks={section.content} />
                            {section.sections.map((child, childIndex) => (
                              <SectionView
                                key={`${child.title}-${childIndex}`}
                                section={child}
                              />
                            ))}
                          </div>
                        ) : (
                          <SectionView
                            key={`${section.title}-${index}`}
                            section={section}
                          />
                        ),
                      )}
                      {fiche.content.length === 0 &&
                        fiche.sections.length === 0 && (
                          <p className="rounded-lg bg-canvas px-4 py-5 text-sm text-muted">
                            Aucun contenu textuel n’a été extrait de ce PDF.
                          </p>
                        )}
                    </div>
                  </div>
                </div>
                <p className="mt-4 text-right text-xs text-muted">
                  Source : {fiche.filename}
                </p>
              </article>
            ) : null}
          </>
        ) : (
          <div className="animate-enter">
            <div className="mb-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-accent">
                  Espace administration
                </p>
                <h1 className="text-3xl font-bold leading-tight text-ink sm:text-4xl">
                  Ajouter une démarche
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted sm:text-base">
                  Importez une fiche PDF pour la convertir en démarche accessible.
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted">
                <span className="size-2 rounded-full bg-accent" />
                <span>PDF · 20 Mo maximum</span>
              </div>
            </div>

            <div
              className={`drop-zone mb-10 rounded-lg border-2 border-dashed px-5 py-8 text-center transition sm:px-8 sm:py-10 ${isDragging ? "drop-zone-active" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
              role="region"
              aria-label="Déposer un fichier PDF"
            >
              <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-soft text-accent">
                {isUploading ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                    size={22}
                  />
                ) : (
                  <Upload aria-hidden="true" size={22} />
                )}
              </span>
              <h2 className="text-lg font-semibold text-ink sm:text-xl">
                {isUploading
                  ? "Envoi et conversion en cours"
                  : "Glissez-déposez la fiche PDF ici"}
              </h2>
              <p className="my-3 text-sm text-muted">ou</p>
              <input
                accept="application/pdf,.pdf"
                className="sr-only"
                onChange={(event) => {
                  void uploadPdf(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
                ref={fileInput}
                type="file"
              />
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-70"
                disabled={isUploading}
                onClick={() => fileInput.current?.click()}
                type="button"
              >
                {isUploading ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                    size={17}
                  />
                ) : (
                  <Plus aria-hidden="true" size={17} />
                )}
                {isUploading ? "Traitement…" : "Choisir un fichier PDF"}
              </button>
              <p className="mt-4 text-xs text-muted">
                PDF uniquement <span aria-hidden="true">·</span> 20 Mo maximum
              </p>
            </div>

            {(uploadError || notice) && (
              <div
                className={`mb-8 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${uploadError ? "border-red-200 bg-red-50 text-red-900" : "border-emerald-200 bg-emerald-50 text-emerald-950"}`}
                role={uploadError ? "alert" : "status"}
              >
                {uploadError ? (
                  <CircleAlert
                    aria-hidden="true"
                    className="mt-0.5 shrink-0"
                    size={17}
                  />
                ) : (
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 shrink-0"
                    size={17}
                  />
                )}
                <span>{uploadError || notice}</span>
              </div>
            )}

            <section aria-labelledby="published-title">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2
                    className="text-2xl font-bold leading-tight text-ink"
                    id="published-title"
                  >
                    Démarches publiées
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    {list ? `${list.total} résultat${list.total > 1 ? "s" : ""}` : "Bibliothèque"}
                  </p>
                </div>
                <label className="relative block w-full sm:max-w-sm">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
                    size={18}
                  />
                  <span className="sr-only">Rechercher une démarche</span>
                  <input
                    className="h-11 w-full rounded-lg border border-line bg-surface pl-10 pr-4 text-sm text-ink outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/15"
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                    placeholder="Titre ou nom du fichier…"
                    type="search"
                    value={query}
                  />
                </label>
              </div>

              {apiError && (
                <div className="status-panel mb-4" role="alert">
                  <WifiOff aria-hidden="true" className="shrink-0" size={20} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">API indisponible</p>
                    <p className="mt-1 text-sm">{apiError}</p>
                  </div>
                  <button
                    aria-label="Réessayer le chargement"
                    className="icon-button"
                    onClick={() => setRefreshKey((value) => value + 1)}
                    title="Réessayer"
                    type="button"
                  >
                    <RefreshCw aria-hidden="true" size={17} />
                  </button>
                </div>
              )}

              {isLoading && !list ? (
                <div aria-label="Chargement des démarches" className="space-y-2">
                  {[0, 1, 2].map((item) => (
                    <div className="skeleton h-[88px]" key={item} />
                  ))}
                </div>
              ) : list && list.items.length > 0 ? (
                <div className="space-y-2">
                  {list.items.map((item) => (
                    <article
                      className="entry-row flex flex-col gap-4 rounded-lg border border-line bg-surface p-3.5 sm:flex-row sm:items-center sm:p-4"
                      key={item.id}
                    >
                      <span className="flex size-12 shrink-0 items-center justify-center gap-0.5 rounded-md bg-[#edf4f2] text-accent">
                        <FileText aria-hidden="true" size={17} />
                        <span className="text-[9px] font-bold">PDF</span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-semibold text-ink">
                          {item.title}
                        </h3>
                        <p className="mt-0.5 truncate text-xs text-muted sm:text-sm">
                          {item.filename}
                        </p>
                        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                          <span>
                            {item.pageCount} page{item.pageCount > 1 ? "s" : ""}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>Ajoutée le {formatDate(item.createdAt)}</span>
                        </p>
                      </div>
                      <button
                        className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 self-end rounded-lg border border-accent px-3.5 text-sm font-semibold text-accent transition hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:self-auto"
                        onClick={() => setSelectedId(item.id)}
                        type="button"
                      >
                        <Eye aria-hidden="true" size={17} />
                        Aperçu
                      </button>
                    </article>
                  ))}
                </div>
              ) : list && !apiError ? (
                <div className="empty-state rounded-lg border border-line bg-surface px-5 py-12 text-center">
                  <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-soft text-accent">
                    <FileText aria-hidden="true" size={20} />
                  </span>
                  <h3 className="font-semibold text-ink">
                    {deferredQuery
                      ? "Aucun résultat"
                      : "Aucune démarche publiée"}
                  </h3>
                  <p className="mt-1 text-sm text-muted">
                    {deferredQuery
                      ? "Modifiez votre recherche pour voir d’autres fiches."
                      : "La bibliothèque est vide."}
                  </p>
                </div>
              ) : null}

              {list && list.pages > 1 && (
                <nav
                  aria-label="Pagination des démarches"
                  className="mt-5 flex items-center justify-between gap-3"
                >
                  <button
                    className="pagination-button"
                    disabled={page <= 1 || isLoading}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    type="button"
                  >
                    <ChevronLeft aria-hidden="true" size={17} />
                    <span>Précédent</span>
                  </button>
                  <span className="text-sm tabular-nums text-muted">
                    Page {list.page} sur {list.pages}
                  </span>
                  <button
                    className="pagination-button"
                    disabled={page >= list.pages || isLoading}
                    onClick={() =>
                      setPage((value) => Math.min(list.pages, value + 1))
                    }
                    type="button"
                  >
                    <span>Suivant</span>
                    <ChevronRight aria-hidden="true" size={17} />
                  </button>
                </nav>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}