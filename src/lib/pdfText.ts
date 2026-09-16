/**
 * The words out of a PDF, in reading order.
 *
 * IN THE BROWSER, NOT ON A SERVER, and that is a constraint rather than a preference: Vercel Hobby
 * caps this project at twelve serverless functions and `api/` is at exactly twelve. A parsing
 * endpoint would mean removing one that already does something.
 *
 * It costs nothing to do it here anyway. The file is already on the collector's machine — they
 * downloaded it from the bureau a minute ago — so reading it in the tab they are standing in
 * front of saves an upload, a round trip and a temporary copy of somebody's ID number sitting on
 * a server. The PDF is uploaded afterwards, as a document, because the firm keeps what it paid
 * for; but the parsing does not wait for that.
 *
 * pdf.js loads on FIRST USE, not with the app. It is by some distance the largest thing in the
 * dependency list and almost nobody opens a trace on any given day — a static import would put it
 * in the bundle every collector downloads every morning to make one screen a second faster.
 *
 * THE LEGACY BUILD, and it is not optional. pdf.js's default build targets the newest engines and
 * uses Promise.withResolvers, structuredClone and Array.prototype.at bare. On an iPad it threw
 * "undefined is not a function" from inside minified pdf.js and the collector saw that sentence —
 * the firm works this app on iPads, so "works in Chrome" is not a finish line here. The legacy
 * build is the same library compiled with core-js polyfills for those gaps. It costs about 190KB
 * in a chunk nobody downloads until they open a trace, which is the right place to spend it.
 */

/**
 * One text run as the PDF draws it.
 *
 * Deliberately a flat list of strings and not lines reassembled from coordinates. A bureau report
 * is printed label-then-value in reading order, which is exactly what this is; rebuilding rows
 * from x/y would be guessing at a table the parser does not need. Where a table cell WRAPS, the
 * lines arrive as separate runs — traceProfile knows that and puts them back together.
 */
export async function pdfTokens(file: File | ArrayBuffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  /*
   * The worker is fetched as a URL rather than bundled, which is how pdf.js expects to be used
   * and what keeps it out of the main chunk. Without this line pdf.js falls back to parsing on
   * the main thread, which locks the tab for seconds on a thirty-page report.
   */
  /* The worker has to match the build, or the two disagree about what the API version is. */
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer()
  /* Nothing is rendered, so the fonts are never needed and would only be fetched. */
  const task = pdfjs.getDocument({ data: new Uint8Array(data), disableFontFace: true })
  const doc = await task.promise

  const tokens: string[] = []
  try {
    for (let page = 1; page <= doc.numPages; page += 1) {
      const p = await doc.getPage(page)
      const content = await p.getTextContent()
      for (const item of content.items) {
        /* Marked-content items carry no text and are not runs. */
        if (!('str' in item)) continue
        const text = item.str.replace(/ /g, ' ').trim()
        if (text) tokens.push(text)
      }
      p.cleanup()
    }
  } finally {
    /*
     * The LOADING TASK owns the worker, not the document — destroying the document alone leaves
     * the worker holding the whole file, and a collector who uploads six traces in a row ends up
     * with six copies of somebody's bureau profile alive in the tab.
     */
    await task.destroy()
  }
  return tokens
}
