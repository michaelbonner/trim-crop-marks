import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentIcon,
  LockClosedIcon,
  XMarkIcon,
  ArrowRightIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/16/solid";
import { zip } from "fflate";
import type { CropResult } from "./pdf";
import "./style.css";

type Entry = { id: string; file: File; name: string } & (
  | { kind: "queued" }
  | { kind: "processing"; page: number; total: number }
  | { kind: "ready"; result: CropResult }
  | { kind: "error"; message: string }
);

function save(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function formatSize(bytes: number) {
  return bytes < 1_000_000
    ? `${Math.max(1, Math.round(bytes / 1000))} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function Preview({ result }: { result: CropResult }) {
  const [pageIndex, setPageIndex] = useState(0);
  const page = result.pages[pageIndex];
  return (
    <div className="preview">
      <div className="preview-heading">
        <p>
          {page.method === "unchanged"
            ? "No crop marks detected. This page is unchanged."
            : page.method === "trim"
              ? "Cropped to the PDF’s embedded trim boundary."
              : "Crop marks detected and trimmed."}
        </p>
        <div className="pagination">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous page"
            disabled={pageIndex === 0}
            onClick={() => setPageIndex(pageIndex - 1)}
          >
            <ChevronLeftIcon />
          </button>
          <span>
            {pageIndex + 1} / {result.pages.length}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Next page"
            disabled={pageIndex === result.pages.length - 1}
            onClick={() => setPageIndex(pageIndex + 1)}
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>
      <div className="preview-pair">
        <figure>
          <div className="paper-stage">
            <img src={page.before} alt={`Original PDF page ${pageIndex + 1}`} />
          </div>
          <figcaption>
            Original{" "}
            <span>
              {Math.round(page.original.width)} ×{" "}
              {Math.round(page.original.height)} pt
            </span>
          </figcaption>
        </figure>
        <figure>
          <div className="paper-stage">
            <img src={page.after} alt={`Result PDF page ${pageIndex + 1}`} />
          </div>
          <figcaption>
            {page.method === "unchanged" ? "Unchanged" : "Trimmed"}{" "}
            <span>
              {Math.round(page.cropped.width)} ×{" "}
              {Math.round(page.cropped.height)} pt
            </span>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}

function FileRow({
  entry,
  busy,
  remove,
}: {
  entry: Entry;
  busy: boolean;
  remove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cropped =
    entry.kind === "ready"
      ? entry.result.pages.filter((p) => p.method !== "unchanged").length
      : 0;
  const unchanged =
    entry.kind === "ready" ? entry.result.pages.length - cropped : 0;
  return (
    <li className="file-row">
      <div className="file-main">
        <DocumentIcon className="file-icon" />
        <div className="file-info">
          <p className="file-name">{entry.file.name}</p>
          <p
            className={`file-meta ${entry.kind === "error" ? "error-text" : ""}`}
          >
            {entry.kind === "queued" && "Waiting to trim…"}
            {entry.kind === "processing" &&
              `Checking page ${entry.page} of ${entry.total || "…"}…`}
            {entry.kind === "error" && entry.message}
            {entry.kind === "ready" &&
              `${formatSize(entry.file.size)} · ${cropped ? `${cropped} ${cropped === 1 ? "page" : "pages"} trimmed` : "No crop marks found"}${unchanged ? ` · ${unchanged} unchanged` : ""}`}
          </p>
        </div>
        {entry.kind === "ready" && (
          <>
            <div className={`status ${unchanged ? "status-note" : ""}`}>
              {unchanged ? <ExclamationTriangleIcon /> : <CheckIcon />}
              <span>
                {unchanged ? (cropped ? "Partial" : "Unchanged") : "Ready"}
              </span>
            </div>
            <button
              type="button"
              className="icon-button preview-toggle"
              aria-label={`${expanded ? "Hide" : "Show"} preview of ${entry.file.name}`}
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              <ChevronDownIcon className={expanded ? "rotated" : ""} />
            </button>
            <button
              type="button"
              className="button download-one"
              onClick={() =>
                save(entry.result.bytes, entry.name, "application/pdf")
              }
            >
              <ArrowDownTrayIcon />
              <span>Download</span>
            </button>
          </>
        )}
        {entry.kind === "processing" && (
          <div className="spinner" aria-label="Processing" />
        )}
        <button
          type="button"
          className="icon-button"
          disabled={busy}
          aria-label={`Remove ${entry.file.name}`}
          onClick={remove}
        >
          <XMarkIcon />
        </button>
      </div>
      {expanded && entry.kind === "ready" && <Preview result={entry.result} />}
    </li>
  );
}

function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [zipping, setZipping] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const processing = useRef(false);
  const dragDepth = useRef(0);
  const ready = entries.filter((entry) => entry.kind === "ready");
  const trimmedCount = ready.reduce(
    (n, entry) =>
      n + entry.result.pages.filter((p) => p.method !== "unchanged").length,
    0,
  );

  async function addFiles(files: File[]) {
    if (processing.current || zipping) return;
    setMessage("");
    const valid: File[] = [];
    const warnings: string[] = [];
    let total = entries.reduce((n, e) => n + e.file.size, 0);
    for (const file of files) {
      if (!/\.pdf$/i.test(file.name)) {
        warnings.push(`${file.name}: please choose a PDF.`);
        continue;
      }
      if (file.size > 50_000_000) {
        warnings.push(`${file.name}: the limit is 50 MB per PDF.`);
        continue;
      }
      if (
        entries.length + valid.length >= 20 ||
        total + file.size > 150_000_000
      ) {
        warnings.push("A batch can hold up to 20 PDFs and 150 MB in total.");
        break;
      }
      valid.push(file);
      total += file.size;
    }
    if (warnings.length) setMessage(warnings.join(" "));
    if (!valid.length) return;
    processing.current = true;
    setBusy(true);
    const names = new Set(entries.map((e) => e.name));
    const added: Entry[] = valid.map((file) => {
      const base =
        file.name.replace(/\.pdf$/i, "").replace(/[\\/\x00-\x1f]/g, "_") ||
        "document";
      let name = `${base}-trimmed.pdf`,
        count = 2;
      while (names.has(name)) name = `${base}-trimmed-${count++}.pdf`;
      names.add(name);
      return { id: crypto.randomUUID(), file, name, kind: "queued" };
    });
    setEntries((current) => [...current, ...added]);
    for (const entry of added) {
      try {
        const { cropPdf } = await import("./pdf");
        const result = await cropPdf(entry.file, (page, total) =>
          setEntries((current) =>
            current.map((item) =>
              item.id === entry.id
                ? { ...entry, kind: "processing", page, total }
                : item,
            ),
          ),
        );
        setEntries((current) =>
          current.map((item) =>
            item.id === entry.id ? { ...entry, kind: "ready", result } : item,
          ),
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : "";
        const message = /encrypt|password/i.test(detail)
          ? "Password-protected PDF. Save an unlocked copy and try again."
          : /300 pages/.test(detail)
            ? detail
            : "Could not read this PDF. It may be damaged or unsupported.";
        setEntries((current) =>
          current.map((item) =>
            item.id === entry.id ? { ...entry, kind: "error", message } : item,
          ),
        );
      }
    }
    processing.current = false;
    setBusy(false);
  }

  function downloadZip() {
    if (!ready.length || zipping) return;
    setZipping(true);
    zip(
      Object.fromEntries(ready.map((e) => [e.name, e.result.bytes])),
      { level: 0 },
      (error, bytes) => {
        setZipping(false);
        if (error)
          setMessage(
            "Could not create the ZIP. You can still download each PDF individually.",
          );
        else save(bytes, "trimmed-pdfs.zip", "application/zip");
      },
    );
  }

  return (
    <div className="app">
      <header className="header">
        <a className="wordmark" href="/" aria-label="trim-crop-marks homepage">
          trim-crop-marks
        </a>
        <p className="local-note">
          <span className="green-dot" />
          Made to keep things simple.
        </p>
      </header>
      <main>
        <section className="intro">
          <p className="eyebrow">A little off the edges.</p>
          <h1>
            Your PDF.
            <br />
            Minus the crop marks.
          </h1>
          <p className="intro-copy">
            Drop in your PDFs. We’ll find the crop marks and trim them away.
            <br className="desktop-break" /> Download clean copies, one by one
            or all together.
          </p>
        </section>
        <section className="workspace" aria-label="PDF crop tool">
          <div
            className={`drop-zone ${dragging ? "is-dragging" : ""} ${busy ? "is-busy" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              dragDepth.current++;
              if (!busy) setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              event.preventDefault();
              dragDepth.current--;
              if (dragDepth.current === 0) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              dragDepth.current = 0;
              void addFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <div className="upload-content">
              <div className="upload-label">
                <ArrowUpTrayIcon />
                <span>LESS MARGIN. ZERO FUSS.</span>
              </div>
              <h2>
                {dragging
                  ? "Drop them right here"
                  : busy
                    ? "A little trim in progress…"
                    : entries.length
                      ? "Have a few more?"
                      : "Drop your PDFs here"}
              </h2>
              <p>
                {busy
                  ? "Checking every page for crop marks."
                  : "One file or a handful. We’ll take it from here."}
              </p>
              <input
                ref={input}
                className="visually-hidden"
                tabIndex={-1}
                type="file"
                name="pdfs"
                aria-label="Choose PDF files"
                accept=".pdf,application/pdf"
                multiple
                disabled={busy || zipping}
                onChange={(event) => {
                  void addFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className={`button ${ready.length ? "" : "primary"}`}
                disabled={busy || zipping}
                onClick={() => input.current?.click()}
              >
                <ArrowUpTrayIcon />
                Choose PDFs
              </button>
              <p className="upload-limit">
                PDF only · Up to 50 MB each · 20 files per batch
              </p>
            </div>
            <div className="demo-art" aria-hidden="true">
              <div className="illustration-paper">
                <i className="mark mark-tl" />
                <i className="mark mark-tr" />
                <i className="mark mark-bl" />
                <i className="mark mark-br" />
                <div className="illustration-content">
                  <div className="poster-kicker">A FRESH START</div>
                  <div className="poster-title">
                    Room
                    <br />
                    to breathe.
                  </div>
                  <div className="poster-circle" />
                  <div className="poster-bottom">JUST THE GOOD STUFF.</div>
                </div>
                <div className="cut-line" />
              </div>
              <div className="art-caption">
                <CheckIcon />
                Clean edges. Same PDF.
              </div>
            </div>
          </div>
          <div className="under-upload">
            <p>
              <LockClosedIcon />
              Your files stay on your device.
            </p>
            <button
              type="button"
              className="text-button"
              disabled={busy || zipping}
              onClick={() => {
                void import("./pdf")
                  .then(({ createSample }) => createSample())
                  .then((file) => addFiles([file]))
                  .catch(() =>
                    setMessage(
                      "Could not create the sample PDF. Try choosing your own PDF.",
                    ),
                  );
              }}
            >
              Try a sample PDF <ArrowRightIcon />
            </button>
          </div>
          {message && (
            <p className="notice" role="alert">
              {message}
            </p>
          )}
          {entries.length > 0 && (
            <section className="results" aria-label="Your PDFs">
              <div className="results-heading">
                <div>
                  <h2>
                    Your PDFs <span>{entries.length}</span>
                  </h2>
                  <p role="status" aria-live="polite">
                    {busy
                      ? "Trimming your batch…"
                      : ready.length
                        ? `${trimmedCount} ${trimmedCount === 1 ? "page" : "pages"} trimmed. Your files are ready below.`
                        : "No readable PDFs. Check the file details below."}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy || zipping}
                  onClick={() => {
                    setEntries([]);
                    setMessage("");
                  }}
                >
                  Clear all
                </button>
              </div>
              <ul role="list" className="file-list">
                {entries.map((entry) => (
                  <FileRow
                    key={entry.id}
                    entry={entry}
                    busy={busy || zipping}
                    remove={() =>
                      setEntries((current) =>
                        current.filter((e) => e.id !== entry.id),
                      )
                    }
                  />
                ))}
              </ul>
              {ready.length > 0 && (
                <div className="batch-download">
                  <p>
                    {ready.length} {ready.length === 1 ? "PDF" : "PDFs"} ready
                    to download
                    {entries.some((e) => e.kind === "error")
                      ? ". Unreadable files are excluded."
                      : "."}
                  </p>
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy || zipping}
                    onClick={downloadZip}
                  >
                    <ArrowDownTrayIcon />
                    {zipping ? "Creating ZIP…" : "Download all as ZIP"}
                  </button>
                </div>
              )}
            </section>
          )}
        </section>
        <section className="how-it-works" aria-label="How it works">
          <div>
            <p className="step">01 / ADD</p>
            <h3>Bring your PDFs</h3>
            <p>
              A print export, a whole batch. <br />
              Just drop them in.
            </p>
          </div>
          <div>
            <p className="step">02 / TRIM</p>
            <h3>We find the edges</h3>
            <p>
              Crop marks detected automatically. <br />
              Every page gets checked.
            </p>
          </div>
          <div>
            <p className="step">03 / KEEP</p>
            <h3>Take the clean copies</h3>
            <p>
              Download each PDF or grab a ZIP. <br />
              Your artwork stays sharp.
            </p>
          </div>
        </section>
        <details className="about">
          <summary>What if my PDF has no crop marks?</summary>
          <p>
            trim-crop-marks uses the PDF’s embedded trim boundary when one is
            available, or looks for matching crop marks at all four corners. If
            a page has neither, we leave it unchanged and tell you in the
            results. Open the preview to check each page before downloading.
            Cropping hides the area outside the page boundary; it does not erase
            that content from the PDF.
          </p>
        </details>
      </main>
      <footer>
        <p>A tiny tool for a tidy PDF.</p>
        <p>No account. No uploads. Just trim.</p>
      </footer>
    </div>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
