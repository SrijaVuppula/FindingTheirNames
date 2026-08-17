# Finding Their Names - Airtable Automation Scripts

Automation scripts supporting the **Finding Their Names (FTN)** dataset, a project of the University of Georgia Libraries' Hargrett Rare Book and Manuscript Library. FTN documents enslaved and formerly enslaved persons drawn from archival collections, for publication on [Enslaved.org](https://enslaved.org) as part of the *Journal of Slavery and Data Preservation*.

These scripts run inside Airtable Automations (Script step) and keep the base's core tables - **Person Table**, **Event Table**, **Source Table**, **Place Table**, and the **Age Junction Table** - in sync as records are created, linked, and unlinked.

## Base structure (relevant tables)

- **Person Table** - named individuals (enslaved, free, enslavers, etc.)
- **Event Table** - discrete events (sales, births, appraisals, etc.)
- **Source Table** - archival source documents
- **Place Table** - locations associated with events
- **Age Junction Table** - junction table linking Person ↔ Event (many-to-many, used to track age-at-event)

## Scripts

### `scripts/junction-sync.js`
Keeps the **Age Junction Table** in sync with the People ↔ Event links on the Event Table (and Person Table, if triggered from that side). Compares currently-linked records against existing junction rows, creates missing junction rows, and deletes orphaned ones - without duplicating or dropping valid links.

- **Trigger:** record updated in Event Table (or Person Table)
- **Input variables:** `sourceTableName`, `recordId`

### `scripts/reciprocal-link-associator.js`
Derives and maintains indirect (reciprocal) links across the base whenever an Event record's Source, Place, or People links change:
- Source ↔ Place (via shared Events)
- Person ↔ Source (via a person's Events)
- Source ↔ People (derived, optional - toggle with `UPDATE_SOURCE_PEOPLE`)

- **Trigger:** record updated in Event Table
- **Input variables:** `recordId`

### `scripts/ghost-record-cleanup.js`
Deletes orphaned junction rows in the Age Junction Table (rows missing a valid link on either side).

- **Trigger:** record updated in Age Junction Table
- **Input variables:** `recordId`
- **⚠️ Setup note:** The automation's trigger conditions must combine "missing Event link" and "missing Person link" with **AND logic, not OR**. OR logic causes junction rows to be deleted prematurely - before `reciprocal-link-associator.js` finishes writing both sides of a newly created link.

## Setup notes

- All three automations must be scoped to trigger on a **Grid view**, not a personal view. Automations scoped to personal views do not fire reliably.
- Table and field names in the `CONFIG` blocks at the top of each script must match your base exactly - update them if you duplicate this base or rename fields.

## Order of operations

1. A record is created or a link field is edited on the Event Table.
2. `junction-sync.js` reconciles the Age Junction Table against the Event's People links.
3. `reciprocal-link-associator.js` recomputes derived Source ↔ Place and Person ↔ Source links from the updated Event links.
4. If a junction row becomes orphaned during this process, `ghost-record-cleanup.js` removes it once trigger conditions (AND logic) confirm it's truly orphaned.

---
*Maintained by Srija Vuppula, Graduate Research Assistant, UGA Special Collections Libraries.*
