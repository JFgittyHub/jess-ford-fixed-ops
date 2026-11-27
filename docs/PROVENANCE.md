# Provenance

Notes on what in this repo is original, what is invented sample data, and what came from somewhere else. This is not a license grant.

## Mark

`public/jess-logo.avif` is the desk header image. It arrived in the initial commit. The repo has no author, source, or license note for that file, so its origin beyond the file itself is not recorded here.

`public/favicon.svg` is a small “JF” mark drawn for this desk.

`public/__grok/` is platform install chrome shipped with the workspace. It is not shop artwork.

## Open-source dependencies

Application code in this repo has no root `LICENSE` file. Third-party packages are listed in `package.json` and `package-lock.json`. Each package entry there carries its own license (commonly MIT or Apache-2.0). Those license texts live with the installed packages, not in this file.

## Sample month

Customers, staff, vehicles, VINs, parts, labor, appointments, and repair orders in `src/lib/seed.ts` are invented for the demo. They are not an export from a live shop. Parts rows labeled `Aftermarket (demo)` are sample stock only. That label is not a claim that a part matches a branded line.

## Cancel reasons

The appointment cancel reasons in `src/lib/cancel.ts` — Customer request, Rescheduled, Vehicle sold or gone, Duplicate or entered in error, and Other — are this desk's own wording. They come from the owner's approved decisions on October 29, 2026. They were not copied from a vendor screen.

## Inspections

The multi-point list in `src/lib/mpi.ts` is a generic industry pattern: fluids, brakes, tread, and underbody items, with green / yellow / red marks. It is a visual reference for this desk. It was not copied from a vendor help document.
