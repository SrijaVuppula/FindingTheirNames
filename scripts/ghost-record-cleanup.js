// ======================
// CONFIG
// ======================
// Deletes a junction row (Age Junction Table) once the automation's
// trigger conditions determine it is an orphaned/"ghost" record —
// i.e. it no longer has valid links on both sides.
//
// IMPORTANT: The trigger conditions for this automation must use
// AND logic (not OR) across the "missing Event link" / "missing
// Person link" conditions. Using OR causes junction rows to be
// deleted prematurely, before the reciprocal-link-associator script
// has finished writing both sides of a new link.

const { recordId } = input.config();
const table = base.getTable('Age Junction Table');
await table.deleteRecordAsync(recordId);
