// pdfjs-dist ships types for its unminified legacy build only. The runtime imports the minified
// builds (half the bundle weight, same code), so they borrow the unminified build's types.
declare module "pdfjs-dist/legacy/build/pdf.min.mjs" {
  export * from "pdfjs-dist/legacy/build/pdf.mjs";
}
declare module "pdfjs-dist/legacy/build/pdf.worker.min.mjs";
