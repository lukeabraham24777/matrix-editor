# Matrix Scratchpad

A browser scratchpad for matrices with step-by-step linear-algebra explainers. Works on desktop and mobile.

**Live:** https://matrix-scratchpad.ducklabs.workers.dev

## Features

- **Free-form paper workspace** — create any number of n×m matrices and notes anywhere; pan, zoom (pinch / Ctrl+scroll), box-select.
- **Editing** — fractions, decimals and arithmetic in cells (`1/3+2`), arrow/Enter navigation, paste a block into any cell, drag the corner to grow/shrink.
- **Rows & columns** — tap `R2` / `C3` for a tool that accepts `R2 - 3R1`, `*2`, `/3`, `swap R1`, `= 1 2 3`; drag handles to reorder. Every op is logged under the matrix.
- **Temporary rows/columns** — scratch lines outside the brackets with live expressions (`R1 - 2R2`), writable back into the matrix.
- **Matrix management** — copy/paste (text, LaTeX, NumPy, MATLAB, spreadsheets), duplicate, drop one matrix on another to swap places, undo/redo, autosave, JSON export/import.
- **Solver** — quick ops for the selection, a per-matrix `ƒ` menu, and a command bar (`C = A*B'`, `inv(A)`, `solve(A, b)`, `2A - 3I(3)`, `[1 2; 3 4]^-1`).
- **Explainer** — step-by-step or answer-only for: add/subtract/scale/multiply/power/transpose/Hadamard/Kronecker, REF, RREF, rank, inverse (Gauss–Jordan or adjugate), determinant (cofactor or row reduction), cofactor matrix, adjugate, trace, Ax=b (unique / none / parametric), least squares, null/column/row space, LU (with pivoting), Gram–Schmidt/QR, diagonalization, SVD, characteristic polynomial, eigenvalues & eigenvectors. Exact rational arithmetic throughout.

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
