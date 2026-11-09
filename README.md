# Matrix Scratchpad

A browser scratchpad for matrices with step-by-step linear-algebra explainers. Works on desktop and mobile.

**Live:** https://matrix-scratchpad.ducklabs.workers.dev

## Features

- **Free-form paper workspace** — create any number of n×m matrices and notes anywhere; pan, zoom (pinch / Ctrl+scroll), box-select.
- **Editing** — fractions, decimals and arithmetic in cells (`1/3+2`), arrow/Enter navigation, paste a block into any cell, drag the corner to grow/shrink.
- **Rows & columns** — tap `R2` / `C3` for a tool that accepts `R2 - 3R1`, `*2`, `/3`, `swap R1`, `= 1 2 3`; drag handles to reorder. Every op is logged under the matrix.
- **Temporary rows/columns** — scratch lines outside the brackets with live expressions (`R1 - 2R2`), writable back into the matrix.
- **Matrix management** — copy/paste (text, LaTeX, NumPy, MATLAB, spreadsheets), duplicate, drop one matrix on another to swap places, undo/redo, autosave, JSON export/import.
- **Drawing (Excalidraw-style)** — hand, select, rectangle, diamond, ellipse, arrow, line, freehand, text, image and eraser tools (shortcuts 1–0 / letters, Q to lock a tool); hand-drawn rendering via rough.js; box-select, Shift-click, Ctrl+A, Delete, duplicate, copy/paste, group (Ctrl+G); resize/rotate handles, line endpoints and bend handle; style panel for stroke/background/fill, stroke width & style, sloppiness, edges, arrowheads, fonts, opacity, layer order, align & distribute.
- **Rows & columns across matrices** — copy one or several (Shift/Ctrl-click handles) and paste them into another matrix, after any line, or as a new matrix; apply *k, /k, = v to several at once.
- **Spreadsheet-style keys** — Tab across, Enter to the next row (adds one on the last row), Backspace in an empty cell walks back through the matrix.
- **Homework friendly** — matrices and answers copy as `@MATX{{a,b};{c,d}}` (switchable to text/LaTeX/Python/MATLAB); paste screenshots to import; augmented [A | b] view; quick facts (size, rank, det) for the selection.
- **Pages** — separate scratchpads per problem (tabs bottom-left).
- **Solver** — quick ops for the selection, a per-matrix `ƒ` menu, and a command bar (`C = A*B'`, `inv(A)`, `solve(A, b)`, `2A - 3I(3)`, `[1 2; 3 4]^-1`).
- **Explainer** — step-by-step or answer-only for: add/subtract/scale/multiply/power/transpose/Hadamard/Kronecker, REF, RREF, rank, inverse (Gauss–Jordan or adjugate), determinant (cofactor or row reduction), cofactor matrix, adjugate, trace, Ax=b (unique / none / parametric), least squares, null/column/row space, LU (with pivoting), Gram–Schmidt/QR, diagonalization, SVD, characteristic polynomial, eigenvalues & eigenvectors. Exact rational arithmetic throughout. The explainer keeps a history of everything you ran.

## Run locally

No build step — open `index.html`, or:

```bash
npm start
```

## Test

```bash
npm test
```

## Deploy

```bash
mkdir -p public && cp -r index.html css js public/ && npx wrangler deploy
```
